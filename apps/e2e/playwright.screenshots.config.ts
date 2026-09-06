import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HUAN_E2E_BASE_URL ?? "http://localhost:5173";

/**
 * 文件截圖使用固定的視窗尺寸與 deviceScaleFactor，讓每次產生的圖片尺寸一致，
 * 文件不會因為重新截圖而整份變動。
 */
export default defineConfig({
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
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] }
		}
	]
});
