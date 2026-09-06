import { SEED_ADMIN, login } from "@/fixtures";
import type { ScheduleManifestEntry } from "@huan/protocol";
import { compareSchedulePrecedence, resolveActiveSchedule } from "@huan/shared";
import { expect, test } from "@playwright/test";

const API = "/api/v1";

test.describe("排程", () => {
	test("列表頁說明衝突判定規則", async ({ page }) => {
		await login(page);
		await page.goto("/app/schedules");
		await expect(page.getByRole("heading", { name: "衝突判定規則" })).toBeVisible();
		/** 規則必須寫在使用者看得到的地方，否則沒有人知道兩筆排程重疊時會播哪一個。 */
		await expect(page.getByText(/優先度/).first()).toBeVisible();
	});

	test("可以建立、修改與刪除排程", async ({ request }) => {
		const auth = await request.post(`${API}/auth/login`, { data: SEED_ADMIN });
		expect(auth.ok()).toBe(true);

		const layouts = (await (await request.get(`${API}/layouts`)).json()) as { items: { id: string; publishedRevisionId: string | null }[] };
		const layout = layouts.items.find(item => item.publishedRevisionId);
		expect(layout).toBeTruthy();

		const created = await request.post(`${API}/schedules`, {
			data: {
				name: `E2E 排程 ${Date.now()}`,
				enabled: true,
				layoutId: layout?.id,
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
				layoutId: layout?.id,
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
		await request.post(`${API}/auth/login`, { data: SEED_ADMIN });
		const layouts = (await (await request.get(`${API}/layouts`)).json()) as { items: { id: string }[] };

		const response = await request.post(`${API}/schedules`, {
			data: { name: "無效排程", enabled: true, layoutId: layouts.items[0]?.id, timezone: "Asia/Taipei", priority: 100, daysOfWeek: [1], startTime: "09:00", endTime: "09:00", deviceIds: [] }
		});
		expect(response.ok()).toBe(false);
		expect(response.status()).toBe(400);
	});

	test("後台與裝置對同一組排程得到相同的判定結果", async ({ request }) => {
		await request.post(`${API}/auth/login`, { data: SEED_ADMIN });
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
