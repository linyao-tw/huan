import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { traceQueries } from "./tracing.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export interface DatabaseOptions {
	url: string;
	/** 連線池大小。Worker 只需要少數連線，Server 才需要較大的池。 */
	max?: number;
	onNotice?: (notice: unknown) => void;
}

/**
 * 建立一個 Drizzle 連線。
 *
 * 回傳 `close`，因為 CLI、測試與 Worker 都需要在結束時明確關閉連線池；
 * 少了它，`vitest` 會因為還有開著的 socket 而卡住不退出。
 */
export function createDatabase({ url, max = 10, onNotice }: DatabaseOptions) {
	traceQueries();
	const sql = postgres(url, {
		max,
		onnotice: onNotice ?? (() => {}),
		/** 有些 JSONB 欄位很大，關掉 prepare 讓連線池在 pgbouncer 之類的環境也能運作。 */
		prepare: false
	});
	const db = drizzle(sql, { schema, casing: "snake_case" });
	return {
		db,
		sql,
		close: async (): Promise<void> => {
			await sql.end({ timeout: 5 });
		}
	};
}

export { schema };
