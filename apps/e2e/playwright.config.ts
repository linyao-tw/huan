import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 端對端測試需要 PostgreSQL 與 RustFS 已經在跑（`pnpm docker:up`）。
 * Server 與 Admin 由下面的 webServer 自己帶起來。
 */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Playwright 自己把 Server 與 Admin 帶起來。
 *
 * 少了這一段，CI 的端對端 job 只會得到一串 ERR_CONNECTION_REFUSED —— 而且是在
 * 「測試碼沒問題、只是沒人啟動服務」的情況下失敗，那種紅燈最沒有價值。
 * 本機已經有服務在跑時直接重用，不會搶埠。
 */
const webServer = [
	{
		command: "pnpm --filter @huan/server dev",
		url: "http://localhost:4000/health/ready",
		cwd: REPO_ROOT,
		/** 每一個請求都印一行會把測試輸出淹掉；出問題的東西仍然會以 warn 以上印出來。 */
		env: { LOG_LEVEL: "warn" },
		reuseExistingServer: !process.env.CI,
		stdout: "pipe" as const,
		stderr: "pipe" as const,
		timeout: 120_000
	},
	{
		command: "pnpm --filter @huan/admin dev",
		url: "http://localhost:5173/",
		cwd: REPO_ROOT,
		reuseExistingServer: !process.env.CI,
		stdout: "pipe" as const,
		stderr: "pipe" as const,
		timeout: 120_000
	}
];

export default defineConfig({
	/** 對 Docker 直接提供的 Admin 測試時，服務已經在跑，不需要再起一份。 */
	...(process.env.HUAN_E2E_NO_WEB_SERVER === "true" ? {} : { webServer }),
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
