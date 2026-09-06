import { ADMIN_STATE, USER_STATE } from "@/auth-state";
import { SEED_ADMIN, SEED_USER, login } from "@/fixtures";
import { test as setup } from "@playwright/test";

setup("建立管理員登入狀態", async ({ page }) => {
	await login(page, SEED_ADMIN);
	await page.context().storageState({ path: ADMIN_STATE });
});

setup("建立一般使用者登入狀態", async ({ page }) => {
	await login(page, SEED_USER);
	await page.context().storageState({ path: USER_STATE });
});
