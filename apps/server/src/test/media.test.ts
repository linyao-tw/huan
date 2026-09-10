import { checkEnvironment, createHarness, createReadyAsset, createUser, login, pairDevice, singleAssetDocument, type SeededUser, type TestHarness } from "@/test/helpers";
import { mediaDeviceSync, mediaVariants, workerJobs } from "@huan/db";
import { sha256Hex } from "@huan/shared/node";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 素材整合測試：${environment.reason}`);

suite("素材生命週期", () => {
	let harness: TestHarness;
	let owner: SeededUser;
	let cookie: string;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
		/** 素材、版面、排程與裝置都只有一般使用者能擁有，最高管理員只負責帳號管理。 */
		owner = await createUser(harness, { role: "user" });
		cookie = await login(harness, owner.email, owner.password);
	});

	async function createUpload(overrides: Partial<{ kind: string; name: string; filename: string; contentType: string; sizeBytes: number }> = {}) {
		return harness.app.inject({
			method: "POST",
			url: harness.url("/media/uploads"),
			headers: { cookie },
			payload: {
				kind: overrides.kind ?? "video",
				name: overrides.name ?? "測試影片",
				filename: overrides.filename ?? "clip.mp4",
				contentType: overrides.contentType ?? "video/mp4",
				sizeBytes: overrides.sizeBytes ?? 1024
			}
		});
	}

	it("拒絕與素材種類不符的 content type", async () => {
		const response = await createUpload({ kind: "image", contentType: "video/mp4" });
		expect(response.statusCode).toBe(400);
		expect(response.json().code).toBe("validation_failed");
	});

	it("物件不存在時 complete 會被拒絕，實際上傳之後才成功並排入轉檔工作", async () => {
		const created = await createUpload();
		expect(created.statusCode).toBe(201);
		const { assetId, uploadUrl, headers } = created.json();
		expect(headers["Content-Type"]).toBe("video/mp4");

		/** 物件鍵一律由 UUID 組成，不能出現使用者送來的檔名。 */
		const [variant] = await harness.ctx.db.select().from(mediaVariants).where(eq(mediaVariants.assetId, assetId));
		expect(variant?.objectKey).toBe(`uploads/${assetId}/${variant?.id}.mp4`);
		expect(variant?.objectKey).not.toContain("clip");

		const tooEarly = await harness.app.inject({ method: "POST", url: harness.url("/media/uploads/complete"), headers: { cookie }, payload: { assetId } });
		expect(tooEarly.statusCode).toBe(409);
		expect(tooEarly.json().code).toBe("upload_missing");

		const body = Buffer.from("這是一段假裝是影片的位元組", "utf8");
		const uploaded = await fetch(uploadUrl, { method: "PUT", body: new Uint8Array(body), headers });
		expect(uploaded.status).toBe(200);

		const completed = await harness.app.inject({ method: "POST", url: harness.url("/media/uploads/complete"), headers: { cookie }, payload: { assetId } });
		expect(completed.statusCode).toBe(200);
		expect(completed.json()).toMatchObject({ id: assetId, status: "uploaded", kind: "video" });
		expect(completed.json().variants[0].sizeBytes).toBe(body.byteLength);

		const jobs = await harness.ctx.db.select().from(workerJobs).where(eq(workerJobs.assetId, assetId));
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({ kind: "transcode_video", status: "pending" });

		/** 同一個素材不能被 complete 兩次，否則會排出兩個重複的轉檔工作。 */
		const again = await harness.app.inject({ method: "POST", url: harness.url("/media/uploads/complete"), headers: { cookie }, payload: { assetId } });
		expect(again.statusCode).toBe(409);
	});

	it("圖片與 HTML 分別排到對應種類的工作", async () => {
		for (const [kind, contentType, jobKind] of [
			["image", "image/png", "process_image"],
			["html", "text/html", "process_html"]
		] as const) {
			const created = await createUpload({ kind, contentType, filename: `x.${kind}`, name: `測試 ${kind}` });
			const { assetId, uploadUrl, headers } = created.json();
			await fetch(uploadUrl, { method: "PUT", body: new Uint8Array(Buffer.from("payload", "utf8")), headers });
			const completed = await harness.app.inject({ method: "POST", url: harness.url("/media/uploads/complete"), headers: { cookie }, payload: { assetId } });
			expect(completed.statusCode).toBe(200);
			const jobs = await harness.ctx.db.select().from(workerJobs).where(eq(workerJobs.assetId, assetId));
			expect(jobs[0]?.kind).toBe(jobKind);
		}
	});

	it("裝置下載與 ACK：雜湊不符會被拒絕，正確才標記完成", async () => {
		const asset = await createReadyAsset(harness, owner.id);
		const layout = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name: "派送測試", description: null, canvas: { width: 1920, height: 1080 } }
		});
		const layoutId = layout.json().id;
		await harness.app.inject({ method: "PATCH", url: harness.url(`/layouts/${layoutId}`), headers: { cookie }, payload: { draft: singleAssetDocument(asset.assetId) } });
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });

		const device = await pairDevice(harness, cookie, "派送裝置", layoutId);

		const pendingRows = await harness.ctx.db.select().from(mediaDeviceSync).where(eq(mediaDeviceSync.deviceId, device.deviceId));
		expect(pendingRows).toHaveLength(1);
		expect(pendingRows[0]?.status).toBe("pending");

		const downloadUrl = await harness.app.inject({ method: "GET", url: harness.url(`/device/assets/${asset.variantId}/url`), headers: { authorization: device.authorization } });
		expect(downloadUrl.statusCode).toBe(200);
		expect(downloadUrl.json()).toMatchObject({ sha256: asset.sha256, sizeBytes: asset.sizeBytes });

		const downloaded = await fetch(downloadUrl.json().url);
		expect(downloaded.status).toBe(200);
		const bytes = Buffer.from(await downloaded.arrayBuffer());
		expect(sha256Hex(bytes)).toBe(asset.sha256);

		const wrongChecksum = await harness.app.inject({
			method: "POST",
			url: harness.url("/device/assets/ack"),
			headers: { authorization: device.authorization },
			payload: { assetId: asset.assetId, variantId: asset.variantId, sha256: "0".repeat(64), sizeBytes: asset.sizeBytes }
		});
		expect(wrongChecksum.statusCode).toBe(409);
		expect(wrongChecksum.json().code).toBe("checksum_mismatch");

		const failedRow = await harness.ctx.db
			.select()
			.from(mediaDeviceSync)
			.where(and(eq(mediaDeviceSync.deviceId, device.deviceId), eq(mediaDeviceSync.variantId, asset.variantId)));
		expect(failedRow[0]?.status).toBe("failed");

		const correct = await harness.app.inject({
			method: "POST",
			url: harness.url("/device/assets/ack"),
			headers: { authorization: device.authorization },
			payload: { assetId: asset.assetId, variantId: asset.variantId, sha256: asset.sha256, sizeBytes: asset.sizeBytes }
		});
		expect(correct.statusCode).toBe(200);

		const readyRow = await harness.ctx.db
			.select()
			.from(mediaDeviceSync)
			.where(and(eq(mediaDeviceSync.deviceId, device.deviceId), eq(mediaDeviceSync.variantId, asset.variantId)));
		expect(readyRow[0]?.status).toBe("ready");

		/** 所有目標裝置都完成時，保留期才開始計時。 */
		const [settled] = await harness.ctx.db.select().from(mediaVariants).where(eq(mediaVariants.id, asset.variantId));
		expect(settled?.distributionSettledAt).not.toBeNull();
	});

	it("裝置不能下載不在自己目標狀態裡的檔案", async () => {
		const inUse = await createReadyAsset(harness, owner.id, "video", "有派送的素材");
		const unrelated = await createReadyAsset(harness, owner.id, "image", "沒有派送的素材");

		const layout = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name: "只用一個素材", description: null, canvas: { width: 1920, height: 1080 } }
		});
		const layoutId = layout.json().id;
		await harness.app.inject({ method: "PATCH", url: harness.url(`/layouts/${layoutId}`), headers: { cookie }, payload: { draft: singleAssetDocument(inUse.assetId) } });
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		const device = await pairDevice(harness, cookie, "受限裝置", layoutId);

		const forbidden = await harness.app.inject({ method: "GET", url: harness.url(`/device/assets/${unrelated.variantId}/url`), headers: { authorization: device.authorization } });
		expect(forbidden.statusCode).toBe(403);

		/** 產物被回收之後，即使還留在目標狀態裡也不能再簽出網址。 */
		await harness.ctx.db.update(mediaVariants).set({ available: false, removedAt: new Date() }).where(eq(mediaVariants.id, inUse.variantId));
		const unavailable = await harness.app.inject({ method: "GET", url: harness.url(`/device/assets/${inUse.variantId}/url`), headers: { authorization: device.authorization } });
		expect(unavailable.statusCode).toBe(409);
		expect(unavailable.json().code).toBe("asset_unavailable");
	});

	it("被引用的素材不能刪除，未被引用的可以，而且物件會一起清掉", async () => {
		const asset = await createReadyAsset(harness, owner.id, "image", "海報");
		const layout = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name: "海報版面", description: null, canvas: { width: 1920, height: 1080 } }
		});
		const layoutId = layout.json().id;
		await harness.app.inject({ method: "PATCH", url: harness.url(`/layouts/${layoutId}`), headers: { cookie }, payload: { draft: singleAssetDocument(asset.assetId, "image") } });
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		const device = await pairDevice(harness, cookie, "海報裝置", layoutId);

		const usage = await harness.app.inject({ method: "GET", url: harness.url(`/media/${asset.assetId}/usage`), headers: { cookie } });
		expect(usage.json().layouts).toEqual([{ id: layoutId, name: "海報版面", published: true }]);
		expect(usage.json().devices.map((entry: { id: string }) => entry.id)).toContain(device.deviceId);

		const blocked = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/${asset.assetId}`), headers: { cookie } });
		expect(blocked.statusCode).toBe(409);
		expect(blocked.json().code).toBe("asset_in_use");
		expect(blocked.json().details.layouts[0]).toMatchObject({ id: layoutId, published: true });
		expect(blocked.json().details.devices).toHaveLength(1);

		const free = await createReadyAsset(harness, owner.id, "image", "沒人用的素材");
		const removed = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/${free.assetId}`), headers: { cookie } });
		expect(removed.statusCode).toBe(200);
		expect(await harness.ctx.storage.head(free.objectKey)).toBeNull();

		const missing = await harness.app.inject({ method: "GET", url: harness.url(`/media/${free.assetId}`), headers: { cookie } });
		expect(missing.statusCode).toBe(404);
	});

	it("素材列表支援種類、狀態與名稱篩選，並附上簽章的縮圖網址", async () => {
		const video = await createReadyAsset(harness, owner.id, "video", "宣傳影片");
		await createReadyAsset(harness, owner.id, "image", "宣傳海報");
		await harness.ctx.db.insert(mediaVariants).values({
			assetId: video.assetId,
			role: "thumbnail",
			objectKey: `${video.objectKey}-thumb`,
			contentType: "image/png",
			sizeBytes: 10,
			sha256: "0".repeat(64),
			available: true
		});

		const all = await harness.app.inject({ method: "GET", url: harness.url("/media"), headers: { cookie } });
		expect(all.json().total).toBe(2);

		const onlyVideos = await harness.app.inject({ method: "GET", url: harness.url("/media?kind=video"), headers: { cookie } });
		expect(onlyVideos.json().total).toBe(1);
		expect(onlyVideos.json().items[0].thumbnailUrl).toContain("X-Amz-Signature");

		const byName = await harness.app.inject({ method: "GET", url: harness.url("/media?search=海報"), headers: { cookie } });
		expect(byName.json().total).toBe(1);
		expect(byName.json().items[0].name).toBe("宣傳海報");
	});
});
