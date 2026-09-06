import { ServerToDeviceMessageSchema, type DeviceToServerMessage, type ServerToDeviceMessage } from "@huan/protocol";
import { backoffDelay, type BackoffOptions } from "@huan/shared";
import WebSocket from "ws";
import { TypedEmitter } from "./events.js";
import { describeError, silentLogger, type Logger } from "./logger.js";

/**
 * WebSocket 的最小抽象。
 *
 * 把 `ws` 關在這一層之後，測試可以塞進一個純記憶體的假連線，
 * 不需要真的開 socket，也不需要在單元測試裡跑一個伺服器。
 */
export interface SocketHandle {
	send(data: string): void;
	close(): void;
	terminate(): void;
	onOpen(listener: () => void): void;
	onMessage(listener: (data: string) => void): void;
	onClose(listener: (code: number, reason: string) => void): void;
	onError(listener: (error: Error) => void): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketHandle;

export function createWebSocketFactory(): SocketFactory {
	return (url, headers) => {
		const socket = new WebSocket(url, { headers });
		return {
			send: data => socket.send(data),
			close: () => socket.close(),
			terminate: () => socket.terminate(),
			onOpen: listener => socket.on("open", listener),
			onMessage: listener => socket.on("message", (data: WebSocket.RawData) => listener(rawDataToString(data))),
			onClose: listener => socket.on("close", (code: number, reason: Buffer) => listener(code, reason.toString("utf8"))),
			onError: listener => socket.on("error", listener)
		};
	};
}

function rawDataToString(data: WebSocket.RawData): string {
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
	return data.toString("utf8");
}

/** 斷線重連的退避參數。上限 60 秒是 AGENTS.md 訂下的協定行為。 */
export const SOCKET_BACKOFF: Required<BackoffOptions> = { baseMs: 1_000, maxMs: 60_000, jitterRatio: 0.25 };

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
	return backoffDelay(attempt, SOCKET_BACKOFF, random);
}

export type DeviceSocketStatus = "idle" | "connecting" | "open" | "waiting";

export interface DeviceSocketEvents extends Record<string, unknown> {
	status: DeviceSocketStatus;
	open: undefined;
	close: { code: number; reason: string };
	message: ServerToDeviceMessage;
	/** 收到不符合協定的訊息。丟掉並記錄，不中斷連線。 */
	invalid: { raw: string };
	failure: { message: string };
	reconnect: { attempt: number; delayMs: number };
}

export interface DeviceSocketOptions {
	url: string;
	/** 每次重連都重新取得，解除綁定後回 `null` 就會停止重連。 */
	token: () => Promise<string | null> | string | null;
	factory?: SocketFactory;
	logger?: Logger;
	random?: () => number;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
}

/**
 * 裝置端 WebSocket。
 *
 * 三個不可妥協的性質：
 * 1. 永遠不把例外丟回呼叫端 —— 網路壞掉不是播放器該崩潰的理由。
 * 2. 收到的每一格都先過 `ServerToDeviceMessageSchema`，不合就靜靜丟掉。
 * 3. 重連一律指數退避加抖動；整個賣場同時斷線時不能在同一秒一起回來把伺服器再打掛。
 */
export class DeviceSocket {
	readonly events: TypedEmitter<DeviceSocketEvents>;

	private readonly url: string;
	private readonly token: () => Promise<string | null> | string | null;
	private readonly factory: SocketFactory;
	private readonly logger: Logger;
	private readonly random: () => number;
	private readonly pingIntervalMs: number;
	private readonly pongTimeoutMs: number;

	private handle: SocketHandle | null = null;
	private running = false;
	private attempt = 0;
	private state: DeviceSocketStatus = "idle";
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	/** 每次連線用一個新的代號，讓遲到的事件回呼認得出自己已經過期。 */
	private generation = 0;

	constructor(options: DeviceSocketOptions) {
		this.url = options.url;
		this.token = options.token;
		this.factory = options.factory ?? createWebSocketFactory();
		this.logger = options.logger ?? silentLogger;
		this.random = options.random ?? Math.random;
		this.pingIntervalMs = options.pingIntervalMs ?? 25_000;
		this.pongTimeoutMs = options.pongTimeoutMs ?? 10_000;
		this.events = new TypedEmitter<DeviceSocketEvents>(this.logger);
	}

	get status(): DeviceSocketStatus {
		return this.state;
	}

	get online(): boolean {
		return this.state === "open";
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.attempt = 0;
		void this.connect();
	}

	stop(): void {
		this.running = false;
		this.generation += 1;
		this.clearTimers();
		this.closeHandle();
		this.setStatus("idle");
	}

	send(message: DeviceToServerMessage): boolean {
		if (!this.handle || this.state !== "open") return false;
		try {
			this.handle.send(JSON.stringify(message));
			return true;
		} catch (error) {
			this.logger.warn("WebSocket 送出訊息失敗", { error: describeError(error) });
			return false;
		}
	}

	private async connect(): Promise<void> {
		if (!this.running) return;
		this.setStatus("connecting");

		let token: string | null;
		try {
			token = await this.token();
		} catch (error) {
			this.events.emit("failure", { message: describeError(error) });
			token = null;
		}
		if (!this.running) return;
		if (!token) {
			// 沒有憑證代表尚未配對或已解除綁定。這不是網路問題，重連毫無意義。
			this.logger.debug("沒有裝置憑證，暫停 WebSocket 連線");
			this.setStatus("idle");
			this.running = false;
			return;
		}

		const generation = ++this.generation;
		let handle: SocketHandle;
		try {
			handle = this.factory(this.url, { authorization: `Bearer ${token}` });
		} catch (error) {
			this.events.emit("failure", { message: describeError(error) });
			this.scheduleReconnect();
			return;
		}
		this.handle = handle;

		handle.onOpen(() => {
			if (generation !== this.generation) return;
			this.attempt = 0;
			this.setStatus("open");
			this.events.emit("open", undefined);
			this.startPing();
		});

		handle.onMessage(data => {
			if (generation !== this.generation) return;
			this.handleMessage(data);
		});

		handle.onClose((code, reason) => {
			if (generation !== this.generation) return;
			this.handle = null;
			this.clearPingTimers();
			this.events.emit("close", { code, reason });
			this.scheduleReconnect();
		});

		handle.onError(error => {
			if (generation !== this.generation) return;
			this.events.emit("failure", { message: describeError(error) });
		});
	}

	private handleMessage(raw: string): void {
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			this.events.emit("invalid", { raw });
			return;
		}
		const parsed = ServerToDeviceMessageSchema.safeParse(payload);
		if (!parsed.success) {
			// 不認得的訊息一律丟掉。舊版裝置遇到新版伺服器的新訊息時必須能繼續運作。
			this.events.emit("invalid", { raw });
			return;
		}
		// 任何一格都算對方還活著，不只是 pong。
		this.clearPongTimer();
		this.events.emit("message", parsed.data);
	}

	private startPing(): void {
		this.clearPingTimers();
		this.pingTimer = setInterval(() => {
			if (this.state !== "open") return;
			if (this.pongTimer) return;
			const sent = this.send({ type: "ping" });
			if (!sent) return;
			this.pongTimer = setTimeout(() => {
				// TCP 可以在對端已死的情況下維持很久不報錯，只有應用層的 pong 能揭穿它。
				this.logger.warn("等不到 pong，判定連線已死並重連");
				this.pongTimer = null;
				this.dropConnection();
			}, this.pongTimeoutMs);
		}, this.pingIntervalMs);
	}

	private dropConnection(): void {
		const handle = this.handle;
		this.handle = null;
		this.clearPingTimers();
		try {
			handle?.terminate();
		} catch (error) {
			this.logger.debug("終止 WebSocket 時發生錯誤", { error: describeError(error) });
		}
		this.events.emit("close", { code: 4000, reason: "pong timeout" });
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (!this.running) {
			this.setStatus("idle");
			return;
		}
		if (this.reconnectTimer) return;
		const delayMs = reconnectDelay(this.attempt, this.random);
		this.attempt += 1;
		this.setStatus("waiting");
		this.events.emit("reconnect", { attempt: this.attempt, delayMs });
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.connect();
		}, delayMs);
	}

	private setStatus(status: DeviceSocketStatus): void {
		if (this.state === status) return;
		this.state = status;
		this.events.emit("status", status);
	}

	private closeHandle(): void {
		const handle = this.handle;
		this.handle = null;
		try {
			handle?.close();
		} catch (error) {
			this.logger.debug("關閉 WebSocket 時發生錯誤", { error: describeError(error) });
		}
	}

	private clearPongTimer(): void {
		if (this.pongTimer) {
			clearTimeout(this.pongTimer);
			this.pongTimer = null;
		}
	}

	private clearPingTimers(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
		this.clearPongTimer();
	}

	private clearTimers(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.clearPingTimers();
	}
}
