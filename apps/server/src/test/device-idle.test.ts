import { checkEnvironment, createHarness, createReadyAsset, createUser, login, pairDevice, type SeededUser, type TestHarness } from "@/test/helpers";
import { mediaAssets } from "@huan/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 待命畫面整合測試：${environment.reason}`);

suite("裝置待命畫面", () => {
	let harness: TestHarness;
	let owner: SeededUser;
	let cookie: string;
	let deviceId: string;
	let authorization: string;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
		owner = await createUser(harness, { role: "user" });
		cookie = await login(harness, owner.email, owner.password);
		const paired = await pairDevice(harness, cookie);
		deviceId = paired.deviceId;
		authorization = paired.authorization;
	});

	async function update(payload: Record<string, unknown>, sessionCookie = cookie) {
		return harness.app.inject({ method: "PATCH", url: harness.url(`/devices/${deviceId}`), headers: { cookie: sessionCookie }, payload });
	}

	it("預設是品牌待命畫面", async () => {
		const response = await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}`), headers: { cookie } });
		expect(response.json().idle).toEqual({ mode: "brand", imageAssetId: null });
	});

	it("可以切成黑螢幕，目標狀態也跟著變", async () => {
		const response = await update({ idleMode: "black" });
		expect(response.statusCode).toBe(200);
		expect(response.json().idle.mode).toBe("black");

		const state = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization } });
		expect(state.json().idle).toEqual({ mode: "black", imageAssetId: null });
	});

	it("選圖片時圖片會一起派送給裝置", async () => {
		const asset = await createReadyAsset(harness, owner.id, "image", "Logo 牆");
		const response = await update({ idleMode: "image", idleImageAssetId: asset.assetId });
		expect(response.statusCode).toBe(200);
		expect(response.json().idleImageName).toBe("Logo 牆");

		const state = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization } });
		const body = state.json();
		expect(body.idle).toEqual({ mode: "image", imageAssetId: asset.assetId });
		/** 待命圖片沒有進任何版面，必須靠 desired state 自己把它加進下載清單。 */
		expect(body.assets.map((entry: { assetId: string }) => entry.assetId)).toContain(asset.assetId);
	});

	it("選了圖片卻沒給素材就拒絕", async () => {
		const response = await update({ idleMode: "image" });
		expect(response.statusCode).toBe(400);
	});

	it("待命圖片只能是自己的圖片素材", async () => {
		const video = await createReadyAsset(harness, owner.id, "video", "影片");
		expect((await update({ idleMode: "image", idleImageAssetId: video.assetId })).statusCode).toBe(400);

		const other = await createUser(harness, { role: "user" });
		const theirs = await createReadyAsset(harness, other.id, "image", "別人的圖");
		expect((await update({ idleMode: "image", idleImageAssetId: theirs.assetId })).statusCode).toBe(404);
	});

	it("換回其他模式時會清掉圖片，素材才刪得掉", async () => {
		const asset = await createReadyAsset(harness, owner.id, "image", "暫時的");
		await update({ idleMode: "image", idleImageAssetId: asset.assetId });

		/** 還被引用時刪不掉，而且說得出是哪一台裝置在用。 */
		const blocked = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/${asset.assetId}`), headers: { cookie } });
		expect(blocked.statusCode).toBe(409);
		expect(blocked.json().details.devices).toHaveLength(1);

		const cleared = await update({ idleMode: "black" });
		expect(cleared.json().idle).toEqual({ mode: "black", imageAssetId: null });

		const removed = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/${asset.assetId}`), headers: { cookie } });
		expect(removed.statusCode).toBe(200);
		expect(await harness.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.assetId))).toEqual([]);
	});
});
