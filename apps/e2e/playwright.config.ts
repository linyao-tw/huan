import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 端對端測試預期 PostgreSQL、RustFS、Server、Worker 與 Admin 都已經在跑。
 * `pnpm docker:up && pnpm db:migrate && pnpm dev` 之後就可以直接執行。
 */
export default defineConfig({
	testDir: "./tests",
	testMatch: /.*\.spec\.ts/,
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		locale: "zh-TW",
		timezoneId: "Asia/Taipei"
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
		}
	]
});
