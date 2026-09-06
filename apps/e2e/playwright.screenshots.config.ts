import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 文件截圖使用固定的視窗尺寸與 deviceScaleFactor，讓每次產生的圖片尺寸一致，
 * 文件不會因為重新截圖而整份變動。
 */
export default defineConfig({
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
