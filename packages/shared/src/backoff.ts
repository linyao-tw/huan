export interface BackoffOptions {
	/** 第一次重試的等待時間（毫秒）。 */
	baseMs?: number;
	/** 等待時間的上限（毫秒）。 */
	maxMs?: number;
	/** 抖動比例，0.2 代表在計算結果的 ±20% 之間隨機。 */
	jitterRatio?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
	baseMs: 1_000,
	maxMs: 60_000,
	jitterRatio: 0.25
};

/**
 * 指數退避的「無抖動」基準值，方便測試斷言。
 * `attempt` 從 0 起算：0 → base、1 → 2×base、2 → 4×base…並在 `maxMs` 封頂。
 */
export function backoffBaseDelay(attempt: number, options: BackoffOptions = {}): number {
	const { baseMs, maxMs } = { ...DEFAULT_BACKOFF, ...options };
	const raw = baseMs * 2 ** Math.max(0, attempt);
	return Math.min(raw, maxMs);
}

/**
 * 加上抖動的實際等待時間。
 *
 * 抖動不是裝飾：整個賣場的看板同時斷線時，沒有抖動就會在同一秒一起重連，
 * 把剛恢復的 Server 再打掛一次。
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}, random: () => number = Math.random): number {
	const { jitterRatio } = { ...DEFAULT_BACKOFF, ...options };
	const base = backoffBaseDelay(attempt, options);
	const offset = base * jitterRatio * (random() * 2 - 1);
	return Math.max(0, Math.round(base + offset));
}

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
