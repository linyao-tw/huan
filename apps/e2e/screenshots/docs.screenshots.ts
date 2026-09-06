import { ADMIN_STATE, ANONYMOUS_STATE } from "@/auth-state";
import { settle } from "@/fixtures";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/public/screenshots");

/**
 * 文件截圖跑在 `pnpm db:seed` 建立的環境上。
 *
 * 種子資料是決定性的，因此每次執行產生的畫面內容一致，
 * 文件不會因為重新截圖而整份變動。
 */
test.beforeAll(async () => {
	await mkdir(OUTPUT_DIR, { recursive: true });
});

async function shoot(page: Page, name: string): Promise<void> {
	await settle(page);
	await page.screenshot({ path: resolve(OUTPUT_DIR, `${name}.png`) });
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

test.describe("後台", () => {
	test.use({ storageState: ADMIN_STATE });

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

		await page.goto("/app/users");
		await expect(page.getByRole("heading", { name: "使用者管理" })).toBeVisible();
		await shoot(page, "users");
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
