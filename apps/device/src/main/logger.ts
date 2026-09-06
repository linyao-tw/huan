import type { Logger } from "@huan/device-core";

/**
 * 播放器的日誌走 stdout，由作業系統的服務管理員收集。
 *
 * 絕不記錄裝置憑證或簽章網址：後者的查詢字串本身就是憑證，
 * 一旦寫進日誌，任何能讀日誌的人都能直接下載素材。
 */
export function createConsoleLogger(): Logger {
	const write = (level: string, message: string, fields?: Record<string, unknown>): void => {
		const line = { time: new Date().toISOString(), level, message, ...fields };
		process.stdout.write(`${JSON.stringify(line)}\n`);
	};
	return {
		debug: (message, fields) => write("debug", message, fields),
		info: (message, fields) => write("info", message, fields),
		warn: (message, fields) => write("warn", message, fields),
		error: (message, fields) => write("error", message, fields)
	};
}
