import type { AssetAckRequest, DesiredState } from "@huan/protocol";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceApiClient } from "./api-client.js";
import { DownloadQueue } from "./downloader.js";
import { FakeClock, bytesResponse, createStubFetch, jsonResponse, makeAsset, makeDesiredState, makeLayout, makeSchedule } from "./fixtures.js";
import { Reconciler } from "./reconciler.js";
import { LayoutScheduler } from "./scheduler.js";
import { StorageManager } from "./storage-manager.js";
import { DeviceStorage, mediaFileName } from "./storage.js";

const SERVER = "http://server.test";

interface Harness {
	root: string;
	storage: DeviceStorage;
	reconciler: Reconciler;
	scheduler: LayoutScheduler;
	storageManager: StorageManager;
	clock: FakeClock;
	setDesired: (state: DesiredState) => void;
	setPayload: (variantId: string, bytes: Buffer) => void;
	acks: AssetAckRequest[];
	cdnHits: () => number;
}

async function createHarness(initial: DesiredState, options: { freeBytes?: number; retentionMs?: number } = {}): Promise<Harness> {
	const root = await mkdtemp(join(tmpdir(), "huan-reconcile-"));
	const storage = new DeviceStorage({ appDataDir: root });
	await storage.init();

	let desired = initial;
	const payloads = new Map<string, Buffer>();
	const acks: AssetAckRequest[] = [];
	let cdnCalls = 0;

	const fetchStub = createStubFetch(request => {
		if (request.url === `${SERVER}/api/v1/device/state`) return jsonResponse(desired);
		if (request.url === `${SERVER}/api/v1/device/assets/ack` && request.method === "POST") {
			if (request.body) acks.push(JSON.parse(request.body));
			return jsonResponse({ ok: true });
		}
		const urlMatch = /\/api\/v1\/device\/assets\/([^/]+)\/url$/.exec(request.url);
		if (urlMatch?.[1]) {
			return jsonResponse({
				url: `https://cdn.test/${urlMatch[1]}`,
				expiresAt: new Date(Date.now() + 600_000).toISOString(),
				sha256: "0".repeat(64),
				sizeBytes: 0
			});
		}
		const cdnMatch = /^https:\/\/cdn\.test\/([^?]+)/.exec(request.url);
		if (cdnMatch?.[1]) {
			cdnCalls += 1;
			const bytes = payloads.get(cdnMatch[1]);
			return bytes ? bytesResponse(bytes) : new Response("not found", { status: 404 });
		}
		return null;
	});

	// 用真實時間當基準：垃圾回收比較的是檔案的 mtime，假時間會讓保留期算出負值。
	const clock = new FakeClock(new Date());
	const api = new DeviceApiClient({ baseUrl: SERVER, fetch: fetchStub, token: () => "device.secret" });
	const storageManager = new StorageManager({
		storage,
		clock,
		retentionMs: options.retentionMs ?? 0,
		diskUsage: async () => ({ freeBytes: options.freeBytes ?? 10_000_000_000, totalBytes: 20_000_000_000 })
	});
	const downloader = new DownloadQueue({ storage, api, fetch: fetchStub, clock, sleep: async () => {}, random: () => 0.5, maxAttempts: 2 });
	const scheduler = new LayoutScheduler({ clock });
	const reconciler = new Reconciler({ storage, api, downloader, storageManager, scheduler, clock });
	await reconciler.load();

	return {
		root,
		storage,
		reconciler,
		scheduler,
		storageManager,
		clock,
		acks,
		setDesired: state => {
			desired = state;
		},
		setPayload: (variantId, bytes) => payloads.set(variantId, bytes),
		cdnHits: () => cdnCalls
	};
}

describe("Reconciler", () => {
	let harness: Harness | null = null;

	afterEach(async () => {
		if (harness) await rm(harness.root, { recursive: true, force: true });
		harness = null;
	});

	it("所有素材驗證完成後才啟用新版本", async () => {
		const layout = makeLayout({ name: "首頁" });
		const asset = makeAsset("第一支影片");
		const desired = makeDesiredState({ version: 1, layouts: [layout], defaultLayout: layout, assets: [asset] });

		harness = await createHarness(desired);
		harness.setPayload(asset.variantId, Buffer.from("第一支影片", "utf8"));

		const result = await harness.reconciler.sync();

		expect(result.activated).toBe(true);
		expect(harness.reconciler.activationVersion).toBe(1);
		expect((await harness.storage.readActiveManifest())?.version).toBe(1);
		expect(await harness.storage.readPendingManifest()).toBeNull();
		expect(harness.acks.map(ack => ack.variantId)).toEqual([asset.variantId]);
		expect(harness.scheduler.current.layoutRevisionId).toBe(layout.revisionId);
	});

	it("新版本有素材壞掉時，繼續播舊版本並且不刪舊檔案", async () => {
		const layoutA = makeLayout({ name: "A 版面" });
		const assetA = makeAsset("A 的影片");
		const versionA = makeDesiredState({ version: 1, layouts: [layoutA], defaultLayout: layoutA, assets: [assetA] });

		harness = await createHarness(versionA);
		harness.setPayload(assetA.variantId, Buffer.from("A 的影片", "utf8"));
		await harness.reconciler.sync();
		expect(harness.reconciler.activationVersion).toBe(1);

		const layoutB = makeLayout({ name: "B 版面" });
		const assetB = makeAsset("B 的影片");
		const versionB = makeDesiredState({
			deviceId: versionA.deviceId,
			version: 2,
			layouts: [layoutB],
			defaultLayout: layoutB,
			assets: [assetA, assetB]
		});
		harness.setDesired(versionB);
		// B 的第二支素材傳回來的內容被竄改，雜湊一定對不上。
		harness.setPayload(assetB.variantId, Buffer.from("被竄改的內容", "utf8"));

		const blocked = await harness.reconciler.sync();

		expect(blocked.activated).toBe(false);
		expect(blocked.failed.map(item => item.variantId)).toEqual([assetB.variantId]);
		// 仍然停在版本 1，畫面上播的還是 A。
		expect(harness.reconciler.activationVersion).toBe(1);
		expect((await harness.storage.readActiveManifest())?.version).toBe(1);
		expect(harness.scheduler.current.layoutRevisionId).toBe(layoutA.revisionId);
		// A 的檔案完全沒被動過。
		expect(await readFile(harness.storage.mediaPath(mediaFileName(assetA)), "utf8")).toBe("A 的影片");
		// 壞掉的素材絕對不能 ACK。
		expect(harness.acks.some(ack => ack.variantId === assetB.variantId)).toBe(false);

		// 修好之後再同步一次就切過去。
		harness.setPayload(assetB.variantId, Buffer.from("B 的影片", "utf8"));
		const activated = await harness.reconciler.sync();
		expect(activated.activated).toBe(true);
		expect(harness.reconciler.activationVersion).toBe(2);
		expect((await harness.storage.readActiveManifest())?.version).toBe(2);
		expect(harness.acks.some(ack => ack.variantId === assetB.variantId)).toBe(true);
	});

	it("版本沒變就不重新下載", async () => {
		const layout = makeLayout();
		const asset = makeAsset("只下載一次");
		const desired = makeDesiredState({ version: 5, layouts: [layout], defaultLayout: layout, assets: [asset] });
		harness = await createHarness(desired);
		harness.setPayload(asset.variantId, Buffer.from("只下載一次", "utf8"));

		await harness.reconciler.sync();
		const hitsAfterFirst = harness.cdnHits();
		const second = await harness.reconciler.sync();

		expect(second.changed).toBe(false);
		expect(second.activated).toBe(false);
		expect(harness.cdnHits()).toBe(hitsAfterFirst);
	});

	it("有人手動刪掉播放檔時，下一輪同步會補回來", async () => {
		const layout = makeLayout();
		const asset = makeAsset("會被刪掉的影片");
		const desired = makeDesiredState({ version: 3, layouts: [layout], defaultLayout: layout, assets: [asset] });
		harness = await createHarness(desired);
		harness.setPayload(asset.variantId, Buffer.from("會被刪掉的影片", "utf8"));
		await harness.reconciler.sync();

		await harness.storage.removeMediaFile(mediaFileName(asset));
		await harness.reconciler.sync();

		expect(await readFile(harness.storage.mediaPath(mediaFileName(asset)), "utf8")).toBe("會被刪掉的影片");
	});

	it("垃圾回收不會刪掉使用中版面或下一個排程版面的素材", async () => {
		const nowLayout = makeLayout({ name: "白天版面" });
		const nightLayout = makeLayout({ name: "夜間版面" });
		const nowAsset = makeAsset("白天播的影片");
		const nightAsset = makeAsset("夜間播的影片");
		const desired = makeDesiredState({
			version: 1,
			layouts: [nowLayout, nightLayout],
			defaultLayout: nowLayout,
			assets: [nowAsset, nightAsset],
			schedules: [
				makeSchedule(nowLayout.revisionId, { name: "白天", startTime: "08:00", endTime: "18:00" }),
				makeSchedule(nightLayout.revisionId, { name: "夜間", startTime: "18:00", endTime: "23:00" })
			]
		});

		harness = await createHarness(desired);
		harness.setPayload(nowAsset.variantId, Buffer.from("白天播的影片", "utf8"));
		harness.setPayload(nightAsset.variantId, Buffer.from("夜間播的影片", "utf8"));
		await harness.reconciler.sync();

		// 一個已經沒有任何 manifest 引用的孤兒檔案。
		const orphan = harness.storage.mediaPath("00000000-0000-4000-8000-000000000000.mp4");
		await writeFile(orphan, "上一個版本留下的影片");

		// 把所有播放檔都推到保留期之外，這樣「有沒有被刪」就完全取決於保護名單，
		// 而不是靠保留期僥倖留下來。
		const longAgo = new Date(harness.clock.now().getTime() - 60 * 60 * 1000);
		for (const file of await harness.storage.listMediaFiles()) await utimes(file.path, longAgo, longAgo);

		await harness.reconciler.collectGarbage();

		await expect(stat(orphan)).rejects.toThrow();
		// 現在正在播的、以及晚上才要播的，兩個都必須留著。
		expect(await readFile(harness.storage.mediaPath(mediaFileName(nowAsset)), "utf8")).toBe("白天播的影片");
		expect(await readFile(harness.storage.mediaPath(mediaFileName(nightAsset)), "utf8")).toBe("夜間播的影片");
	});

	it("保留期內的孤兒檔案先留著，過了保留期才回收", async () => {
		const layout = makeLayout();
		const desired = makeDesiredState({ version: 1, layouts: [layout], defaultLayout: layout });
		harness = await createHarness(desired, { retentionMs: 10 * 60 * 1000 });
		await harness.reconciler.sync();

		const orphan = harness.storage.mediaPath("11111111-1111-4111-8111-111111111111.mp4");
		await writeFile(orphan, "剛寫好的檔案");

		await harness.reconciler.collectGarbage();
		expect(await readFile(orphan, "utf8")).toBe("剛寫好的檔案");

		// 把 mtime 往前挪，等同於這個檔案已經放了十一分鐘沒人認領。
		const stale = new Date(harness.clock.now().getTime() - 11 * 60 * 1000);
		await utimes(orphan, stale, stale);
		await harness.reconciler.collectGarbage();
		await expect(stat(orphan)).rejects.toThrow();
	});

	it("磁碟空間不足時回報 storageError，而且不啟用新版本", async () => {
		const layout = makeLayout();
		const asset = makeAsset("很大的影片", { sizeBytes: 5_000_000_000 });
		const desired = makeDesiredState({ version: 1, layouts: [layout], defaultLayout: layout, assets: [asset] });
		harness = await createHarness(desired, { freeBytes: 1_000 });

		const result = await harness.reconciler.sync();

		expect(result.activated).toBe(false);
		expect(result.storageError).toContain("磁碟空間不足");
		expect(harness.reconciler.activationVersion).toBeNull();
	});

	it("heartbeat 用的素材統計反映最新的 desired state", async () => {
		const layout = makeLayout();
		const ready = makeAsset("已就緒");
		const missing = makeAsset("還沒好");
		const desired = makeDesiredState({ version: 1, layouts: [layout], defaultLayout: layout, assets: [ready, missing] });
		harness = await createHarness(desired);
		harness.setPayload(ready.variantId, Buffer.from("已就緒", "utf8"));

		await harness.reconciler.sync();
		const summary = await harness.reconciler.assetSummary();

		expect(summary.readyAssetIds).toEqual([ready.assetId]);
		expect(summary.pendingAssetIds).toEqual([missing.assetId]);
		expect(summary.totalCount).toBe(2);
		expect(summary.readyCount).toBe(1);
	});
});
