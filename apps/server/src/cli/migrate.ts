import { loadEnv, loadEnvFile } from "@/env";
import { createDatabase, runMigrations } from "@huan/db";

loadEnvFile();
const env = loadEnv();

const handle = createDatabase({ url: env.DATABASE_URL, max: 1 });
try {
	await runMigrations(handle.db);
	console.log("migration 已套用完成。");
} finally {
	await handle.close();
}
