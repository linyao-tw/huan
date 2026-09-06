import { describe, expect, it } from "vitest";
import { DeviceApiClient, DeviceApiError, deviceSocketUrl, joinUrl } from "./api-client.js";
import { createStubFetch, jsonResponse, makeDesiredState } from "./fixtures.js";

const SERVER = "http://server.test";

function clientWith(handler: Parameters<typeof createStubFetch>[0], token: string | null = "device.secret"): DeviceApiClient {
	return new DeviceApiClient({ baseUrl: SERVER, fetch: createStubFetch(handler), token: () => token });
}

describe("joinUrl / deviceSocketUrl", () => {
	it("不論有沒有尾斜線都拼出同一個網址", () => {
		expect(joinUrl("http://a.test/", "/api/v1", "/device/state")).toBe("http://a.test/api/v1/device/state");
		expect(joinUrl("http://a.test", "/api/v1", "device/state")).toBe("http://a.test/api/v1/device/state");
	});

	it("https 對應到 wss", () => {
		expect(deviceSocketUrl("https://huan.test")).toBe("wss://huan.test/api/v1/devices/socket");
		expect(deviceSocketUrl("http://localhost:4000")).toBe("ws://localhost:4000/api/v1/devices/socket");
	});
});

describe("DeviceApiClient", () => {
	it("送出 Bearer 憑證並以協定結構解析回應", async () => {
		const desired = makeDesiredState({ version: 12 });
		let authorization: string | undefined;
		const client = clientWith(request => {
			authorization = request.headers.authorization;
			return jsonResponse(desired);
		});

		const state = await client.getDesiredState();
		expect(state.version).toBe(12);
		expect(authorization).toBe("Bearer device.secret");
	});

	it("連不上伺服器是可重試的錯誤", async () => {
		const client = clientWith(() => null);
		await expect(client.getDesiredState()).rejects.toMatchObject({ kind: "network", retryable: true, credentialRevoked: false });
	});

	it("5xx 與 429 可重試", async () => {
		for (const status of [500, 502, 503, 429, 408]) {
			const client = clientWith(() => jsonResponse({ code: "internal", message: "壞掉了" }, status));
			await expect(client.getDesiredState()).rejects.toMatchObject({ retryable: true });
		}
	});

	it("401 與 403 代表憑證被撤銷，重試沒有意義", async () => {
		for (const status of [401, 403]) {
			const client = clientWith(() => jsonResponse({ code: "unauthorized", message: "憑證已撤銷" }, status));
			await expect(client.getDesiredState()).rejects.toMatchObject({ retryable: false, credentialRevoked: true });
		}
	});

	it("404 既不重試也不是憑證問題", async () => {
		const client = clientWith(() => jsonResponse({ code: "not_found", message: "找不到" }, 404));
		await expect(client.getDesiredState()).rejects.toMatchObject({ retryable: false, credentialRevoked: false, code: "not_found" });
	});

	it("回應不符合協定結構時明確失敗，而不是把 undefined 放進播放邏輯", async () => {
		const client = clientWith(() => jsonResponse({ version: "十二" }));
		await expect(client.getDesiredState()).rejects.toMatchObject({ kind: "protocol" });
	});

	it("沒有憑證時不會送出請求", async () => {
		const stub = createStubFetch(() => jsonResponse({ ok: true }));
		const client = new DeviceApiClient({ baseUrl: SERVER, fetch: stub, token: () => null });
		await expect(client.getDesiredState()).rejects.toBeInstanceOf(DeviceApiError);
		expect(stub.calls).toHaveLength(0);
	});

	it("配對端點不帶憑證，但帶 pairing token", async () => {
		let headers: Record<string, string> = {};
		const client = clientWith(request => {
			headers = request.headers;
			return jsonResponse({ status: "pending", expiresAt: "2026-01-01T00:00:00.000Z" });
		}, null);

		await client.pairingStatus("pairing-token");
		expect(headers["x-huan-pairing-token"]).toBe("pairing-token");
		expect(headers.authorization).toBeUndefined();
	});

	it("下載網址端點使用 manifest 給的相對路徑", async () => {
		let requestedUrl = "";
		const client = clientWith(request => {
			requestedUrl = request.url;
			return jsonResponse({ url: "https://cdn.test/x", expiresAt: "2026-01-01T00:00:00.000Z", sha256: "0".repeat(64), sizeBytes: 1 });
		});

		await client.getDownloadUrl("/device/assets/abc/url");
		expect(requestedUrl).toBe(`${SERVER}/api/v1/device/assets/abc/url`);
	});
});
