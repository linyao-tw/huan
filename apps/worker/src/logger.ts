import type { Logger, LoggerOptions } from "pino";
import pino from "pino";

export type WorkerLogger = Logger;

/**
 * 建立 Worker 的根 logger。
 *
 * `redact` 不是裝飾用的：簽章網址的查詢字串帶著 AWS 簽章與過期時間，
 * 一旦寫進日誌就等於把可用的下載憑證留在檔案裡。Worker 只記錄物件鍵，
 * 這裡再加一層保險，避免將來有人不小心把整個 URL 塞進日誌欄位。
 */
export function createLogger(level: LoggerOptions["level"], destination?: LoggerOptions["transport"]): WorkerLogger {
	return pino({
		level,
		base: { service: "huan-worker", pid: process.pid },
		redact: {
			paths: ["url", "signedUrl", "downloadUrl", "*.url", "*.signedUrl", "*.downloadUrl"],
			remove: true
		},
		transport: destination
	});
}
