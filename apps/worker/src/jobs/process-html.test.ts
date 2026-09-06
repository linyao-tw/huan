import { JobError, USER_MESSAGES } from "@/errors";
import { HTML_MAX_BYTES, looksLikeHtml, processHtml } from "@/jobs/process-html";
import { JobQueue } from "@/queue";
import { WorkerRunner } from "@/runner";
import type { TestHarness } from "@/test-support";
import { announceSkip, createHarness, enqueueJob, loadAssetRow, loadVariants, makeTempDir, removeTempDir, runJobHandler, seedAsset } from "@/test-support";
import { sha256File } from "@huan/shared/node";
import { sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SAMPLE_HTML = `<!doctype html>
<html lang="zh-Hant">
	<head><meta charset="utf-8" /><title>看板</title></head>
	<body><div class="board">HUAN 讙</div></body>
</html>
`;

let harness: TestHarness | null = null;
let workDir = "";
const createdJobs: string[] = [];

beforeAll(async () => {
	const result = await createHarness();
	if (!result.ok) {
		announceSkip(`跳過 HTML 處理測試：${result.reason}`);
		return;
	}
	harness = result.harness;
	workDir = await makeTempDir("huan-html-test-");
});

afterAll(async () => {
	if (workDir) await removeTempDir(workDir);
	if (!harness) return;
	for (const jobId of createdJobs) await harness.db.execute(sql`delete from worker_jobs where id = ${jobId}`);
	await harness.cleanup();
});

describe("HTML 內容驗證", () => {
	it("接受純文字的 HTML", () => {
		expect(looksLikeHtml(Buffer.from(SAMPLE_HTML, "utf8"))).toBe(true);
		expect(looksLikeHtml(Buffer.from("<div>只有片段</div>", "utf8"))).toBe(true);
	});

	it("拒絕二進位與空內容", () => {
		expect(looksLikeHtml(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(false);
		expect(looksLikeHtml(Buffer.alloc(0))).toBe(false);
		expect(looksLikeHtml(Buffer.from("這只是一段純文字，沒有任何標籤。", "utf8"))).toBe(false);
	});
});

describe("process_html 端對端", () => {
	it("把 HTML 搬到 distribution 並計算 SHA-256", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const fixture = join(workDir, "page.html");
		await writeFile(fixture, SAMPLE_HTML, "utf8");
		const seeded = await seedAsset(active, { kind: "html", contentType: "text/html", filePath: fixture, extension: ".html" });

		await runJobHandler(active, { kind: "process_html", assetId: seeded.assetId, handler: processHtml });

		const asset = await loadAssetRow(active, seeded.assetId);
		expect(asset.status).toBe("ready");

		const variants = await loadVariants(active, seeded.assetId);
		const playback = variants.get("playback");
		expect(playback?.objectKey).toMatch(/^distribution\/[0-9a-f-]{36}\.html$/);
		expect(playback?.contentType).toBe("text/html; charset=utf-8");
		expect(playback?.sha256).toBe(await sha256File(fixture));
		/** HTML 不產生縮圖，Admin 端以圖示呈現，不假裝有預覽畫面。 */
		expect(variants.has("thumbnail")).toBe(false);
		expect(variants.has("preview")).toBe(false);

		const original = variants.get("original");
		expect(original?.available).toBe(false);
		expect(await active.storage.head(original!.objectKey)).toBeNull();
	});

	it("不是 HTML 的內容會被擋下來", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const fixture = join(workDir, "binary.html");
		await writeFile(fixture, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
		const seeded = await seedAsset(active, { kind: "html", contentType: "text/html", filePath: fixture, extension: ".html" });

		const thrown = await runJobHandler(active, { kind: "process_html", assetId: seeded.assetId, handler: processHtml }).catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(JobError);
		expect((thrown as JobError).userMessage).toBe(USER_MESSAGES.htmlNotHtml);
	});

	it("超過 5 MB 會失敗，訊息裡沒有路徑也沒有指令", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const fixture = join(workDir, "huge.html");
		await writeFile(fixture, Buffer.concat([Buffer.from("<html><body>", "utf8"), Buffer.alloc(HTML_MAX_BYTES + 1024, 0x61)]));
		const seeded = await seedAsset(active, { kind: "html", contentType: "text/html", filePath: fixture, extension: ".html" });

		/** 走完整條 runner 路徑，確認重試額度用完之後素材真的被標成 failed。 */
		const jobId = await enqueueJob(active, { kind: "process_html", assetId: seeded.assetId, maxAttempts: 1 });
		createdJobs.push(jobId);

		const queue = new JobQueue(active.db, { lockedBy: "test-html-runner" });
		const runner = new WorkerRunner({
			db: active.db,
			storage: active.storage,
			queue,
			env: { ...active.env, WORKER_CONCURRENCY: 1 },
			logger: active.logger,
			runCleanup: false
		});

		for (let round = 0; round < 5; round += 1) {
			await runner.runOnce();
			const rows = await active.db.execute<{ status: string; error: string | null }>(sql`select status, error from worker_jobs where id = ${jobId}`);
			if (rows[0].status === "failed") break;
		}

		const jobRows = await active.db.execute<{ status: string; error: string | null }>(sql`select status, error from worker_jobs where id = ${jobId}`);
		expect(jobRows[0].status).toBe("failed");
		expect(jobRows[0].error).toBe(USER_MESSAGES.htmlTooLarge);

		const asset = await loadAssetRow(active, seeded.assetId);
		expect(asset.status).toBe("failed");
		expect(asset.errorMessage).toBe(USER_MESSAGES.htmlTooLarge);
		expect(asset.errorMessage).not.toMatch(/\/|ffmpeg|ffprobe/);
	});
});
