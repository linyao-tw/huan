import type { Page } from "@playwright/test";

/**
 * 種子資料的開發帳號。
 *
 * 端對端測試與文件截圖都跑在 `pnpm db:seed` 建立的環境上，
 * 因此這些值是固定的；正式環境不存在這組帳號。
 */
export const SEED_ADMIN = {
	identifier: process.env.HUAN_E2E_ADMIN ?? "admin@huan.local",
	password: process.env.HUAN_E2E_ADMIN_PASSWORD ?? "huan-dev-admin-2024"
} as const;

export const SEED_USER = {
	identifier: process.env.HUAN_E2E_USER ?? "editor@huan.local",
	password: process.env.HUAN_E2E_USER_PASSWORD ?? "huan-dev-editor-2024"
} as const;

export async function login(page: Page, account: { identifier: string; password: string } = SEED_ADMIN): Promise<void> {
	await page.goto("/login");
	await page.getByRole("textbox", { name: /Email|帳號/ }).fill(account.identifier);
	/** 用 role 而不是 label：密碼欄位旁邊的「顯示密碼」按鈕也被同一個標籤關聯到。 */
	await page.getByRole("textbox", { name: "密碼" }).fill(account.password);
	await page.getByRole("button", { name: /登入/ }).click();
	await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
}

/**
 * 等到畫面穩定為止。
 *
 * 截圖不能在骨架屏還在的時候拍，否則文件裡的圖片每次都不一樣。
 */
export async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle").catch(() => undefined);
	await page.waitForTimeout(600);
}
