export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(message: string, meta?: Record<string, unknown>): void;
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

export type LogSink = (level: LogLevel, line: string) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const defaultSink: LogSink = (level, line) => {
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
};

/**
 * 裝置日誌是現場排障唯一的線索，但它同時也是最容易外流的東西：
 * 使用者會直接把整個檔案貼進支援單。
 *
 * 因此呼叫端不得把裝置憑證、簽章網址或其查詢字串放進 `meta`，
 * 本模組也刻意不提供「把整個物件倒出來」的捷徑，逼呼叫端挑選要記錄的欄位。
 */
export function createConsoleLogger(minimum: LogLevel = "info", sink: LogSink = defaultSink): Logger {
	const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
		if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimum]) return;
		const timestamp = new Date().toISOString();
		const suffix = meta && Object.keys(meta).length > 0 ? ` ${formatMeta(meta)}` : "";
		sink(level, `${timestamp} [${level}] ${message}${suffix}`);
	};
	return {
		debug: (message, meta) => emit("debug", message, meta),
		info: (message, meta) => emit("info", message, meta),
		warn: (message, meta) => emit("warn", message, meta),
		error: (message, meta) => emit("error", message, meta)
	};
}

export const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
};

function formatMeta(meta: Record<string, unknown>): string {
	return Object.entries(meta)
		.map(([key, value]) => `${key}=${formatValue(value)}`)
		.join(" ");
}

function formatValue(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (value instanceof Error) return JSON.stringify(value.message);
	return JSON.stringify(value);
}

/** 把 catch 到的任意值壓成一句可讀訊息，避免日誌裡出現 `[object Object]`。 */
export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (typeof error === "object") return JSON.stringify(error);
	return String(error);
}
