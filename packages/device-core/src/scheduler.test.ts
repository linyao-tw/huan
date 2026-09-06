import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock, makeDesiredState, makeLayout, makeSchedule } from "./fixtures.js";
import { LayoutScheduler, type ScheduleTarget } from "./scheduler.js";

/**
 * 這一整組測試完全沒有網路、沒有 fetch、沒有 WebSocket。
 * 那正是重點：伺服器整晚不通的時候，看板還是得在正確的時間換版面。
 */
describe("LayoutScheduler", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("在排程時段內播排程版面，時段外回到預設版面", () => {
		const daytime = makeLayout({ name: "白天" });
		const fallback = makeLayout({ name: "預設" });
		const manifest = makeDesiredState({
			layouts: [daytime, fallback],
			defaultLayout: fallback,
			schedules: [makeSchedule(daytime.revisionId, { startTime: "09:00", endTime: "17:00" })]
		});

		// 2026-03-04 是星期三。
		const clock = new FakeClock(new Date("2026-03-04T10:00:00+08:00"));
		const scheduler = new LayoutScheduler({ clock });
		scheduler.setManifest(manifest);

		expect(scheduler.current.source).toBe("schedule");
		expect(scheduler.current.layoutRevisionId).toBe(daytime.revisionId);

		clock.set(new Date("2026-03-04T18:00:00+08:00"));
		expect(scheduler.evaluate().layoutRevisionId).toBe(fallback.revisionId);
		expect(scheduler.evaluate().source).toBe("default");
	});

	it("跨午夜的排程在凌晨仍然有效", () => {
		const night = makeLayout({ name: "夜間" });
		const manifest = makeDesiredState({
			layouts: [night],
			defaultLayout: null,
			schedules: [makeSchedule(night.revisionId, { startTime: "22:00", endTime: "02:00", daysOfWeek: [3] })]
		});

		const clock = new FakeClock(new Date("2026-03-05T01:00:00+08:00"));
		const scheduler = new LayoutScheduler({ clock });
		scheduler.setManifest(manifest);

		// 星期三晚上的視窗延續到星期四凌晨。
		expect(scheduler.current.layoutRevisionId).toBe(night.revisionId);
	});

	it("忽略指向本機沒有的版面修訂的排程", () => {
		const fallback = makeLayout({ name: "預設" });
		const manifest = makeDesiredState({
			layouts: [fallback],
			defaultLayout: fallback,
			schedules: [makeSchedule("11111111-1111-4111-8111-111111111111", { startTime: "00:00", endTime: "23:59" })]
		});

		const clock = new FakeClock(new Date("2026-03-04T10:00:00+08:00"));
		const scheduler = new LayoutScheduler({ clock });
		scheduler.setManifest(manifest);

		// 切到一個沒下載的版面只會換來黑畫面，寧可留在預設版面。
		expect(scheduler.current.layoutRevisionId).toBe(fallback.revisionId);
		expect(scheduler.current.source).toBe("default");
	});

	it("沒有任何排程與預設版面時進入待命", () => {
		const clock = new FakeClock(new Date("2026-03-04T10:00:00+08:00"));
		const scheduler = new LayoutScheduler({ clock });
		scheduler.setManifest(makeDesiredState());
		expect(scheduler.current.source).toBe("idle");
		expect(scheduler.current.layout).toBeNull();
	});

	it("時間跨過邊界時在下一個 tick 發出切換事件，全程不需要網路", () => {
		vi.useFakeTimers();
		const daytime = makeLayout({ name: "白天" });
		const evening = makeLayout({ name: "晚間" });
		const manifest = makeDesiredState({
			layouts: [daytime, evening],
			defaultLayout: null,
			schedules: [makeSchedule(daytime.revisionId, { name: "白天", startTime: "09:00", endTime: "17:00" }), makeSchedule(evening.revisionId, { name: "晚間", startTime: "17:00", endTime: "23:00" })]
		});

		const clock = new FakeClock(new Date("2026-03-04T16:59:30+08:00"));
		const scheduler = new LayoutScheduler({ clock, tickMs: 1_000 });
		const changes: ScheduleTarget[] = [];
		scheduler.events.on("change", target => changes.push(target));

		scheduler.setManifest(manifest);
		scheduler.start();
		expect(scheduler.current.layoutRevisionId).toBe(daytime.revisionId);

		clock.set(new Date("2026-03-04T17:00:01+08:00"));
		vi.advanceTimersByTime(1_000);

		expect(scheduler.current.layoutRevisionId).toBe(evening.revisionId);
		expect(changes.at(-1)?.scheduleName).toBe("晚間");
		scheduler.stop();
	});

	it("列出所有可能用到的版面修訂，讓垃圾回收知道要保留什麼", () => {
		const a = makeLayout();
		const b = makeLayout();
		const manifest = makeDesiredState({ layouts: [a, b], defaultLayout: a, schedules: [makeSchedule(b.revisionId)] });
		const scheduler = new LayoutScheduler({ clock: new FakeClock(new Date("2026-03-04T10:00:00+08:00")) });
		scheduler.setManifest(manifest);
		expect(new Set(scheduler.upcomingLayoutRevisionIds())).toEqual(new Set([a.revisionId, b.revisionId]));
	});
});
