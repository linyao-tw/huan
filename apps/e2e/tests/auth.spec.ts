import { ADMIN_STATE, ANONYMOUS_STATE, USER_STATE } from "@/auth-state";
import { SEED_ADMIN, login } from "@/fixtures";
import { expect, test } from "@playwright/test";

test.describe("登入與權限", () => {
	test.describe("未登入", () => {
		test.use({ storageState: ANONYMOUS_STATE });

		test("未登入時 /app 會被導回登入頁", async ({ page }) => {
			await page.goto("/app/media");
			await page.waitForURL(/\/login/);
			await expect(page.getByRole("textbox", { name: "密碼" })).toBeVisible();
		});

		test("帳號或密碼錯誤時顯示錯誤而不是靜默失敗", async ({ page }) => {
			await page.goto("/login");
			await page.getByRole("textbox", { name: /Email|帳號/ }).fill(SEED_ADMIN.identifier);
			await page.getByRole("textbox", { name: "密碼" }).fill("definitely-not-the-password");
			await page.getByRole("button", { name: /登入/ }).click();
			await expect(page.getByRole("alert")).toBeVisible();
			await expect(page).toHaveURL(/\/login/);
		});
	});

	test.describe("最高權限管理員", () => {
		test.use({ storageState: ADMIN_STATE });

		test("可以進入使用者管理", async ({ page }) => {
			await page.goto("/app/users");
			await expect(page.getByRole("heading", { name: "使用者管理" })).toBeVisible();
		});
	});

	test.describe("登出", () => {
		/**
		 * 登出會撤銷 session，因此這個測試必須用自己的登入，不能共用 storageState ——
		 * 共用的話，這裡一登出，後面所有重用同一組 cookie 的測試就全被登出了。
		 */
		test.use({ storageState: ANONYMOUS_STATE });

		test("登出後回到公開頁面", async ({ page }) => {
			await login(page, SEED_ADMIN);
			await page.getByRole("button", { name: "登出" }).click();
			await page.waitForURL(/\/(login)?$/);
			await page.goto("/app");
			await page.waitForURL(/\/login/);
		});
	});

	test.describe("一般使用者", () => {
		test.use({ storageState: USER_STATE });

		test("看不到使用者管理，而且看到的是明確的權限說明", async ({ page }) => {
			await page.goto("/app/users");
			await expect(page.getByRole("heading", { name: "使用者管理" })).toHaveCount(0);
			await expect(page.getByRole("heading", { name: /沒有存取這個頁面的權限/ })).toBeVisible();
			await expect(page.getByText("403").first()).toBeVisible();
		});
	});
});
