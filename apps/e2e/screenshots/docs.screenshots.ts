import { ADMIN_STATE, ANONYMOUS_STATE, USER_STATE } from "@/auth-state";
import { settle } from "@/fixtures";
import { destinationsFor, screenshotDirs } from "@/screenshot-dir";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIRS = screenshotDirs(dirname(fileURLToPath(import.meta.url)));

/**
 * 文件截圖跑在 `pnpm db:seed` 建立的環境上。
 *
 * 種子資料是決定性的，因此每次執行產生的畫面內容一致，
 * 文件不會因為重新截圖而整份變動。
 */
test.beforeAll(async () => {
	for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });
});

/**
 * 每個畫面都拍亮色與深色兩份。
 *
 * 官網把截圖放在深色頁面上時，只有亮色的那一套會變成一塊發光的白色方塊。
 * 主題是從 localStorage 讀的，所以要寫進去再重新載入 —— 直接改 DOM 屬性會被
 * ThemeProvider 的 effect 蓋回去。
 */
async function shoot(page: Page, name: string): Promise<void> {
	await settle(page);
	const buffers: [string, Buffer][] = [[`${name}.png`, await page.screenshot()]];

	await page.evaluate(() => globalThis.localStorage.setItem("huan.theme", "dark"));
	await page.reload();
	await settle(page);
	buffers.push([`${name}-dark.png`, await page.screenshot()]);

	await page.evaluate(() => globalThis.localStorage.removeItem("huan.theme"));
	await page.reload();
	await settle(page);

	for (const dir of destinationsFor(DIRS, name)) {
		for (const [file, buffer] of buffers) await writeFile(resolve(dir, file), buffer);
	}
}

test.describe.configure({ mode: "serial" });

test.describe("公開頁面", () => {
	test.use({ storageState: ANONYMOUS_STATE });

	test("landing", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await shoot(page, "landing");
	});

	test("login", async ({ page }) => {
		await page.goto("/login");
		await expect(page.getByRole("textbox", { name: "密碼" })).toBeVisible();
		await shoot(page, "login");
	});
});

/**
 * 素材、版面、排程與裝置屬於個別使用者。
 *
 * 這些頁面必須用一般使用者拍：系統管理員不但沒有這些頁面，連數字都不會有，
 * 拍出來會是一張權限說明或空清單，而文件只放真實的產品畫面。
 */
test.describe("後台", () => {
	test.use({ storageState: USER_STATE });

	test("console pages", async ({ page }) => {
		await page.goto("/app");
		await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible();
		await shoot(page, "dashboard");

		await page.goto("/app/media");
		await expect(page.getByRole("heading", { name: "素材庫" })).toBeVisible();
		await shoot(page, "media");

		await page.goto("/app/schedules");
		await expect(page.getByRole("heading", { name: "排程" }).first()).toBeVisible();
		await shoot(page, "schedules");

		await page.goto("/app/devices");
		await expect(page.getByRole("heading", { name: "裝置" }).first()).toBeVisible();
		await shoot(page, "devices");

		await page.goto("/app/security");
		await expect(page.getByRole("heading", { name: "安全設定" })).toBeVisible();
		await shoot(page, "security");
	});

	test("layout editor", async ({ page }) => {
		await page.goto("/app/layouts");
		await expect(page.getByRole("heading", { name: "版面" }).first()).toBeVisible();
		await shoot(page, "layouts");

		/** 進第一份版面的編輯器。種子資料保證至少有一份已發布的版面。 */
		await page
			.getByRole("link", { name: /門市主畫面/ })
			.first()
			.click();
		await page.waitForURL(/\/app\/layouts\/[0-9a-f-]+/);
		await shoot(page, "layout-editor");
	});

	test("pairing", async ({ page }) => {
		await page.goto("/pair");
		await expect(page.getByRole("heading", { name: /配對/ }).first()).toBeVisible();
		await shoot(page, "pairing");
	});
});

/** 使用者管理是系統管理員唯一的功能，只有這一張要用管理員登入狀態拍。 */
test.describe("帳號管理", () => {
	test.use({ storageState: ADMIN_STATE });

	test("users", async ({ page }) => {
		await page.goto("/app/users");
		await expect(page.getByRole("heading", { name: "使用者管理" })).toBeVisible();
		await shoot(page, "users");
	});
});
