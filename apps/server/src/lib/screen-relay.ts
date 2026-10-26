/**
 * 即時畫面的中繼站：每台裝置只留最新的一張截圖，放在記憶體裡。
 *
 * 不寫進資料庫或 RustFS：截圖幾秒後就沒有價值，存下來只是多一份要清的東西，
 * 也多一份「螢幕上顯示過什麼」的紀錄要保護。Server 重啟就消失也無所謂，
 * 後台下一次輪詢會重新叫醒裝置。
 */
export interface ScreenFrame {
	jpeg: Buffer;
	capturedAt: Date;
}

/** 後台停止輪詢後，裝置還會再傳這麼久才停。比輪詢間隔長一截，網路抖一下不會讓畫面斷掉。 */
const WATCH_WINDOW_MS = 10_000;
/** 同一台裝置兩次叫醒之間至少隔這麼久，免得每一次輪詢都推一則 WebSocket。 */
const NUDGE_INTERVAL_MS = 3_000;
/** 超過這個時間的截圖不再給後台看，寧可顯示「等待畫面」也不要把舊畫面當成即時的。 */
export const SCREEN_FRAME_MAX_AGE_MS = 15_000;

interface Entry {
	frame: ScreenFrame | null;
	watchUntil: number;
	nudgedAt: number;
}

export class ScreenRelay {
	private readonly entries = new Map<string, Entry>();

	constructor(private readonly now: () => number = Date.now) {}

	private entry(deviceId: string): Entry {
		let entry = this.entries.get(deviceId);
		if (!entry) {
			entry = { frame: null, watchUntil: 0, nudgedAt: 0 };
			this.entries.set(deviceId, entry);
		}
		return entry;
	}

	/**
	 * 後台要看畫面。回傳是否該推一則 `screen_watch` 給裝置。
	 *
	 * 除了「剛開始看」，最近一張截圖太舊時也要再推：裝置的上傳迴圈可能因為斷線停了，
	 * 只在開始時推一次的話，畫面會永遠卡在「等待中」。
	 */
	watch(deviceId: string): boolean {
		const now = this.now();
		const entry = this.entry(deviceId);
		const wasIdle = entry.watchUntil <= now;
		entry.watchUntil = now + WATCH_WINDOW_MS;
		const stale = !entry.frame || now - entry.frame.capturedAt.getTime() > NUDGE_INTERVAL_MS;
		if ((wasIdle || stale) && now - entry.nudgedAt >= NUDGE_INTERVAL_MS) {
			entry.nudgedAt = now;
			return true;
		}
		return false;
	}

	latest(deviceId: string): ScreenFrame | null {
		const frame = this.entries.get(deviceId)?.frame ?? null;
		if (!frame || this.now() - frame.capturedAt.getTime() > SCREEN_FRAME_MAX_AGE_MS) return null;
		return frame;
	}

	/** 裝置送來一張截圖。沒人在看時直接丟掉並告訴裝置停下來。 */
	store(deviceId: string, jpeg: Buffer): boolean {
		const entry = this.entries.get(deviceId);
		if (!entry || entry.watchUntil <= this.now()) {
			this.forget(deviceId);
			return false;
		}
		entry.frame = { jpeg, capturedAt: new Date(this.now()) };
		return true;
	}

	forget(deviceId: string): void {
		this.entries.delete(deviceId);
	}
}
