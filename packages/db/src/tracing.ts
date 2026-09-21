import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { PostgresJsPreparedQuery } from "drizzle-orm/postgres-js/session";

const tracer = trace.getTracer("@huan/db");

/** 一條 SQL 最多記這麼長。批次 insert 的 SQL 可以長到幾十 KB，全記下來只會讓 trace 查不動。 */
const MAX_QUERY_TEXT_LENGTH = 2000;

export interface QueryDescription {
	operation: string;
	collection: string | null;
}

/**
 * 從 SQL 推出操作與資料表，組成 `SELECT media_assets` 這種 span 名稱。
 *
 * 一律看 SQL 本身，不用 drizzle 給的 `queryMetadata`：它對 update 查詢回報的 type 是
 * `insert`（實測 `update "sessions" set …` 會被標成 INSERT），拿它當 span 名稱會讓人以為
 * 每個請求都在新增資料。
 */
export function describeQuery(text: string): QueryDescription {
	const normalized = text.trimStart();
	const operation = (/^(\w+)/.exec(normalized)?.[1] ?? "query").toUpperCase();
	const collection = /\b(?:from|into|update|join)\s+"?([a-zA-Z0-9_]+)"?/i.exec(normalized)?.[1] ?? null;
	return { operation, collection };
}

function runTraced<T>(query: object, run: () => Promise<T>): Promise<T> {
	/**
	 * 只在已經有上層 span（一個 HTTP 請求、一個轉檔工作）時才記。
	 * Worker 每兩秒輪詢一次佇列，沒有這個條件，一天就是幾萬筆只有一段 SQL 的 trace。
	 */
	if (!trace.getActiveSpan()) return run();

	const textValue: unknown = Reflect.get(query, "queryString");
	const text = typeof textValue === "string" ? textValue : "";
	const { operation, collection } = describeQuery(text);

	return tracer.startActiveSpan(
		collection ? `${operation} ${collection}` : operation,
		{
			kind: SpanKind.CLIENT,
			attributes: {
				"db.system.name": "postgresql",
				"db.operation.name": operation,
				...(collection ? { "db.collection.name": collection } : {}),
				/**
				 * 只記參數化的 SQL（`$1`、`$2`），不記參數值。
				 * 參數裡可能是密碼雜湊、session token 的雜湊或使用者輸入，trace 不是放那些東西的地方。
				 */
				"db.query.text": text.slice(0, MAX_QUERY_TEXT_LENGTH)
			}
		},
		async span => {
			try {
				return await run();
			} catch (error) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : "查詢失敗" });
				if (error instanceof Error) span.recordException(error);
				throw error;
			} finally {
				span.end();
			}
		}
	);
}

let installed = false;

/**
 * 替每一次資料庫查詢建一段 span。
 *
 * drizzle 內建的追蹤是死碼：它的 `tracing.js` 宣告了 `otel` 卻從來沒有賦值，而且就算
 * 啟用了也會把參數值記進 `drizzle.query.params`。postgres.js 也沒有官方埋點，所以直接
 * 包住 drizzle 執行查詢的兩個方法——所有 query builder、`db.execute` 與交易都經過這裡。
 *
 * 沒有啟用 OpenTelemetry 時不會有上層 span，包裝只多一次 `getActiveSpan()` 的呼叫。
 */
export function traceQueries(): void {
	if (installed) return;
	installed = true;

	const prototype = PostgresJsPreparedQuery.prototype;
	const execute = prototype.execute;
	const all = prototype.all;

	prototype.execute = function (this: typeof prototype, placeholderValues) {
		return runTraced(this, () => execute.call(this, placeholderValues));
	};
	prototype.all = function (this: typeof prototype, placeholderValues) {
		return runTraced(this, () => all.call(this, placeholderValues));
	};
}
