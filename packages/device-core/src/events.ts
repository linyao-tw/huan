import { describeError, silentLogger, type Logger } from "./logger.js";

export type Unsubscribe = () => void;

/**
 * 最小的型別安全事件匯流排。
 *
 * 刻意不用 Node 的 `EventEmitter`：那個 API 的 `error` 事件在沒有監聽者時會直接 throw，
 * 而裝置引擎的每一條錯誤路徑都必須是「回報上去」而不是「把播放器炸掉」。
 * 這裡的 `emit` 也把監聽器的例外吞掉並記錄，避免某個 UI 監聽器壞掉就中斷整個同步流程。
 */
export class TypedEmitter<Events extends Record<string, unknown>> {
	private readonly listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

	constructor(private readonly logger: Logger = silentLogger) {}

	on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): Unsubscribe {
		let bucket = this.listeners[event];
		if (!bucket) {
			bucket = new Set();
			this.listeners[event] = bucket;
		}
		bucket.add(listener);
		return () => {
			bucket?.delete(listener);
		};
	}

	once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): Unsubscribe {
		const off = this.on(event, payload => {
			off();
			listener(payload);
		});
		return off;
	}

	off<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void {
		this.listeners[event]?.delete(listener);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const bucket = this.listeners[event];
		if (!bucket) return;
		for (const listener of [...bucket]) {
			try {
				listener(payload);
			} catch (error) {
				this.logger.warn("事件監聽器丟出例外", { event: String(event), error: describeError(error) });
			}
		}
	}

	removeAll(): void {
		for (const key of Object.keys(this.listeners)) {
			delete this.listeners[key];
		}
	}
}
