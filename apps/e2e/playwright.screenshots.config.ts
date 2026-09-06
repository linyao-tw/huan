import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 文件截圖使用固定的視窗尺寸與 deviceScaleFactor，讓每次產生的圖片尺寸一致，
 * 文件不會因為重新截圖而整份變動。
 */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
	/** 和端對端測試一樣自己帶起服務；本機已經在跑時直接重用。 */
	webServer: [
		{ command: "pnpm --filter @huan/server dev", url: "http://localhost:4000/health/ready", cwd: REPO_ROOT, reuseExistingServer: true, timeout: 120_000 },
		{ command: "pnpm --filter @huan/admin dev", url: "http://localhost:5173/", cwd: REPO_ROOT, reuseExistingServer: true, timeout: 120_000 }
	],
	/** 截圖同樣需要固定的種子資料，否則文件裡的圖片會隨資料庫狀態變動。 */
	globalSetup: "./src/global-setup.ts",
	testDir: "./screenshots",
	testMatch: /.*\.screenshots\.ts/,
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	reporter: [["list"]],
	use: {
		baseURL,
		viewport: { width: 1600, height: 1000 },
		deviceScaleFactor: 2,
		locale: "zh-TW",
		timezoneId: "Asia/Taipei",
		colorScheme: "light"
	},
	projects: [
		{ name: "setup", testDir: "./tests", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
		{
			name: "chromium",
			dependencies: ["setup"],
			use: { ...devices["Desktop Chrome"] }
		}
	]
});
