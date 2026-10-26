import { checkEnvironment, createHarness, createUser, login, pairDevice, type SeededUser, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 即時畫面整合測試：${environment.reason}`);

/** 最小的「看起來像 JPEG」內容：伺服器只檢查檔頭，不解碼。 */
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

suite("裝置即時畫面", () => {
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

	async function upload(body: Buffer) {
		return harness.app.inject({ method: "PUT", url: harness.url("/device/screen"), headers: { authorization, "content-type": "image/jpeg" }, payload: body });
	}

	it("沒人在看時裝置被告知停下，有人看了才收截圖並交給後台", async () => {
		const idle = await upload(FAKE_JPEG);
		expect(idle.statusCode).toBe(200);
		expect(idle.json()).toEqual({ watching: false });

		const waiting = await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}/screen`), headers: { cookie } });
		expect(waiting.statusCode).toBe(204);

		const accepted = await upload(FAKE_JPEG);
		expect(accepted.json()).toEqual({ watching: true });

		const frame = await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}/screen`), headers: { cookie } });
		expect(frame.statusCode).toBe(200);
		expect(frame.headers["content-type"]).toBe("image/jpeg");
		expect(frame.headers["cache-control"]).toBe("no-store");
		expect(frame.rawPayload.equals(FAKE_JPEG)).toBe(true);
	});

	it("不是 JPEG 的內容一律拒絕", async () => {
		await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}/screen`), headers: { cookie } });
		const rejected = await upload(Buffer.from("<html>not an image</html>"));
		expect(rejected.statusCode).toBe(415);
	});

	it("看不到別人的裝置畫面", async () => {
		const other = await createUser(harness, { role: "user" });
		const otherCookie = await login(harness, other.email, other.password);
		const response = await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}/screen`), headers: { cookie: otherCookie } });
		expect(response.statusCode).toBe(404);
	});
});
