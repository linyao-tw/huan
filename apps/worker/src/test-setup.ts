import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Worker 的測試需要真的 PostgreSQL、RustFS 與 FFmpeg，連線設定放在 repository 根目錄的 `.env`。
 *
 * 用 Node 內建的 `process.loadEnvFile` 讀取，不引入 dotenv。已經存在於環境中的變數優先，
 * CI 才有辦法用自己的服務位址覆蓋掉本機開發設定。
 */
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));

if (existsSync(envFile)) {
	const preset = new Map(Object.entries(process.env));
	process.loadEnvFile(envFile);
	for (const [key, value] of preset) {
		if (value !== undefined) process.env[key] = value;
	}
}
