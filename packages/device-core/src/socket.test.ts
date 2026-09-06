import type { ServerToDeviceMessage } from "@huan/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceSocket, reconnectDelay, type SocketFactory, type SocketHandle } from "./socket.js";

class FakeSocket implements SocketHandle {
	sent: string[] = [];
	closed = false;
	terminated = false;
	private openListeners: (() => void)[] = [];
	private messageListeners: ((data: string) => void)[] = [];
	private closeListeners: ((code: number, reason: string) => void)[] = [];
	private errorListeners: ((error: Error) => void)[] = [];

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
	}

	terminate(): void {
		this.terminated = true;
	}

	onOpen(listener: () => void): void {
		this.openListeners.push(listener);
	}

	onMessage(listener: (data: string) => void): void {
		this.messageListeners.push(listener);
	}

	onClose(listener: (code: number, reason: string) => void): void {
		this.closeListeners.push(listener);
	}

	onError(listener: (error: Error) => void): void {
		this.errorListeners.push(listener);
	}

	emitOpen(): void {
		for (const listener of this.openListeners) listener();
	}

	emitMessage(data: string): void {
		for (const listener of this.messageListeners) listener(data);
	}

	emitClose(code = 1006, reason = "abnormal"): void {
		for (const listener of this.closeListeners) listener(code, reason);
	}

	emitError(error: Error): void {
		for (const listener of this.errorListeners) listener(error);
	}
}

interface Harness {
	socket: DeviceSocket;
	sockets: FakeSocket[];
	headers: Record<string, string>[];
}

function createHarness(options: { random?: () => number; token?: () => string | null } = {}): Harness {
	const sockets: FakeSocket[] = [];
	const headers: Record<string, string>[] = [];
	const factory: SocketFactory = (_url, requestHeaders) => {
		headers.push(requestHeaders);
		const socket = new FakeSocket();
		sockets.push(socket);
		return socket;
	};
	const socket = new DeviceSocket({
		url: "ws://server.test/api/v1/devices/socket",
		token: options.token ?? (() => "device.secret"),
		factory,
		random: options.random ?? (() => 0.5),
		pingIntervalMs: 1_000,
		pongTimeoutMs: 500
	});
	return { socket, sockets, headers };
}

/** `connect()` 是 async（要先取憑證），所以每次觸發連線後都要讓 microtask 跑完。 */
async function flush(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("reconnectDelay", () => {
	it("指數成長並在 60 秒封頂", () => {
		const exact = (attempt: number): number => reconnectDelay(attempt, () => 0.5);
		expect(exact(0)).toBe(1_000);
		expect(exact(1)).toBe(2_000);
		expect(exact(2)).toBe(4_000);
		expect(exact(6)).toBe(60_000);
		expect(exact(30)).toBe(60_000);
	});

	it("加上抖動之後仍然有界", () => {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const low = reconnectDelay(attempt, () => 0);
			const high = reconnectDelay(attempt, () => 1);
			const middle = reconnectDelay(attempt, () => 0.5);
			expect(low).toBeGreaterThanOrEqual(750);
			expect(high).toBeLessThanOrEqual(75_000);
			expect(low).toBeLessThan(middle);
			expect(middle).toBeLessThan(high);
		}
	});

	it("同一個 attempt 在不同亂數下會散開，整排看板才不會同一秒一起重連", () => {
		const delays = new Set([0.1, 0.3, 0.5, 0.7, 0.9].map(value => reconnectDelay(5, () => value)));
		expect(delays.size).toBe(5);
	});
});

describe("DeviceSocket", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("帶上 Bearer 憑證並在連線後回報上線", async () => {
		const harness = createHarness();
		harness.socket.start();
		await flush();
		expect(harness.headers[0]?.authorization).toBe("Bearer device.secret");

		harness.sockets[0]?.emitOpen();
		expect(harness.socket.online).toBe(true);
		harness.socket.stop();
	});

	it("斷線後以指數退避重連", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		const scheduled: number[] = [];
		harness.socket.events.on("reconnect", info => scheduled.push(info.delayMs));

		harness.socket.start();
		await flush();
		harness.sockets[0]?.emitOpen();
		harness.sockets[0]?.emitClose();
		expect(scheduled).toEqual([1_000]);

		vi.advanceTimersByTime(1_000);
		await flush();
		expect(harness.sockets).toHaveLength(2);
		harness.sockets[1]?.emitClose();
		expect(scheduled).toEqual([1_000, 2_000]);

		vi.advanceTimersByTime(2_000);
		await flush();
		harness.sockets[2]?.emitClose();
		expect(scheduled).toEqual([1_000, 2_000, 4_000]);

		harness.socket.stop();
	});

	it("連線成功後退避重新歸零", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		const scheduled: number[] = [];
		harness.socket.events.on("reconnect", info => scheduled.push(info.delayMs));

		harness.socket.start();
		await flush();
		harness.sockets[0]?.emitClose();
		vi.advanceTimersByTime(1_000);
		await flush();
		harness.sockets[1]?.emitOpen();
		harness.sockets[1]?.emitClose();

		expect(scheduled).toEqual([1_000, 1_000]);
		harness.socket.stop();
	});

	it("靜靜丟掉不符合協定的訊息，不中斷連線", async () => {
		const harness = createHarness();
		const received: ServerToDeviceMessage[] = [];
		const invalid: string[] = [];
		harness.socket.events.on("message", message => received.push(message));
		harness.socket.events.on("invalid", info => invalid.push(info.raw));

		harness.socket.start();
		await flush();
		harness.sockets[0]?.emitOpen();
		harness.sockets[0]?.emitMessage("這不是 JSON");
		harness.sockets[0]?.emitMessage(JSON.stringify({ type: "未知的訊息" }));
		harness.sockets[0]?.emitMessage(JSON.stringify({ type: "desired_state_changed", version: 42 }));

		expect(invalid).toHaveLength(2);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ type: "desired_state_changed", version: 42 });
		expect(harness.socket.online).toBe(true);
		harness.socket.stop();
	});

	it("送出 ping 之後等不到 pong 就判定連線已死", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.socket.start();
		await flush();
		harness.sockets[0]?.emitOpen();

		vi.advanceTimersByTime(1_000);
		expect(harness.sockets[0]?.sent).toEqual([JSON.stringify({ type: "ping" })]);

		vi.advanceTimersByTime(500);
		expect(harness.sockets[0]?.terminated).toBe(true);

		vi.advanceTimersByTime(1_000);
		await flush();
		expect(harness.sockets).toHaveLength(2);
		harness.socket.stop();
	});

	it("收到 pong 之後不會誤判斷線", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.socket.start();
		await flush();
		harness.sockets[0]?.emitOpen();

		vi.advanceTimersByTime(1_000);
		harness.sockets[0]?.emitMessage(JSON.stringify({ type: "pong", serverTime: "2026-01-01T00:00:00.000Z" }));
		vi.advanceTimersByTime(500);

		expect(harness.sockets[0]?.terminated).toBe(false);
		harness.socket.stop();
	});

	it("沒有憑證時不重連，因為那不是網路問題", async () => {
		const harness = createHarness({ token: () => null });
		harness.socket.start();
		await flush();
		expect(harness.sockets).toHaveLength(0);
		expect(harness.socket.status).toBe("idle");
	});

	it("底層丟出的錯誤變成事件，不會往上炸", async () => {
		const harness = createHarness();
		const failures: string[] = [];
		harness.socket.events.on("failure", info => failures.push(info.message));
		harness.socket.start();
		await flush();
		expect(() => harness.sockets[0]?.emitError(new Error("ECONNRESET"))).not.toThrow();
		expect(failures).toEqual(["ECONNRESET"]);
		harness.socket.stop();
	});
});
