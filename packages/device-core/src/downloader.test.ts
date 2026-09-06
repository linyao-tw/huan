import type { AssetManifestEntry } from "@huan/protocol";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceApiClient } from "./api-client.js";
import { DownloadQueue } from "./downloader.js";
import { FakeClock, bytesResponse, createStubFetch, jsonResponse, makeAsset, sha256Of, type StubFetch, type StubRequest } from "./fixtures.js";
import { DeviceStorage, mediaFileName, partFileName, partMetaFileName } from "./storage.js";

const SERVER = "http://server.test";
const CDN = "https://cdn.test";

interface Harness {
	root: string;
	storage: DeviceStorage;
	queue: DownloadQueue;
	fetch: StubFetch;
	urlRequests: string[];
	cdnRequests: StubRequest[];
}

interface HarnessOptions {
	/** 每個 variantId 的 CDN 回應。回 `null` 代表連線失敗。 */
	cdn: (variantId: string, request: StubRequest, hit: number) => Response | null | Promise<Response | null>;
	signedUrl?: (variantId: string, hit: number) => Response;
	maxAttempts?: number;
}

async function createHarness(options: HarnessOptions): Promise<Harness> {
	const root = await mkdtemp(join(tmpdir(), "huan-download-"));
	const storage = new DeviceStorage({ appDataDir: root });
	await storage.init();

	const urlRequests: string[] = [];
	const cdnRequests: StubRequest[] = [];
	const urlHits = new Map<string, number>();
	const cdnHits = new Map<string, number>();

	const fetchStub = createStubFetch(request => {
		const urlMatch = /^http:\/\/server\.test\/api\/v1\/device\/assets\/([^/]+)\/url$/.exec(request.url);
		if (urlMatch?.[1]) {
			const variantId = urlMatch[1];
			urlRequests.push(variantId);
			const hit = (urlHits.get(variantId) ?? 0) + 1;
			urlHits.set(variantId, hit);
			if (options.signedUrl) return options.signedUrl(variantId, hit);
			return jsonResponse({
				url: `${CDN}/${variantId}?sig=${hit}`,
				expiresAt: new Date(Date.now() + 600_000).toISOString(),
				sha256: "0".repeat(64),
				sizeBytes: 0
			});
		}
		const cdnMatch = /^https:\/\/cdn\.test\/([^?]+)/.exec(request.url);
		if (cdnMatch?.[1]) {
			cdnRequests.push(request);
			const variantId = cdnMatch[1];
			const hit = (cdnHits.get(variantId) ?? 0) + 1;
			cdnHits.set(variantId, hit);
			return options.cdn(variantId, request, hit);
		}
		return null;
	});

	const api = new DeviceApiClient({ baseUrl: SERVER, fetch: fetchStub, token: () => "device.secret" });
	const queue = new DownloadQueue({
		storage,
		api,
		fetch: fetchStub,
		clock: new FakeClock(new Date("2026-01-01T00:00:00.000Z")),
		// 測試不需要真的等退避，只需要驗證重試次數。
		sleep: async () => {},
		random: () => 0.5,
		maxAttempts: options.maxAttempts ?? 3
	});

	return { root, storage, queue, fetch: fetchStub, urlRequests, cdnRequests };
}

describe("DownloadQueue", () => {
	let harness: Harness | null = null;

	afterEach(async () => {
		if (harness) await rm(harness.root, { recursive: true, force: true });
		harness = null;
	});

	it("下載、驗證雜湊並改名成正式檔案", async () => {
		const payload = "HUAN 播放檔內容";
		const entry = makeAsset(payload);
		harness = await createHarness({ cdn: () => bytesResponse(Buffer.from(payload, "utf8")) });

		const verified: string[] = [];
		const outcome = await harness.queue.run({ entries: [entry], onVerified: item => void verified.push(item.variantId) });

		expect(outcome.failed).toEqual([]);
		expect(outcome.ready).toEqual([entry.variantId]);
		expect(verified).toEqual([entry.variantId]);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)), "utf8")).toBe(payload);

		const index = await harness.storage.readMediaIndex();
		expect(index.entries[entry.variantId]?.sha256).toBe(entry.sha256);
	});

	it("雜湊不符時刪除暫存檔、絕不 ACK，並重試到上限", async () => {
		const entry = makeAsset("正確內容");
		harness = await createHarness({ cdn: () => bytesResponse(Buffer.from("被竄改的內容", "utf8")), maxAttempts: 3 });

		const verified: string[] = [];
		const outcome = await harness.queue.run({ entries: [entry], onVerified: item => void verified.push(item.variantId) });

		expect(verified).toEqual([]);
		expect(outcome.ready).toEqual([]);
		expect(outcome.failed).toHaveLength(1);
		expect(outcome.failed[0]?.attempts).toBe(3);
		expect(outcome.failed[0]?.reason).toContain("雜湊不符");
		// 重試了三次
		expect(harness.cdnRequests).toHaveLength(3);
		// 暫存檔與最終檔都不該留下
		await expect(stat(harness.storage.mediaPath(partFileName(entry.variantId)))).rejects.toThrow();
		await expect(stat(harness.storage.mediaPath(mediaFileName(entry)))).rejects.toThrow();
		const index = await harness.storage.readMediaIndex();
		expect(index.entries[entry.variantId]).toBeUndefined();
	});

	it("簽章網址過期時重新索取一張，同步繼續完成", async () => {
		const payload = "會員招募影片";
		const entry = makeAsset(payload);
		harness = await createHarness({
			cdn: (_variantId, _request, hit) => (hit === 1 ? new Response("expired", { status: 403 }) : bytesResponse(Buffer.from(payload, "utf8")))
		});

		const outcome = await harness.queue.run({ entries: [entry] });

		expect(outcome.failed).toEqual([]);
		// 過期不計入重試預算，而是換一張新的簽章網址。
		expect(harness.urlRequests).toEqual([entry.variantId, entry.variantId]);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)), "utf8")).toBe(payload);
	});

	it("已經存在且雜湊正確的檔案直接跳過，不重新下載", async () => {
		const payload = "已經在本機的影片";
		const entry = makeAsset(payload);
		harness = await createHarness({ cdn: () => bytesResponse(Buffer.from("不應該被用到", "utf8")) });
		await writeFile(harness.storage.mediaPath(mediaFileName(entry)), payload);

		const first = await harness.queue.run({ entries: [entry] });
		expect(first.ready).toEqual([entry.variantId]);
		expect(harness.cdnRequests).toHaveLength(0);

		// 第一次驗證過就寫進索引，第二次靠索引直接命中。
		const index = await harness.storage.readMediaIndex();
		expect(index.entries[entry.variantId]?.sha256).toBe(entry.sha256);

		const second = await harness.queue.run({ entries: [entry] });
		expect(second.ready).toEqual([entry.variantId]);
		expect(harness.cdnRequests).toHaveLength(0);
	});

	it("本機檔案內容不對時會刪掉重抓", async () => {
		const payload = "正確的影片";
		const entry = makeAsset(payload);
		harness = await createHarness({ cdn: () => bytesResponse(Buffer.from(payload, "utf8")) });
		await writeFile(harness.storage.mediaPath(mediaFileName(entry)), "壞掉的舊檔");

		const outcome = await harness.queue.run({ entries: [entry] });
		expect(outcome.failed).toEqual([]);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)), "utf8")).toBe(payload);
		expect(harness.cdnRequests).toHaveLength(1);
	});

	it("伺服器支援 Range 時從中斷處續傳", async () => {
		const payload = Buffer.from("0123456789ABCDEFGHIJ", "utf8");
		const entry = makeAsset(payload);
		const offset = 8;
		harness = await createHarness({
			cdn: (_variantId, request) => {
				const range = request.headers.range;
				if (range !== `bytes=${offset}-`) return new Response("expected range request", { status: 500 });
				return bytesResponse(payload.subarray(offset), { status: 206, contentRange: `bytes ${offset}-${payload.byteLength - 1}/${payload.byteLength}` });
			}
		});

		await writeFile(harness.storage.mediaPath(partFileName(entry.variantId)), payload.subarray(0, offset));
		await writeFile(harness.storage.mediaPath(partMetaFileName(entry.variantId)), JSON.stringify({ sha256: entry.sha256, sizeBytes: entry.sizeBytes, acceptsRanges: true }));

		const outcome = await harness.queue.run({ entries: [entry] });

		expect(outcome.failed).toEqual([]);
		expect(outcome.bytesDownloaded).toBe(payload.byteLength - offset);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)))).toEqual(payload);
	});

	it("伺服器不支援 Range 時退回完整重新下載", async () => {
		const payload = Buffer.from("0123456789ABCDEFGHIJ", "utf8");
		const entry = makeAsset(payload);
		harness = await createHarness({
			cdn: (_variantId, request) => {
				expect(request.headers.range).toBeUndefined();
				return bytesResponse(payload, { acceptRanges: false });
			}
		});

		await writeFile(harness.storage.mediaPath(partFileName(entry.variantId)), payload.subarray(0, 8));
		await writeFile(harness.storage.mediaPath(partMetaFileName(entry.variantId)), JSON.stringify({ sha256: entry.sha256, sizeBytes: entry.sizeBytes, acceptsRanges: false }));

		const outcome = await harness.queue.run({ entries: [entry] });
		expect(outcome.failed).toEqual([]);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)))).toEqual(payload);
	});

	it("`.part` 的雜湊記載跟新的 manifest 不同時整支作廢", async () => {
		const payload = Buffer.from("新版本的影片內容", "utf8");
		const entry = makeAsset(payload);
		harness = await createHarness({
			cdn: (_variantId, request) => {
				expect(request.headers.range).toBeUndefined();
				return bytesResponse(payload);
			}
		});

		await writeFile(harness.storage.mediaPath(partFileName(entry.variantId)), "舊版本的殘骸");
		await writeFile(harness.storage.mediaPath(partMetaFileName(entry.variantId)), JSON.stringify({ sha256: sha256Of("完全不同的東西"), sizeBytes: 999, acceptsRanges: true }));

		const outcome = await harness.queue.run({ entries: [entry] });
		expect(outcome.failed).toEqual([]);
		expect(await readFile(harness.storage.mediaPath(mediaFileName(entry)))).toEqual(payload);
	});

	it("同時下載的數量不超過 maxConcurrent", async () => {
		const entries: AssetManifestEntry[] = [];
		const payloads = new Map<string, Buffer>();
		for (let index = 0; index < 8; index += 1) {
			const bytes = Buffer.from(`影片-${index}`, "utf8");
			const entry = makeAsset(bytes);
			entries.push(entry);
			payloads.set(entry.variantId, bytes);
		}

		let inFlight = 0;
		let peak = 0;
		harness = await createHarness({
			cdn: async variantId => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				// 真的停一下，否則整段處理是同步的，測不出併發上限。
				await new Promise(resolve => setTimeout(resolve, 10));
				inFlight -= 1;
				const bytes = payloads.get(variantId);
				return bytes ? bytesResponse(bytes) : new Response("missing", { status: 404 });
			}
		});

		const outcome = await harness.queue.run({ entries, maxConcurrent: 2 });
		expect(outcome.failed).toEqual([]);
		expect(peak).toBe(2);
	});

	it("重複出現的 variant 只下載一次", async () => {
		const entry = makeAsset("共用素材");
		harness = await createHarness({ cdn: () => bytesResponse(Buffer.from("共用素材", "utf8")) });
		const outcome = await harness.queue.run({ entries: [entry, { ...entry }] });
		expect(outcome.ready).toEqual([entry.variantId]);
		expect(harness.cdnRequests).toHaveLength(1);
	});

	it("連線失敗會重試到上限後回報失敗，而不是丟例外", async () => {
		const entry = makeAsset("拿不到的影片");
		harness = await createHarness({ cdn: () => null, maxAttempts: 2 });
		const outcome = await harness.queue.run({ entries: [entry] });
		expect(outcome.ready).toEqual([]);
		expect(outcome.failed[0]?.attempts).toBe(2);
	});
});
