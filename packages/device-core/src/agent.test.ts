import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeviceAgent } from "./agent.js";
import type { CredentialStore } from "./credentials.js";
import { createStubFetch, FakeClock, jsonResponse, makeDesiredState } from "./fixtures.js";
import type { SocketFactory } from "./socket.js";
import type { PlatformInfoProvider } from "./types.js";

function memoryCredentials(): CredentialStore {
	let secret: string | null = null;
	return {
		get: async () => secret,
		set: async value => {
			secret = value;
		},
		clear: async () => {
			secret = null;
		}
	};
}

/** 不真的連線的 WebSocket：永遠不觸發 onOpen，測試才不會多跑一輪 socket 同步。 */
const noopSocketFactory: SocketFactory = () => ({
	send: () => {},
	close: () => {},
	terminate: () => {},
	onOpen: () => {},
	onMessage: () => {},
	onClose: () => {},
	onError: () => {}
});

const platform: PlatformInfoProvider = {
	read: async () => ({ platform: "linux", arch: "arm64", osVersion: "test", displays: [], temperatureCelsius: null, uptimeSeconds: null })
};

describe("DeviceAgent 配對後自動接上運作", () => {
	let dir: string;
	let agent: DeviceAgent | undefined;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "huan-agent-"));
	});

	afterEach(async () => {
		await agent?.stop();
		await rm(dir, { recursive: true, force: true });
	});

	it("autoPair=false 時，pair() 成功後要自己進入 running 並跑完首次同步", async () => {
		const deviceId = randomUUID();
		const fetch = createStubFetch(request => {
			if (request.url.endsWith("/device/pairing/start")) {
				return jsonResponse({ code: "ABCD2345", pairingToken: "tok-123", expiresAt: "2026-01-01T00:10:00.000Z", pairingUrl: "https://huan.example/pair?code=ABCD2345" }, 201);
			}
			if (request.url.includes("/device/pairing/status")) {
				return jsonResponse({ status: "paired", deviceId, deviceName: "門口電視", credential: "secret-xyz" });
			}
			if (request.url.endsWith("/device/state")) {
				return jsonResponse(makeDesiredState({ deviceId, version: 1 }));
			}
			return null;
		});

		agent = new DeviceAgent({
			appDataDir: dir,
			serverUrl: "https://huan.example",
			deviceName: "門口電視",
			appVersion: "0.1.0",
			platform,
			credentials: memoryCredentials(),
			fetch,
			socketFactory: noopSocketFactory,
			clock: new FakeClock(new Date("2026-01-01T00:00:00.000Z")),
			sleep: async () => {},
			autoPair: false
		});

		// Electron 播放器的流程：start() 因未配對而提前返回，配對由 UI 直接呼叫 pair()。
		await agent.start();
		expect(agent.status).toBe("unpaired");

		const result = await agent.pair({ pollIntervalMs: 1 });
		expect(result?.deviceId).toBe(deviceId);

		// 迴歸重點：配對成功後不該卡在 pairing，要自己接上運作迴圈。
		expect(agent.status).toBe("running");
		// 首次同步確實發生了：抓過 desired state 並啟用 v1。
		expect(fetch.calls.some(call => call.url.endsWith("/device/state"))).toBe(true);
		expect(agent.activeVersion).toBe(1);
	});
});
