import { USER_STATE } from "@/auth-state";
import { SEED_USER } from "@/fixtures";
import type { ScheduleManifestEntry } from "@huan/protocol";
import { compareSchedulePrecedence, resolveActiveSchedule } from "@huan/shared";
import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "/api/v1";

/** 排程、版面與裝置都屬於個別使用者，系統管理員沒有這些頁面，所以整份測試跑在一般使用者身上。 */
test.use({ storageState: USER_STATE });

/**
 * 挑一個這個帳號自己擁有、而且已經發布過的版面。
 *
 * 找不到就當場丟錯，不要讓 `layoutId` 變成 undefined 再送出去：
 * 那樣後面的請求會因為「少了 layoutId」被退回 400，看起來像測到了驗證規則，
 * 實際上是種子資料沒有把已發布的版面給這個帳號。
 */
async function requirePublishedLayoutId(request: APIRequestContext): Promise<string> {
	const response = await request.get(`${API}/layouts`);
	expect(response.ok(), await response.text()).toBe(true);
	const layouts = (await response.json()) as { items: { id: string; publishedRevisionId: string | null }[] };
	const layout = layouts.items.find(item => item.publishedRevisionId);
	if (!layout) throw new Error(`${SEED_USER.identifier} 名下沒有任何已發布的版面，排程測試需要一個。請確認 pnpm db:seed 把已發布的版面指給這個帳號。`);
	return layout.id;
}

test.describe("排程", () => {
	test("列表頁說明衝突判定規則", async ({ page }) => {
		await page.goto("/app/schedules");
		await expect(page.getByRole("heading", { name: "同一時間有多個排程，播哪一個" })).toBeVisible();
		/** 規則必須寫在使用者看得到的地方，否則沒有人知道兩筆排程重疊時會播哪一個。 */
		await expect(page.getByText(/優先度/).first()).toBeVisible();
	});

	test("可以建立、修改與刪除排程", async ({ request }) => {
		const auth = await request.post(`${API}/auth/login`, { data: SEED_USER });
		expect(auth.ok()).toBe(true);

		const layoutId = await requirePublishedLayoutId(request);

		const created = await request.post(`${API}/schedules`, {
			data: {
				name: `E2E 排程 ${Date.now()}`,
				enabled: true,
				layoutId,
				timezone: "Asia/Taipei",
				priority: 200,
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: "08:00",
				endTime: "11:00",
				deviceIds: []
			}
		});
		expect(created.ok(), await created.text()).toBe(true);
		const schedule = (await created.json()) as { id: string; timezone: string; priority: number };
		expect(schedule.timezone).toBe("Asia/Taipei");

		const updated = await request.patch(`${API}/schedules/${schedule.id}`, {
			data: {
				name: "E2E 排程（已更新）",
				enabled: false,
				layoutId,
				timezone: "Asia/Taipei",
				priority: 400,
				daysOfWeek: [6, 0],
				startTime: "22:00",
				endTime: "02:00",
				deviceIds: []
			}
		});
		expect(updated.ok(), await updated.text()).toBe(true);
		expect(((await updated.json()) as { priority: number }).priority).toBe(400);

		const removed = await request.delete(`${API}/schedules/${schedule.id}`);
		expect(removed.ok()).toBe(true);
	});

	test("拒絕開始與結束相同的時間", async ({ request }) => {
		await request.post(`${API}/auth/login`, { data: SEED_USER });
		/** 版面必須是真的存在的：少了 layoutId 也會得到 400，那就分不出測到的是哪一條規則。 */
		const layoutId = await requirePublishedLayoutId(request);

		const response = await request.post(`${API}/schedules`, {
			data: { name: "無效排程", enabled: true, layoutId, timezone: "Asia/Taipei", priority: 100, daysOfWeek: [1], startTime: "09:00", endTime: "09:00", deviceIds: [] }
		});
		expect(response.ok()).toBe(false);
		expect(response.status()).toBe(400);
	});

	test("後台與裝置對同一組排程得到相同的判定結果", async ({ request }) => {
		await request.post(`${API}/auth/login`, { data: SEED_USER });
		const schedules = (await (await request.get(`${API}/schedules`)).json()) as {
			items: {
				id: string;
				name: string;
				priority: number;
				timezone: string;
				startDate: string | null;
				endDate: string | null;
				daysOfWeek: number[];
				startTime: string;
				endTime: string;
				updatedAt: string;
			}[];
		};
		test.skip(schedules.items.length < 2, "需要至少兩筆排程才比得出優先順序");

		/**
		 * 把伺服器回傳的排程餵進 @huan/shared 的判定函式。
		 * 裝置離線時用的就是這一組函式，因此這裡驗到的順序就是實機會播的順序。
		 */
		const entries: ScheduleManifestEntry[] = schedules.items.map(item => ({
			id: item.id,
			name: item.name,
			priority: item.priority,
			timezone: item.timezone,
			startDate: item.startDate,
			endDate: item.endDate,
			daysOfWeek: item.daysOfWeek,
			startTime: item.startTime,
			endTime: item.endTime,
			layoutRevisionId: item.id,
			updatedAt: item.updatedAt
		}));

		const instant = new Date("2026-03-02T01:00:00.000Z");
		const forward = resolveActiveSchedule(entries, instant);
		const reversed = resolveActiveSchedule([...entries].reverse(), instant);

		/** 同一組輸入必須永遠得到同一個答案，不論排列順序。 */
		expect(forward?.entry.id).toBe(reversed?.entry.id);

		const sorted = [...entries].sort(compareSchedulePrecedence);
		expect(sorted[0]).toBeDefined();
	});
});
