import { ADMIN_STATE } from "@/auth-state";
import { computeLayoutGeometry } from "@huan/layout-engine";
import { LayoutDocumentSchema } from "@huan/protocol";
import { expect, test } from "@playwright/test";

const LAYOUT_NAME = `E2E 版面 ${Date.now()}`;

test.describe.configure({ mode: "serial" });
test.use({ storageState: ADMIN_STATE });

test.describe("版面編輯器", () => {
	let layoutId = "";

	test("建立版面", async ({ page }) => {
		await page.goto("/app/layouts");
		await page.getByRole("button", { name: "建立版面" }).click();

		const dialog = page.getByRole("dialog");
		await dialog.getByRole("textbox", { name: "版面名稱" }).fill(LAYOUT_NAME);
		await dialog.getByRole("button", { name: "建立並開始編輯" }).click();

		await page.waitForURL(/\/app\/layouts\/[0-9a-f-]{36}/);
		layoutId = page.url().split("/").pop() ?? "";
		expect(layoutId).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("水平分割並調整比例到 70/30", async ({ page }) => {
		await page.goto(`/app/layouts/${layoutId}`);

		await page.getByRole("button", { name: "水平分割" }).click();

		/** 設計系統的 Separator 也有 separator 角色，因此用畫布分隔線自己的可存取名稱定位。 */
		const divider = page.getByRole("separator", { name: /分隔線/ });
		await expect(divider).toHaveCount(1);
		await expect(divider).toHaveAttribute("aria-orientation", "vertical");

		/** 用數值欄位而不是拖曳：比例必須能在完全不用滑鼠的情況下設定。 */
		const ratio = page.getByLabel("左邊那塊占的寬度（%）");
		await ratio.fill("70");
		await ratio.blur();
		await expect(divider).toHaveAttribute("aria-label", /70\s*%/);

		/** 草稿是防抖儲存的。不等指示器就離開，下一個測試重新載入時會拿到還沒分割的版本。 */
		await expect(page.getByText("草稿已儲存")).toBeVisible({ timeout: 15_000 });
	});

	test("放入文字內容並發布", async ({ page }) => {
		await page.goto(`/app/layouts/${layoutId}`);

		await page.getByRole("button", { name: "放入文字" }).click();
		/** 上一個測試留下的分割必須還在，否則發布出去的就不是 70/30 了。 */
		await expect(page.getByRole("separator", { name: /分隔線/ })).toHaveCount(1);

		await page.getByLabel("文字內容").fill("E2E 驗收文字");
		await expect(page.getByText("草稿已儲存")).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "發布" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: /發布/ }).click();
		/** 徽章與 Toast 都會顯示同一段文字，兩者都出現才代表發布真的成功了。 */
		await expect(page.getByText(/已發布第\s*1\s*版/).first()).toBeVisible({ timeout: 15_000 });
	});

	test("已發布的版面在伺服器上是 70/30，而且和版面引擎算出來的一致", async ({ request }) => {
		const login = await request.post("/api/v1/auth/login", {
			data: { identifier: process.env.HUAN_E2E_ADMIN ?? "admin@huan.local", password: process.env.HUAN_E2E_ADMIN_PASSWORD ?? "huan-dev-admin-2024" }
		});
		expect(login.ok()).toBe(true);

		const detail = await request.get(`/api/v1/layouts/${layoutId}`);
		expect(detail.ok()).toBe(true);
		const body = (await detail.json()) as { publishedRevisionId: string | null; revisions: { id: string }[] };
		expect(body.publishedRevisionId).not.toBeNull();

		const revision = await request.get(`/api/v1/layouts/${layoutId}/revisions/${body.publishedRevisionId}`);
		expect(revision.ok()).toBe(true);
		const published = (await revision.json()) as { document: unknown };

		/**
		 * 直接把伺服器存下來的文件丟進版面引擎。
		 * 後台預覽與裝置播放走的是同一組函式，因此這裡的數字就是實機會顯示的數字。
		 */
		const document = LayoutDocumentSchema.parse(published.document);
		const { slots } = computeLayoutGeometry(document);
		expect(slots).toHaveLength(2);
		expect(slots[0]?.width).toBeCloseTo(document.canvas.width * 0.7, 6);
		expect(slots[1]?.width).toBeCloseTo(document.canvas.width * 0.3, 6);
	});
});
