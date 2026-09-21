import { basename, extname } from "node:path";

export interface TelemetryConfig {
	enabled: boolean;
	serviceName: string;
	/** 停用時的原因，啟動日誌會印出來，讓「為什麼 Grafana 上沒東西」有答案可查。 */
	reason: string | null;
}

function isTruthy(value: string | undefined): boolean {
	return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

/**
 * 從環境變數決定要不要啟用。
 *
 * 沒有設定 OTLP 端點就完全不啟用，而不是退回預設的 localhost:4318：自架的人大多沒有
 * 收件端，SDK 會每隔幾秒對著一個不存在的位址重試，日誌裡只剩一堆連線失敗。
 * 變數名稱沿用 OpenTelemetry 的標準名稱，任何熟悉 OTel 的人都知道該怎麼設。
 */
export function resolveTelemetryConfig(env: Record<string, string | undefined>, defaults: { serviceName: string }): TelemetryConfig {
	const serviceName = env.OTEL_SERVICE_NAME?.trim() || defaults.serviceName;
	if (isTruthy(env.OTEL_SDK_DISABLED)) return { enabled: false, serviceName, reason: "OTEL_SDK_DISABLED 已設定" };

	const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
	if (!endpoint) return { enabled: false, serviceName, reason: "沒有設定 OTEL_EXPORTER_OTLP_ENDPOINT" };

	return { enabled: true, serviceName, reason: null };
}

/**
 * 這個行程是不是某個 app 的主程式。
 *
 * 埋點是用 `NODE_OPTIONS=--import` 掛上去的，同一個容器裡的每一個 node 行程都會載入它：
 * 啟動前跑的 migration、Docker 健康檢查的 `node -e`。那些行程不該開 SDK——健康檢查
 * 每十五秒一次，每次都會送出一批空資料。只有主程式（`main.js`、開發時的 `main.ts`）才啟用。
 */
export function isEntrypoint(argv1: string | undefined, name: string): boolean {
	if (!argv1) return false;
	const file = basename(argv1);
	return file.slice(0, file.length - extname(file).length) === name;
}
