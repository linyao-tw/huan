import type { ScheduleManifestEntry } from "@huan/protocol";
import { describe, expect, it } from "vitest";
import { compareSchedulePrecedence, matchesAt, resolveActiveSchedule, toWallClock, windowMinutes } from "./schedule.js";

function entry(overrides: Partial<ScheduleManifestEntry> = {}): ScheduleManifestEntry {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		name: "測試排程",
		priority: 100,
		timezone: "Asia/Taipei",
		startDate: null,
		endDate: null,
		daysOfWeek: [1, 2, 3, 4, 5],
		startTime: "08:00",
		endTime: "11:00",
		layoutRevisionId: "00000000-0000-4000-8000-0000000000a1",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

describe("toWallClock", () => {
	it("以指定時區換算牆上時間", () => {
		// 2026-03-02T00:30:00Z 在台北是同日早上 08:30（星期一）。
		const wall = toWallClock(new Date("2026-03-02T00:30:00.000Z"), "Asia/Taipei");
		expect(wall).toEqual({ date: "2026-03-02", time: "08:30", weekday: 1 });
	});

	it("在日光節約時間切換後仍回報正確的當地時刻", () => {
		// 美東在 2026-03-08 02:00 進入日光節約時間，UTC-5 變成 UTC-4。
		const before = toWallClock(new Date("2026-03-08T06:30:00.000Z"), "America/New_York");
		const after = toWallClock(new Date("2026-03-08T07:30:00.000Z"), "America/New_York");
		expect(before.time).toBe("01:30");
		expect(after.time).toBe("03:30");
	});
});

describe("matchesAt", () => {
	it("命中平日早晨的視窗", () => {
		const result = matchesAt(entry(), new Date("2026-03-02T01:00:00.000Z"));
		expect(result).toEqual({ anchorDate: "2026-03-02" });
	});

	it("視窗結束時刻不再命中", () => {
		expect(matchesAt(entry(), new Date("2026-03-02T03:00:00.000Z"))).toBeNull();
	});

	it("週末不命中只設定平日的排程", () => {
		expect(matchesAt(entry(), new Date("2026-03-07T01:00:00.000Z"))).toBeNull();
	});

	it("跨午夜的視窗錨定在開始的那一天", () => {
		const night = entry({ startTime: "22:00", endTime: "02:00", daysOfWeek: [1] });
		// 台北時間 2026-03-03 01:00（星期二凌晨），屬於星期一晚上開始的視窗。
		expect(matchesAt(night, new Date("2026-03-02T17:00:00.000Z"))).toEqual({ anchorDate: "2026-03-02" });
		// 星期三凌晨就不該命中，因為星期二晚上沒有排程。
		expect(matchesAt(night, new Date("2026-03-03T17:00:00.000Z"))).toBeNull();
	});

	it("尊重日期區間", () => {
		const limited = entry({ startDate: "2026-03-03", endDate: "2026-03-05" });
		expect(matchesAt(limited, new Date("2026-03-02T01:00:00.000Z"))).toBeNull();
		expect(matchesAt(limited, new Date("2026-03-04T01:00:00.000Z"))).toEqual({ anchorDate: "2026-03-04" });
		expect(matchesAt(limited, new Date("2026-03-06T01:00:00.000Z"))).toBeNull();
	});

	it("以排程自己的時區判定，而不是執行環境的時區", () => {
		const tokyo = entry({ timezone: "Asia/Tokyo", startTime: "08:00", endTime: "09:00" });
		// UTC 23:30 在東京是隔天 08:30。
		expect(matchesAt(tokyo, new Date("2026-03-01T23:30:00.000Z"))).toEqual({ anchorDate: "2026-03-02" });
	});
});

describe("windowMinutes", () => {
	it("計算一般視窗長度", () => {
		expect(windowMinutes({ startTime: "08:00", endTime: "11:00" })).toBe(180);
	});

	it("計算跨午夜視窗長度", () => {
		expect(windowMinutes({ startTime: "22:00", endTime: "02:00" })).toBe(240);
	});
});

describe("compareSchedulePrecedence", () => {
	it("優先度高的勝出", () => {
		const high = entry({ id: "a", priority: 200 });
		const low = entry({ id: "b", priority: 100 });
		expect(compareSchedulePrecedence(high, low)).toBeLessThan(0);
	});

	it("優先度相同時，視窗較短的勝出", () => {
		const narrow = entry({ id: "a", startTime: "09:00", endTime: "10:00" });
		const wide = entry({ id: "b", startTime: "08:00", endTime: "18:00" });
		expect(compareSchedulePrecedence(narrow, wide)).toBeLessThan(0);
	});

	it("視窗相同時，指定天數較少的勝出", () => {
		const oneDay = entry({ id: "a", daysOfWeek: [1] });
		const weekdays = entry({ id: "b", daysOfWeek: [1, 2, 3, 4, 5] });
		expect(compareSchedulePrecedence(oneDay, weekdays)).toBeLessThan(0);
	});

	it("其餘條件相同時，有日期區間的勝出", () => {
		const bounded = entry({ id: "a", startDate: "2026-03-01" });
		const open = entry({ id: "b" });
		expect(compareSchedulePrecedence(bounded, open)).toBeLessThan(0);
	});

	it("完全相同的條件仍然給出決定性的結果", () => {
		const first = entry({ id: "aaa" });
		const second = entry({ id: "bbb" });
		expect(compareSchedulePrecedence(first, second)).toBeLessThan(0);
		expect(compareSchedulePrecedence(second, first)).toBeGreaterThan(0);
	});
});

describe("resolveActiveSchedule", () => {
	const breakfast = entry({ id: "11111111-1111-4111-8111-111111111111", name: "早餐", startTime: "08:00", endTime: "11:00", layoutRevisionId: "rev-breakfast" });
	const lunch = entry({ id: "22222222-2222-4222-8222-222222222222", name: "午餐", startTime: "11:00", endTime: "14:00", layoutRevisionId: "rev-lunch" });
	const promo = entry({ id: "33333333-3333-4333-8333-333333333333", name: "限時活動", startTime: "12:00", endTime: "12:30", priority: 500, layoutRevisionId: "rev-promo" });

	it("依時間切換版面", () => {
		const morning = resolveActiveSchedule([breakfast, lunch], new Date("2026-03-02T01:00:00.000Z"));
		expect(morning?.entry.layoutRevisionId).toBe("rev-breakfast");

		const noon = resolveActiveSchedule([breakfast, lunch], new Date("2026-03-02T05:00:00.000Z"));
		expect(noon?.entry.layoutRevisionId).toBe("rev-lunch");
	});

	it("高優先度的活動排程覆蓋一般時段", () => {
		const result = resolveActiveSchedule([breakfast, lunch, promo], new Date("2026-03-02T04:10:00.000Z"));
		expect(result?.entry.layoutRevisionId).toBe("rev-promo");
	});

	it("沒有排程命中時回傳 null", () => {
		expect(resolveActiveSchedule([breakfast, lunch], new Date("2026-03-02T20:00:00.000Z"))).toBeNull();
	});

	it("同一組輸入永遠得到同一個結果", () => {
		const instant = new Date("2026-03-02T04:10:00.000Z");
		const forward = resolveActiveSchedule([breakfast, lunch, promo], instant);
		const reversed = resolveActiveSchedule([promo, lunch, breakfast], instant);
		expect(forward?.entry.id).toBe(reversed?.entry.id);
	});
});
