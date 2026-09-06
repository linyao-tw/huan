import { loadServerEnv, type ServerEnv } from "@huan/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type { ServerEnv };

/**
 * 從這個檔案往上找 `.env`。
 *
 * 開發時 `tsx` 是從 `apps/server` 執行，Docker 映像則是從 `/app` 執行，
 * 兩邊的相對深度不同，所以用往上尋找的方式而不是寫死路徑。
 */
function findEnvFile(startDir: string): string | null {
	let current = startDir;
	for (let depth = 0; depth < 6; depth += 1) {
		const candidate = resolve(current, ".env");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

let envFileLoaded = false;

/**
 * 載入 repository 根目錄的 `.env`。
 *
 * 刻意不引入 dotenv：Node 22 之後 `process.loadEnvFile` 已經內建，而且與
 * `node --env-file` 的語意一致——已經存在的環境變數優先，不會被檔案覆蓋。
 */
export function loadEnvFile(explicitPath?: string): void {
	if (envFileLoaded) return;
	const path = explicitPath ?? findEnvFile(dirname(fileURLToPath(import.meta.url)));
	if (!path) return;
	process.loadEnvFile(path);
	envFileLoaded = true;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
	return loadServerEnv(source);
}
