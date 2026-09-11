import { checkEnvironment, createHarness, createReadyAsset, createUser, login, pairDevice, singleAssetDocument, type SeededUser, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] WebSocket 整合測試：${environment.reason}`);

interface TestSocket {
	send(data: string): void;
	close(): void;
	on(event: string, listener: (...args: unknown[]) => void): void;
	once(event: string, listener: (...args: unknown[]) => void): void;
}

function nextMessage(socket: TestSocket, timeoutMs = 5_000): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("等待 WebSocket 訊息逾時")), timeoutMs);
		socket.once("message", (raw: unknown) => {
			clearTimeout(timer);
			resolve(JSON.parse(String(raw)) as Record<string, unknown>);
		});
	});
}

/** 「什麼都沒收到」也要能斷言：逾時沒訊息就回 null，收到就把那筆訊息交出來讓測試指出它。 */
function messageWithin(socket: TestSocket, windowMs: number): Promise<Record<string, unknown> | null> {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve(null), windowMs);
		socket.once("message", (raw: unknown) => {
			clearTimeout(timer);
			resolve(JSON.parse(String(raw)) as Record<string, unknown>);
		});
	});
}

function nextClose(socket: TestSocket, timeoutMs = 5_000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("等待 WebSocket 關閉逾時")), timeoutMs);
		socket.once("close", (code: unknown) => {
			clearTimeout(timer);
			resolve(Number(code));
		});
	});
}

suite("WebSocket 控制通道", () => {
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

	it("裝置以 Authorization header 連線、收到 hello 並能 ping/pong", async () => {
		const device = await pairDevice(harness, cookie, "WS 裝置");
		const socket = (await harness.app.injectWS("/api/v1/devices/socket", { headers: { authorization: device.authorization } })) as unknown as TestSocket;

		const hello = await nextMessage(socket);
		expect(hello).toMatchObject({ type: "hello", protocolVersion: 1 });

		socket.send(JSON.stringify({ type: "ping" }));
		expect(await nextMessage(socket)).toMatchObject({ type: "pong" });

		/** 不符合協定的訊框只會被丟掉，不能讓連線因此中斷。 */
		socket.send("這不是 JSON");
		socket.send(JSON.stringify({ type: "不存在的訊息" }));
		socket.send(JSON.stringify({ type: "ping" }));
		expect(await nextMessage(socket)).toMatchObject({ type: "pong" });

		socket.close();
	});

	it("查詢字串裡的 token 不再被接受，連線以 4401 關閉", async () => {
		/** 憑證只能走 header，不能放在會被記進日誌的網址查詢字串裡。 */
		const device = await pairDevice(harness, cookie, "WS 查詢字串裝置");
		const socket = (await harness.app.injectWS(`/api/v1/devices/socket?token=${encodeURIComponent(device.credential)}`)) as unknown as TestSocket;
		expect(await nextClose(socket)).toBe(4401);
	});

	it("沒有憑證的連線會被以 4401 關閉", async () => {
		const socket = (await harness.app.injectWS("/api/v1/devices/socket")) as unknown as TestSocket;
		expect(await nextClose(socket)).toBe(4401);
	});

	it("發布版面會把 desired_state_changed 推給連線中的裝置", async () => {
		const asset = await createReadyAsset(harness, owner.id);
		const layout = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name: "推播測試", description: null, canvas: { width: 1920, height: 1080 } }
		});
		const layoutId = layout.json().id;
		await harness.app.inject({ method: "PATCH", url: harness.url(`/layouts/${layoutId}`), headers: { cookie }, payload: { draft: singleAssetDocument(asset.assetId) } });

		const device = await pairDevice(harness, cookie, "推播裝置", layoutId);
		const socket = (await harness.app.injectWS("/api/v1/devices/socket", { headers: { authorization: device.authorization } })) as unknown as TestSocket;
		await nextMessage(socket);

		const notified = nextMessage(socket);
		const published = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		expect(published.statusCode).toBe(201);

		const message = await notified;
		expect(message).toMatchObject({ type: "desired_state_changed" });
		expect(Number(message.version)).toBeGreaterThan(0);

		socket.close();
	});

	it("重新啟動播放器的指令會透過 WebSocket 送到裝置", async () => {
		const device = await pairDevice(harness, cookie, "指令裝置");
		const socket = (await harness.app.injectWS("/api/v1/devices/socket", { headers: { authorization: device.authorization } })) as unknown as TestSocket;
		await nextMessage(socket);

		const commandPromise = nextMessage(socket);
		const response = await harness.app.inject({ method: "POST", url: harness.url(`/devices/${device.deviceId}/restart-player`), headers: { cookie } });
		expect(response.statusCode).toBe(200);

		expect(await commandPromise).toMatchObject({ type: "command", command: "restart_player" });
		socket.close();
	});

	it("Admin 以 session cookie 連線並收到裝置變更事件", async () => {
		const adminSocket = (await harness.app.injectWS("/api/v1/admin/socket", { headers: { cookie } })) as unknown as TestSocket;
		expect(await nextMessage(adminSocket)).toMatchObject({ type: "hello" });

		const changed = nextMessage(adminSocket);
		const device = await pairDevice(harness, cookie, "Admin 觀察裝置");
		expect(await changed).toMatchObject({ type: "device_changed", deviceId: device.deviceId });

		adminSocket.close();
	});

	it("Admin 的即時事件只送給資料的擁有者", async () => {
		const stranger = await createUser(harness, { role: "user" });
		const strangerCookie = await login(harness, stranger.email, stranger.password);

		const ownerSocket = (await harness.app.injectWS("/api/v1/admin/socket", { headers: { cookie } })) as unknown as TestSocket;
		const strangerSocket = (await harness.app.injectWS("/api/v1/admin/socket", { headers: { cookie: strangerCookie } })) as unknown as TestSocket;
		expect(await nextMessage(ownerSocket)).toMatchObject({ type: "hello" });
		expect(await nextMessage(strangerSocket)).toMatchObject({ type: "hello" });

		const ownerSees = nextMessage(ownerSocket);
		const strangerSees = messageWithin(strangerSocket, 1_000);
		const device = await pairDevice(harness, cookie, "只有擁有者看得到的裝置");

		expect(await ownerSees).toMatchObject({ type: "device_changed", deviceId: device.deviceId });
		/** 事件只帶 id，但「誰的螢幕在什麼時候變了」本身就是別人的營運狀況。 */
		expect(await strangerSees).toBeNull();

		ownerSocket.close();
		strangerSocket.close();
	});

	it("未登入的 Admin 連線會被關閉", async () => {
		const socket = (await harness.app.injectWS("/api/v1/admin/socket")) as unknown as TestSocket;
		expect(await nextClose(socket)).toBe(4401);
	});
});
