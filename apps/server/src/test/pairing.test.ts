import { checkEnvironment, createHarness, createUser, login, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 配對整合測試：${environment.reason}`);

const START_PAIRING_BODY = {
	deviceName: "大廳測試機",
	platform: "linux" as const,
	arch: "arm64" as const,
	appVersion: "0.1.0",
	protocolVersion: 1
};

suite("裝置配對", () => {
	let harness: TestHarness;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
	});

	it("從索取配對碼到裝置能夠自我驗證的完整流程", async () => {
		const owner = await createUser(harness, { role: "user" });
		const cookie = await login(harness, owner.email, owner.password);

		const started = await harness.app.inject({ method: "POST", url: harness.url("/device/pairing/start"), payload: START_PAIRING_BODY });
		expect(started.statusCode).toBe(201);
		const { code, pairingToken, pairingUrl } = started.json();
		expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
		expect(pairingUrl).toBe(`${harness.ctx.env.PUBLIC_URL}/pair?code=${code}`);

		const pending = await harness.app.inject({ method: "GET", url: harness.url("/device/pairing/status"), headers: { "x-huan-pairing-token": pairingToken } });
		expect(pending.statusCode).toBe(200);
		expect(pending.json().status).toBe("pending");

		const lookup = await harness.app.inject({ method: "GET", url: harness.url(`/pairing/${code}`), headers: { cookie } });
		expect(lookup.statusCode).toBe(200);
		expect(lookup.json()).toMatchObject({ code, deviceName: "大廳測試機", platform: "linux", arch: "arm64" });

		const confirmed = await harness.app.inject({
			method: "POST",
			url: harness.url("/pairing/confirm"),
			headers: { cookie },
			payload: { code, deviceName: "大廳主螢幕", defaultLayoutId: null }
		});
		expect(confirmed.statusCode).toBe(201);
		const device = confirmed.json();
		expect(device).toMatchObject({ name: "大廳主螢幕", status: "active" });

		const paired = await harness.app.inject({ method: "GET", url: harness.url("/device/pairing/status"), headers: { "x-huan-pairing-token": pairingToken } });
		expect(paired.statusCode).toBe(200);
		const pairedBody = paired.json();
		expect(pairedBody.status).toBe("paired");
		expect(pairedBody.deviceId).toBe(device.id);
		expect(pairedBody.credential.startsWith(`${device.id}.`)).toBe(true);

		/** 憑證只交付一次，第二次領取一律 410。 */
		const again = await harness.app.inject({ method: "GET", url: harness.url("/device/pairing/status"), headers: { "x-huan-pairing-token": pairingToken } });
		expect(again.statusCode).toBe(410);
		expect(again.json().code).toBe("pairing_expired");

		const credential: string = pairedBody.credential;
		const version = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: `Bearer ${credential}` } });
		expect(version.statusCode).toBe(200);
		expect(version.json().version).toBeGreaterThanOrEqual(0);

		const state = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: `Bearer ${credential}` } });
		expect(state.statusCode).toBe(200);
		expect(state.json()).toMatchObject({ deviceId: device.id, deviceName: "大廳主螢幕", defaultLayout: null, assets: [], schedules: [] });

		const heartbeat = await harness.app.inject({
			method: "POST",
			url: harness.url("/device/heartbeat"),
			headers: { authorization: `Bearer ${credential}` },
			payload: {
				reported: {
					desiredVersion: state.json().version,
					appVersion: "0.1.0",
					protocolVersion: 1,
					platform: "linux",
					arch: "arm64",
					osVersion: "Debian 12",
					displays: [],
					currentLayoutRevisionId: null,
					currentScheduleId: null,
					readyAssetIds: [],
					pendingAssetIds: [],
					diskFreeBytes: 1_000,
					diskTotalBytes: 2_000,
					temperatureCelsius: null,
					uptimeSeconds: 10,
					lastSyncAt: null,
					storageError: null
				}
			}
		});
		expect(heartbeat.statusCode).toBe(200);
		expect(heartbeat.json()).toMatchObject({ desiredVersion: state.json().version });

		/** 裝置主動解除綁定之後，同一組憑證立刻失效。 */
		const unbind = await harness.app.inject({ method: "POST", url: harness.url("/device/unbind"), headers: { authorization: `Bearer ${credential}` } });
		expect(unbind.statusCode).toBe(200);

		const afterUnbind = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: `Bearer ${credential}` } });
		expect(afterUnbind.statusCode).toBe(401);
	});

	it("同一組配對碼不能被確認兩次", async () => {
		const owner = await createUser(harness, { role: "user" });
		const cookie = await login(harness, owner.email, owner.password);
		const started = await harness.app.inject({ method: "POST", url: harness.url("/device/pairing/start"), payload: START_PAIRING_BODY });
		const { code } = started.json();

		const first = await harness.app.inject({ method: "POST", url: harness.url("/pairing/confirm"), headers: { cookie }, payload: { code, deviceName: "第一台", defaultLayoutId: null } });
		expect(first.statusCode).toBe(201);

		const second = await harness.app.inject({ method: "POST", url: harness.url("/pairing/confirm"), headers: { cookie }, payload: { code, deviceName: "第二台", defaultLayoutId: null } });
		expect(second.statusCode).toBe(409);
		expect(second.json().code).toBe("pairing_expired");
	});

	it("偽造的裝置憑證無法通過驗證", async () => {
		const responses = await Promise.all([
			harness.app.inject({ method: "GET", url: harness.url("/device/state") }),
			harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: "Bearer not-a-valid-token" } }),
			harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: "Bearer 00000000-0000-4000-8000-000000000000.fake-secret" } })
		]);
		for (const response of responses) {
			expect(response.statusCode).toBe(401);
			expect(response.json().code).toBe("unauthorized");
		}
	});

	it("Admin 端查詢不存在的配對碼回 404", async () => {
		const owner = await createUser(harness, { role: "user" });
		const cookie = await login(harness, owner.email, owner.password);
		const response = await harness.app.inject({ method: "GET", url: harness.url("/pairing/ABCD2345"), headers: { cookie } });
		expect(response.statusCode).toBe(404);
	});
});
