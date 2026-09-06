import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./client.js";

/**
 * migration 檔案跟著套件一起發布（package.json 的 `files` 有列 `migrations`），
 * 因此 Docker 映像不需要另外複製 SQL，執行 `db:migrate` 就能找到。
 */
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations(db: Database, migrationsFolder: string = MIGRATIONS_DIR): Promise<void> {
	await migrate(db, { migrationsFolder });
}
