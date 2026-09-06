import { expect, test } from "@playwright/test";

test.describe("官網", () => {
	test("呈現品牌、支援平台與 Email 洽詢方式", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		/** 品牌是獨立的視覺元素，不一定落在 h1 裡；重點是它在畫面上。 */
		await expect(page.getByText("HUAN").first()).toBeVisible();
		await expect(page.getByText("讙").first()).toBeVisible();
		await expect(page.getByText(/跨平台的雲端媒體播放與數位看板系統/).first()).toBeVisible();
		for (const platform of ["Raspberry Pi", "Windows", "Ubuntu", "macOS"]) {
			await expect(page.getByText(platform).first()).toBeVisible();
		}
		/** 採購一律走 Email，網站上不應該出現任何付款流程。 */
		await expect(page.getByRole("link", { name: /contact@linyao\.tw/ }).first()).toBeVisible();
	});

	test("提供進入後台的入口", async ({ page }) => {
		await page.goto("/");
		await page
			.getByRole("link", { name: /登入|進入後台/ })
			.first()
			.click();
		await page.waitForURL(/\/login/);
	});
});
