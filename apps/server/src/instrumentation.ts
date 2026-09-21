import { sanitizeLoggedUrl } from "@/lib/url-safety";
import { isEntrypoint, startTelemetry } from "@huan/telemetry";

/**
 * OpenTelemetry 的進入點，用 `node --import` 在應用程式之前載入（見 Dockerfile 的 NODE_OPTIONS）。
 *
 * 同一個容器裡的 migration 與健康檢查也會載入這個檔案，只有主程式才真的啟動。
 */
if (isEntrypoint(process.argv[1], "main")) {
	await startTelemetry({
		serviceName: "huan-server",
		...(process.env.HUAN_VERSION ? { serviceVersion: process.env.HUAN_VERSION } : {}),
		sanitizeIncomingPath: sanitizeLoggedUrl
	});
}
