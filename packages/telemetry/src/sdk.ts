import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { envDetector, hostDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { createAddHookMessageChannel } from "import-in-the-middle";
import { register } from "node:module";
import { hostname } from "node:os";
import type { TelemetryConfig } from "./config.js";

export interface TelemetryOptions {
	serviceName: string;
	serviceVersion?: string;
	env?: Record<string, string | undefined>;
	/**
	 * 把進來的請求路徑洗成可以記錄的樣子。
	 *
	 * span 的 `url.path` 記的是實際路徑，不是路由樣板；路徑上帶著祕密的端點（例如後台的
	 * `/pairing/<配對碼>`）要在這裡遮掉。跟日誌的清洗規則用同一個函式，兩邊才不會一個洗了一個沒洗。
	 */
	sanitizeIncomingPath?: (path: string) => string;
}

export interface TelemetryHandle {
	enabled: boolean;
	shutdown: () => Promise<void>;
}

/** 健康檢查每十五秒一次，追蹤它只會把真正的請求淹沒在一片綠色裡。 */
const IGNORED_INCOMING_PATHS = ["/health/"];

/** 由 `startTelemetry`（index.ts）在確定要啟用後才動態載入。 */
export async function startTelemetrySdk(options: TelemetryOptions, config: TelemetryConfig): Promise<TelemetryHandle> {
	const env = options.env ?? process.env;

	/** SDK 自己出錯（例如收件端連不上）時要看得到，否則「沒有資料」和「送不出去」分不出來。 */
	diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

	/**
	 * 新版 HTTP 語意慣例：`http.server.request.duration`、`http.route`、`http.response.status_code`。
	 * 舊版名稱在各家儀表板範本裡已經不再使用，沒有理由從舊的開始。
	 */
	env.OTEL_SEMCONV_STABILITY_OPT_IN ??= "http";

	/**
	 * ESM 模組的攔截只開給埋點實際註冊過的套件（S3 用的 AWS SDK 是 ESM）。
	 * 預設的全面攔截會包住每一個模組，偶爾會弄壞匯出方式特殊的套件，出了事也很難查。
	 *
	 * 用的是 `module.register`，Node 26 會對它發淘汰警告（DEP0205）。改用同步的
	 * `registerHooks` 就得自己列出所有要攔的模組名稱（AWS SDK 的內部套件名一改就漏），
	 * 而容器用的 Node 24 沒有這個警告；升級 Node 26 時再換。
	 */
	const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
	register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

	const instrumentations: Instrumentation[] = [
		new HttpInstrumentation({
			ignoreIncomingRequestHook: request => IGNORED_INCOMING_PATHS.some(prefix => (request.url ?? "").startsWith(prefix)),
			/**
			 * 查詢字串一律不記，路徑交給呼叫端清洗。
			 * 查詢字串可能帶著簽章或 token，而 trace 會被保留兩週、給看得到 Grafana 的人看。
			 */
			startIncomingSpanHook: request => {
				const path = (request.url ?? "").split("?")[0] ?? "";
				return { "url.path": options.sanitizeIncomingPath ? options.sanitizeIncomingPath(path) : path, "url.query": "" };
			},
			/** 沒有上層 span 的對外請求（啟動時建立儲存桶之類）自成一筆 trace 沒有意義。 */
			requireParentforOutgoingSpans: true
		}),
		/** 日誌自動帶上 trace_id，而且同一筆 log 也送一份到 Loki；stdout 照舊，Zeabur 的日誌頁不受影響。 */
		new PinoInstrumentation(),
		/** S3 呼叫記成一段 span；底下那層 HTTPS 請求不再重複記一次。 */
		new AwsInstrumentation({ suppressInternalInstrumentation: true }),
		/** event loop 延遲與 heap：請求變慢但沒有任何子 span 解釋得了時，答案通常在這裡。 */
		new RuntimeNodeInstrumentation()
	];

	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.serviceName,
			...(options.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {}),
			"service.namespace": "huan",
			/**
			 * Prometheus 用它當 `instance` 標籤。沒有它，兩個副本送上來的同名時間序列會互相覆蓋；
			 * 用主機名稱（pod 名稱）而不是隨機 UUID，同一個 pod 重開也還是同一條線。
			 */
			"service.instance.id": hostname()
		}),
		/**
		 * 只取環境變數與主機名稱（容器裡就是 pod 名稱，分得出是哪一個副本）。
		 *
		 * 預設的程序偵測器會帶上完整的命令列參數，而資源屬性會貼在每一筆 log 上：
		 * 既佔空間，也讓啟動參數裡哪天出現的祕密直接進到 Loki。
		 */
		resourceDetectors: [envDetector, hostDetector],
		spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
		metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 30_000 })],
		logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
		instrumentations
	});
	sdk.start();
	await waitForAllMessagesAcknowledged();

	/**
	 * 收到 SIGTERM 時把手上的資料送完。
	 *
	 * 不接管結束流程：應用程式自己的 SIGTERM 處理照常進行，這裡只是趁它關閉連線的那段時間
	 * 一併 flush。最後幾秒的資料偶爾送不出去可以接受，讓容器晚結束不行。
	 */
	const shutdown = async (): Promise<void> => {
		await sdk.shutdown().catch((error: unknown) => diag.warn("OpenTelemetry 關閉時失敗", error));
	};
	process.once("SIGTERM", () => void shutdown());
	process.once("SIGINT", () => void shutdown());

	return { enabled: true, shutdown };
}
