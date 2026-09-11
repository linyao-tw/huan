import { createStorage, type StorageService } from "@/lib/storage";
import { resolveTotpKey } from "@/lib/totp-key";
import { SocketHub } from "@/ws/hub";
import type { ServerEnv } from "@huan/config";
import { createDatabase, type Database } from "@huan/db";

type DatabaseHandle = ReturnType<typeof createDatabase>;

/** 一個 Server 實例會用到的全部外部相依。測試用 `buildServer` 建立，正式環境也是同一條路徑。 */
export interface AppContext {
	readonly env: ServerEnv;
	readonly db: Database;
	readonly sql: DatabaseHandle["sql"];
	readonly storage: StorageService;
	readonly hub: SocketHub;
	/** 加密 TOTP 密鑰用的 32-byte 金鑰，啟動時從環境變數解析一次。 */
	readonly totpKey: Buffer;
	close(): Promise<void>;
}

export interface CreateContextOptions {
	env: ServerEnv;
	/** 測試可以傳入既有的連線，避免每個檔案都自己開一個連線池。 */
	database?: DatabaseHandle;
	storage?: StorageService;
}

export function createContext({ env, database, storage }: CreateContextOptions): AppContext {
	const handle = database ?? createDatabase({ url: env.DATABASE_URL, max: 10 });
	const ownsDatabase = database === undefined;
	const storageService = storage ?? createStorage(env);
	const ownsStorage = storage === undefined;

	return {
		env,
		db: handle.db,
		sql: handle.sql,
		storage: storageService,
		hub: new SocketHub(),
		totpKey: resolveTotpKey(env, message => console.warn(`[huan] ${message}`)),
		async close() {
			if (ownsStorage) storageService.destroy();
			if (ownsDatabase) await handle.close();
		}
	};
}
