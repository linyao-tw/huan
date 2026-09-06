import { cleanupDistribution } from "@/jobs/cleanup-distribution";
import type { TestHarness } from "@/test-support";
import { announceSkip, createHarness, loadAssetRow, loadVariants, makeTempDir, removeTempDir, seedAsset, seedDevice } from "@/test-support";
import { mediaAssets, mediaDeviceSync, mediaVariants } from "@huan/db";
import { sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type SyncStatus = "pending" | "ready" | "failed";

let harness: TestHarness | null = null;
let workDir = "";

beforeAll(async () => {
	const result = await createHarness();
	if (!result.ok) {
		announceSkip(`跳過 distribution 回收測試：${result.reason}`);
		return;
	}
	harness = result.harness;
	workDir = await makeTempDir("huan-cleanup-test-");
});

afterAll(async () => {
	if (workDir) await removeTempDir(workDir);
	if (harness) await harness.cleanup();
});

interface Scenario {
	assetId: string;
	playbackId: string;
	playbackKey: string;
}

/**
 * 造出一個「已經派送出去」的播放產物。
 *
 * `keepOriginal` 用來區分兩種情境：原始檔已依生命週期刪除（回收後就真的什麼都不剩），
 * 以及原始檔還在（回收 playback 不該把素材打成需要重新上傳）。
 */
async function seedDistributed(active: TestHarness, name: string, options: { settledAt: Date | null; deviceStatuses: SyncStatus[]; keepOriginal: boolean }): Promise<Scenario> {
	const fixture = join(workDir, `${name}.mp4`);
	await writeFile(fixture, Buffer.from(`HUAN 測試播放產物 ${name}`, "utf8"));
	const seeded = await seedAsset(active, { kind: "video", contentType: "video/mp4", filePath: fixture, extension: ".mp4" });

	const playbackKey = active.storage.objectKeyFor("playback", ".mp4");
	await active.storage.uploadFile(playbackKey, fixture, "video/mp4");

	const inserted = await active.db
		.insert(mediaVariants)
		.values({
			assetId: seeded.assetId,
			role: "playback",
			objectKey: playbackKey,
			contentType: "video/mp4",
			sizeBytes: 32,
			sha256: null,
			available: true,
			distributionSettledAt: options.settledAt
		})
		.returning({ id: mediaVariants.id });
	const playbackId = inserted[0].id;

	if (!options.keepOriginal) {
		await active.storage.deleteObject(seeded.originalKey);
		await active.db
			.update(mediaVariants)
			.set({ available: false, removedAt: new Date() })
			.where(sql`${mediaVariants.assetId} = ${seeded.assetId} and ${mediaVariants.role} = 'original'`);
	}

	await active.db
		.update(mediaAssets)
		.set({ status: "ready" })
		.where(sql`${mediaAssets.id} = ${seeded.assetId}`);

	for (const [index, status] of options.deviceStatuses.entries()) {
		const deviceId = await seedDevice(active, `${name}-device-${index}`);
		await active.db.insert(mediaDeviceSync).values({ deviceId, variantId: playbackId, assetId: seeded.assetId, status });
	}

	return { assetId: seeded.assetId, playbackId, playbackKey };
}

describe("cleanup_distribution", () => {
	it("所有裝置都 ready 且過了保留期才回收，並誠實標記需要重新上傳", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const scenario = await seedDistributed(active, "settled", {
			settledAt: new Date(Date.now() - 3 * 3600_000),
			deviceStatuses: ["ready", "ready"],
			keepOriginal: false
		});

		const result = await cleanupDistribution({ db: active.db, storage: active.storage, logger: active.logger, retentionHours: 1 });
		expect(result.reclaimed).toBeGreaterThanOrEqual(1);

		expect(await active.storage.head(scenario.playbackKey)).toBeNull();
		const variants = await loadVariants(active, scenario.assetId);
		expect(variants.get("playback")?.available).toBe(false);
		expect(variants.get("playback")?.removedAt).not.toBeNull();

		/** 原始檔早就刪了，playback 也回收了，伺服器手上真的什麼都沒有。 */
		expect((await loadAssetRow(active, scenario.assetId)).status).toBe("needs_reupload");
	});

	it("還有裝置沒 ACK 就不能回收", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const scenario = await seedDistributed(active, "pending-device", {
			settledAt: new Date(Date.now() - 3 * 3600_000),
			deviceStatuses: ["ready", "pending"],
			keepOriginal: false
		});

		await cleanupDistribution({ db: active.db, storage: active.storage, logger: active.logger, retentionHours: 1 });

		expect(await active.storage.head(scenario.playbackKey)).not.toBeNull();
		expect((await loadVariants(active, scenario.assetId)).get("playback")?.available).toBe(true);
		expect((await loadAssetRow(active, scenario.assetId)).status).toBe("ready");
	});

	it("保留期還沒過就不能回收", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const scenario = await seedDistributed(active, "within-grace", {
			settledAt: new Date(Date.now() - 10 * 60_000),
			deviceStatuses: ["ready"],
			keepOriginal: false
		});

		await cleanupDistribution({ db: active.db, storage: active.storage, logger: active.logger, retentionHours: 24 });

		expect(await active.storage.head(scenario.playbackKey)).not.toBeNull();
		expect((await loadVariants(active, scenario.assetId)).get("playback")?.available).toBe(true);
	});

	it("尚未派送完成（沒有 settled 時間）的產物不會被碰", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const scenario = await seedDistributed(active, "unsettled", { settledAt: null, deviceStatuses: ["ready"], keepOriginal: false });

		await cleanupDistribution({ db: active.db, storage: active.storage, logger: active.logger, retentionHours: 1 });

		expect(await active.storage.head(scenario.playbackKey)).not.toBeNull();
	});

	it("原始檔還在時，回收 playback 不會把素材打成需要重新上傳", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const scenario = await seedDistributed(active, "keeps-original", {
			settledAt: new Date(Date.now() - 3 * 3600_000),
			deviceStatuses: ["ready"],
			keepOriginal: true
		});

		await cleanupDistribution({ db: active.db, storage: active.storage, logger: active.logger, retentionHours: 1 });

		expect((await loadVariants(active, scenario.assetId)).get("playback")?.available).toBe(false);
		expect((await loadAssetRow(active, scenario.assetId)).status).toBe("ready");
	});
});
