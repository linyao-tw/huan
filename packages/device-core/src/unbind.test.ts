import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceAgent } from "./agent.js";
import { FileCredentialStore } from "./credentials.js";
import { createStubFetch, jsonResponse, makeDesiredState, makeLayout, type StubRequest } from "./fixtures.js";
import { createNodePlatformInfoProvider } from "./platform.js";
import type { SocketFactory, SocketHandle } from "./socket.js";

const SERVER = "http://server.test";

class InertSocket implements SocketHandle {
	send(): void {}
	close(): void {}
	terminate(): void {}
	onOpen(): void {}
	onMessage(): void {}
	onClose(): void {}
	onError(): void {}
}

interface Harness {
	root: string;
	agent: DeviceAgent;
	credentials: FileCredentialStore;
	requests: StubRequest[];
	socketAttempts: () => number;
	setOffline: (offline: boolean) => void;
	deviceId: string;
	setUnauthorized: (unauthorized: boolean) => void;
}

async function createHarness(): Promise<Harness> {
	const root = await mkdtemp(join(tmpdir(), "huan-unbind-"));
	const deviceId = randomUUID();
	const layout = makeLayout({ name: "預設版面" });
	const desired = makeDesiredState({ deviceId, version: 1, layouts: [layout], defaultLayout: layout });

	let offline = false;
	let unauthorized = false;
	let statusPolls = 0;
	let socketAttempts = 0;
	const requests: StubRequest[] = [];

	const fetchStub = createStubFetch(request => {
		requests.push(request);
		if (offline) return null;
		if (unauthorized) return jsonResponse({ code: "unauthorized", message: "裝置憑證已撤銷" }, 401);
		if (request.url === `${SERVER}/api/v1/device/pairing/start`) {
			return jsonResponse({
				code: "ABCD2345",
				pairingToken: "pairing-token",
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
				pairingUrl: `${SERVER}/pair/ABCD2345`
			});
		}
		if (request.url === `${SERVER}/api/v1/device/pairing/status`) {
			statusPolls += 1;
			if (statusPolls === 1) return jsonResponse({ status: "pending", expiresAt: new Date(Date.now() + 300_000).toISOString() });
			return jsonResponse({ status: "paired", deviceId, deviceName: "測試看板", credential: "s3cr3t" });
		}
		if (request.url === `${SERVER}/api/v1/device/state`) return jsonResponse(desired);
		if (request.url === `${SERVER}/api/v1/device/unbind`) return jsonResponse({ ok: true });
		if (request.url === `${SERVER}/api/v1/device/heartbeat`) return jsonResponse({ desiredVersion: 1, serverTime: new Date().toISOString() });
		return null;
	});

	const socketFactory: SocketFactory = () => {
		socketAttempts += 1;
		return new InertSocket();
	};

	const credentials = new FileCredentialStore(join(root, "config", "credential"));
	const agent = new DeviceAgent({
		appDataDir: root,
		serverUrl: SERVER,
		deviceName: "測試看板",
		appVersion: "0.1.0-test",
		platform: createNodePlatformInfoProvider({ platform: "linux", arch: "arm64", displays: [], readTemperature: async () => 45 }),
		credentials,
		fetch: fetchStub,
		socketFactory,
		diskUsage: async () => ({ freeBytes: 1e12, totalBytes: 2e12 }),
		sleep: async () => {},
		autoPair: false
	});

	return {
		root,
		agent,
		credentials,
		requests,
		socketAttempts: () => socketAttempts,
		setOffline: value => {
			offline = value;
		},
		setUnauthorized: value => {
			unauthorized = value;
		},
		deviceId
	};
}

describe("裝置解除綁定", () => {
	let harness: Harness | null = null;

	afterEach(async () => {
		if (harness) {
			await harness.agent.stop();
			await rm(harness.root, { recursive: true, force: true });
		}
		harness = null;
	});

	it("離線解除綁定會立刻停止接受帳戶控制，連上線後才補做伺服器端撤銷", async () => {
		harness = await createHarness();
		const paired = await harness.agent.pair();
		expect(paired?.deviceId).toBe(harness.deviceId);
		expect(await harness.credentials.get()).toBe("s3cr3t");

		// 網路斷了，現場的人還是要能把這台看板解除綁定。
		harness.setOffline(true);
		await harness.agent.unbind();

		expect(harness.agent.revoked).toBe(true);
		expect(harness.agent.revokePending).toBe(true);
		expect(harness.agent.status).toBe("unbound");
		expect(await harness.credentials.get()).toBeNull();
		expect(await harness.agent.storage.readIdentity()).toBeNull();
		expect(await harness.agent.storage.readDesiredState()).toBeNull();
		expect(await harness.agent.storage.readActiveManifest()).toBeNull();

		// 帳戶控制已經停止：即使伺服器回來了，也不會再去取 desired state。
		harness.setOffline(false);
		const before = harness.requests.filter(request => request.url.endsWith("/device/state")).length;
		await expect(harness.agent.sync("manual")).resolves.toBeNull();
		const after = harness.requests.filter(request => request.url.endsWith("/device/state")).length;
		expect(after).toBe(before);

		// 恢復連線後補做伺服器端撤銷，而且用的是留在記憶體裡的那份憑證。
		await expect(harness.agent.tryCompleteRevoke()).resolves.toBe(true);
		const unbindRequest = harness.requests.findLast(request => request.url.endsWith("/device/unbind"));
		expect(unbindRequest?.headers.authorization).toBe(`Bearer ${harness.deviceId}.s3cr3t`);
		expect(harness.agent.revokePending).toBe(false);
		// 撤銷完成之後仍然是解除綁定狀態，不會被翻回來。
		expect(harness.agent.revoked).toBe(true);
	});

	it("解除綁定後重新啟動不會回頭接受伺服器的內容", async () => {
		harness = await createHarness();
		await harness.agent.pair();
		harness.setOffline(true);
		await harness.agent.unbind();
		harness.setOffline(false);

		const socketsBefore = harness.socketAttempts();
		await harness.agent.start();

		expect(harness.agent.status).toBe("unbound");
		// 不再開 WebSocket，也就不可能收到任何 desired_state_changed。
		expect(harness.socketAttempts()).toBe(socketsBefore);
		expect(await harness.agent.storage.readActiveManifest()).toBeNull();
	});

	it("解除綁定時同時清空本機播放檔", async () => {
		harness = await createHarness();
		await harness.agent.pair();
		const { writeFile } = await import("node:fs/promises");
		const leftover = harness.agent.storage.mediaPath("22222222-2222-4222-8222-222222222222.mp4");
		await writeFile(leftover, "上一個租戶的影片");

		await harness.agent.unbind();

		await expect(stat(leftover)).rejects.toThrow();
	});

	it("伺服器回 401 時本機自動進入解除綁定，且不需要再通知伺服器", async () => {
		harness = await createHarness();
		await harness.agent.pair();
		harness.setUnauthorized(true);

		await harness.agent.sync("manual");

		expect(harness.agent.revoked).toBe(true);
		// 伺服器已經撤銷過了，沒有待辦的撤銷。
		expect(harness.agent.revokePending).toBe(false);
		expect(await harness.credentials.get()).toBeNull();
	});

	it("重新配對會清掉解除綁定紀錄，讓裝置回到可用狀態", async () => {
		harness = await createHarness();
		await harness.agent.pair();
		harness.setOffline(true);
		await harness.agent.unbind();
		harness.setOffline(false);

		await harness.agent.pair();

		expect(harness.agent.revoked).toBe(false);
		expect(await harness.credentials.get()).toBe("s3cr3t");
		expect(await harness.agent.storage.readUnbind()).toBeNull();
	});
});
