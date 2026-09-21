import { resolveTelemetryConfig } from "./config.js";
import type { TelemetryHandle, TelemetryOptions } from "./sdk.js";

export { isEntrypoint, resolveTelemetryConfig, type TelemetryConfig } from "./config.js";
export type { TelemetryHandle, TelemetryOptions } from "./sdk.js";

/**
 * 啟動 OpenTelemetry：trace、metric、log 都以 OTLP/HTTP 送到同一個端點。
 *
 * 一定要在應用程式的任何模組載入之前呼叫（用 `node --import` 掛上來）。自動埋點靠的是
 * 攔截模組載入：Fastify 先被載入的話，它拿到的就是還沒被包起來的 `http`。
 *
 * SDK 本身在確定要啟用後才載入。它和所有埋點加起來有上百個模組，沒設定收件端的開發環境
 * 不該為了一個用不到的功能多等那段啟動時間。
 */
export async function startTelemetry(options: TelemetryOptions): Promise<TelemetryHandle> {
	const config = resolveTelemetryConfig(options.env ?? process.env, { serviceName: options.serviceName });
	if (!config.enabled) return { enabled: false, shutdown: async () => {} };
	const { startTelemetrySdk } = await import("./sdk.js");
	return startTelemetrySdk(options, config);
}
