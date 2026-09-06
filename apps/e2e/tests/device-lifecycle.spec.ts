import { SEED_ADMIN } from "@/fixtures";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";

const API = "/api/v1";

async function loginApi(request: APIRequestContext): Promise<void> {
	const response = await request.post(`${API}/auth/login`, { data: { identifier: SEED_ADMIN.identifier, password: SEED_ADMIN.password } });
	expect(response.ok(), await response.text()).toBe(true);
}

/**
 * 這一組測試直接說裝置端的協定，不經過瀏覽器。
 *
 * 走的是 Electron 播放器與模擬裝置完全相同的 REST 端點，
 * 因此測到的是真正的配對、目標狀態與 ACK 行為。
 */
test.describe.configure({ mode: "serial" });

test.describe("裝置生命週期", () => {
	let code = "";
	let pairingToken = "";
	let deviceId = "";
	let credential = "";

	test("裝置取得配對碼", async ({ request }) => {
		const response = await request.post(`${API}/device/pairing/start`, {
			data: { deviceName: "E2E 裝置", platform: "linux", arch: "arm64", appVersion: "0.0.0-e2e", protocolVersion: 1 }
		});
		expect(response.ok(), await response.text()).toBe(true);
		const body = (await response.json()) as { code: string; pairingToken: string; pairingUrl: string };

		/** 配對碼要能被人從螢幕上抄下來，因此不含 0、O、1、I。 */
		expect(body.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
		expect(body.pairingUrl).toContain(`code=${body.code}`);
		code = body.code;
		pairingToken = body.pairingToken;
	});

	test("尚未確認前查詢狀態為 pending", async ({ request }) => {
		const response = await request.get(`${API}/device/pairing/status`, { headers: { "X-Huan-Pairing-Token": pairingToken } });
		expect(response.ok()).toBe(true);
		expect(((await response.json()) as { status: string }).status).toBe("pending");
	});

	test("管理員確認配對", async ({ request }) => {
		await loginApi(request);

		const lookup = await request.get(`${API}/pairing/${code}`);
		expect(lookup.ok()).toBe(true);
		expect(((await lookup.json()) as { deviceName: string }).deviceName).toBe("E2E 裝置");

		const confirm = await request.post(`${API}/pairing/confirm`, { data: { code, deviceName: "E2E 裝置", defaultLayoutId: null } });
		expect(confirm.ok(), await confirm.text()).toBe(true);
		deviceId = ((await confirm.json()) as { id: string }).id;
	});

	test("憑證只交付一次", async ({ request }) => {
		const first = await request.get(`${API}/device/pairing/status`, { headers: { "X-Huan-Pairing-Token": pairingToken } });
		expect(first.ok()).toBe(true);
		const body = (await first.json()) as { status: string; credential?: string };
		expect(body.status).toBe("paired");
		expect(body.credential).toBeTruthy();
		credential = body.credential ?? "";

		/** 第二次領取必須失敗：憑證外流一次就夠糟了，不能再給第二次機會。 */
		const second = await request.get(`${API}/device/pairing/status`, { headers: { "X-Huan-Pairing-Token": pairingToken } });
		expect(second.ok()).toBe(false);
	});

	test("裝置能以自己的憑證取得目標狀態", async ({ playwright }) => {
		const device = await playwright.request.newContext({ baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { Authorization: `Bearer ${credential}` } });
		const response = await device.get(`${API}/device/state`);
		expect(response.ok(), await response.text()).toBe(true);
		const state = (await response.json()) as { deviceId: string; version: number; protocolVersion: number; settings: { heartbeatIntervalSeconds: number } };
		expect(state.deviceId).toBe(deviceId);
		expect(state.protocolVersion).toBe(1);
		expect(state.settings.heartbeatIntervalSeconds).toBeGreaterThan(0);
		await device.dispose();
	});

	test("錯誤的憑證被拒絕", async ({ playwright }) => {
		const device = await playwright.request.newContext({
			baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000",
			extraHTTPHeaders: { Authorization: `Bearer ${deviceId}.not-the-real-secret` }
		});
		const response = await device.get(`${API}/device/state`);
		expect(response.status()).toBe(401);
		await device.dispose();
	});

	test("指派版面後裝置的目標版本會提高，而且素材清單帶有 SHA-256", async ({ request, playwright }) => {
		await loginApi(request);
		const layouts = await request.get(`${API}/layouts`);
		const published = ((await layouts.json()) as { items: { id: string; publishedRevisionId: string | null }[] }).items.filter(item => item.publishedRevisionId);
		expect(published.length).toBeGreaterThan(0);

		const device = await playwright.request.newContext({ baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { Authorization: `Bearer ${credential}` } });

		type DeviceState = { version: number; defaultLayout: { revisionId: string } | null; assets: { assetId: string; variantId: string; sha256: string; downloadPath: string }[] };
		let state: DeviceState | null = null;

		/**
		 * 挑一個真的會帶出素材的版面。
		 *
		 * 只放文字的版面不需要下載任何檔案，用它當目標的話，
		 * 下一個測試就會靜默跳過整條下載與校驗的路徑 —— 那正是最需要被測到的部分。
		 */
		for (const layout of published) {
			await request.patch(`${API}/devices/${deviceId}`, { data: { defaultLayoutId: layout.id } });
			const next = (await (await device.get(`${API}/device/state`)).json()) as DeviceState;
			state = next;
			if (next.assets.length > 0) break;
		}

		expect(state).not.toBeNull();
		expect(state?.version).toBeGreaterThan(0);
		expect(state?.defaultLayout).not.toBeNull();
		expect(state?.assets.length ?? 0).toBeGreaterThan(0);
		for (const asset of state?.assets ?? []) {
			expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(asset.downloadPath).toBe(`/device/assets/${asset.variantId}/url`);
		}
		await device.dispose();
	});

	test("下載素材、驗證雜湊並 ACK；雜湊不符會被拒絕", async ({ playwright }) => {
		const device = await playwright.request.newContext({ baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { Authorization: `Bearer ${credential}` } });
		const state = (await (await device.get(`${API}/device/state`)).json()) as { assets: { assetId: string; variantId: string; sha256: string; sizeBytes: number }[] };
		expect(state.assets.length).toBeGreaterThan(0);

		const asset = state.assets[0];
		if (!asset) return;

		const urlResponse = await device.get(`${API}/device/assets/${asset.variantId}/url`);
		expect(urlResponse.ok(), await urlResponse.text()).toBe(true);
		const { url } = (await urlResponse.json()) as { url: string };

		const download = await device.get(url);
		expect(download.ok()).toBe(true);
		const body = await download.body();
		const digest = createHash("sha256").update(body).digest("hex");

		/** 伺服器記的雜湊必須和實際下載到的位元組一致，否則整條信任鏈都是假的。 */
		expect(digest).toBe(asset.sha256);

		const badAck = await device.post(`${API}/device/assets/ack`, { data: { assetId: asset.assetId, variantId: asset.variantId, sha256: "0".repeat(64), sizeBytes: body.length } });
		expect(badAck.ok()).toBe(false);

		const goodAck = await device.post(`${API}/device/assets/ack`, { data: { assetId: asset.assetId, variantId: asset.variantId, sha256: digest, sizeBytes: body.length } });
		expect(goodAck.ok(), await goodAck.text()).toBe(true);
		await device.dispose();
	});

	test("回報狀態後後台看得到同步結果", async ({ request, playwright }) => {
		const device = await playwright.request.newContext({ baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { Authorization: `Bearer ${credential}` } });
		const state = (await (await device.get(`${API}/device/state`)).json()) as { version: number; defaultLayout: { revisionId: string } | null; assets: { assetId: string }[] };

		const heartbeat = await device.post(`${API}/device/heartbeat`, {
			data: {
				reported: {
					desiredVersion: state.version,
					appVersion: "0.0.0-e2e",
					protocolVersion: 1,
					platform: "linux",
					arch: "arm64",
					osVersion: null,
					displays: [{ id: "d0", label: "E2E", width: 1920, height: 1080, scaleFactor: 1, orientation: "landscape", primary: true }],
					currentLayoutRevisionId: state.defaultLayout?.revisionId ?? null,
					currentScheduleId: null,
					readyAssetIds: state.assets.map(asset => asset.assetId),
					pendingAssetIds: [],
					diskFreeBytes: 8_000_000_000,
					diskTotalBytes: 32_000_000_000,
					/** 這台模擬裝置沒有可讀的溫度來源，回報 null 而不是編一個數字。 */
					temperatureCelsius: null,
					uptimeSeconds: 1234,
					lastSyncAt: new Date().toISOString(),
					storageError: null
				}
			}
		});
		expect(heartbeat.ok(), await heartbeat.text()).toBe(true);
		await device.dispose();

		await loginApi(request);
		const detail = (await (await request.get(`${API}/devices/${deviceId}`)).json()) as {
			online: boolean;
			desiredVersion: number;
			reported: { desiredVersion: number; temperatureCelsius: number | null } | null;
		};
		expect(detail.reported).not.toBeNull();
		expect(detail.reported?.desiredVersion).toBe(detail.desiredVersion);
		expect(detail.reported?.temperatureCelsius).toBeNull();
	});

	test("解除綁定後憑證立即失效", async ({ request, playwright }) => {
		await loginApi(request);
		const response = await request.delete(`${API}/devices/${deviceId}`);
		expect(response.ok(), await response.text()).toBe(true);

		const device = await playwright.request.newContext({ baseURL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { Authorization: `Bearer ${credential}` } });
		const after = await device.get(`${API}/device/state`);
		expect(after.ok()).toBe(false);
		await device.dispose();
	});
});
