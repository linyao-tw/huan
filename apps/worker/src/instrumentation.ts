import { isEntrypoint, startTelemetry } from "@huan/telemetry";

/**
 * OpenTelemetry 的進入點，用 `node --import` 在 Worker 之前載入（見 Dockerfile 的 NODE_OPTIONS）。
 *
 * 容器的健康檢查也會載入這個檔案，只有主程式才真的啟動。
 */
if (isEntrypoint(process.argv[1], "main")) {
	await startTelemetry({
		serviceName: "huan-worker",
		...(process.env.HUAN_VERSION ? { serviceVersion: process.env.HUAN_VERSION } : {})
	});
}
