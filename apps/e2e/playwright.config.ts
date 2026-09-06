import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 端對端測試預期 PostgreSQL、RustFS、Server、Worker 與 Admin 都已經在跑。
 * `pnpm docker:up && pnpm db:migrate && pnpm dev` 之後就可以直接執行。
 */
export default defineConfig({
	globalSetup: "./src/global-setup.ts",
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
		/** 裝置協定的測試直接打 Fastify，不經過 Vite 的代理。 */
		extraHTTPHeaders: {},
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		locale: "zh-TW",
		timezoneId: "Asia/Taipei"
	},
	projects: [
		/** 只登入兩次，其餘測試重用 cookie，避免撞上 /auth/* 的速率限制。 */
		{ name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
		{
			name: "chromium",
			dependencies: ["setup"],
			testIgnore: /auth\.setup\.ts/,
			use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
		}
	]
});
