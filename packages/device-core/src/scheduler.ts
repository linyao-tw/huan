import type { DesiredState, LayoutBundle } from "@huan/protocol";
import { resolveActiveSchedule } from "@huan/shared";
import { TypedEmitter } from "./events.js";
import { silentLogger, type Logger } from "./logger.js";
import { systemClock, type Clock } from "./types.js";

export interface ScheduleTarget {
	scheduleId: string | null;
	scheduleName: string | null;
	layoutRevisionId: string | null;
	layout: LayoutBundle | null;
	/** `schedule` 命中排程、`default` 落到預設版面、`idle` 什麼都沒有（顯示待命畫面）。 */
	source: "schedule" | "default" | "idle";
}

export const IDLE_TARGET: ScheduleTarget = { scheduleId: null, scheduleName: null, layoutRevisionId: null, layout: null, source: "idle" };

export interface LayoutSchedulerEvents extends Record<string, unknown> {
	change: ScheduleTarget;
}

export interface LayoutSchedulerOptions {
	clock?: Clock;
	logger?: Logger;
	/** 一秒一次。判定是純計算，成本可以忽略，換來的是切換剛好落在分鐘邊界上。 */
	tickMs?: number;
}

/**
 * 版面排程器。
 *
 * 這一段是「網路斷了還是照播」的核心：所有判定資料都來自本機的 manifest，
 * 完全不需要伺服器。`@huan/shared` 的 `resolveActiveSchedule` 已經處理過跨午夜、
 * 時區與優先順序，這裡只負責定時問它、把結果轉成本機真的持有的版面。
 */
export class LayoutScheduler {
	readonly events: TypedEmitter<LayoutSchedulerEvents>;

	private readonly clock: Clock;
	private readonly tickMs: number;
	private manifest: DesiredState | null = null;
	private target: ScheduleTarget = IDLE_TARGET;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(options: LayoutSchedulerOptions = {}) {
		this.clock = options.clock ?? systemClock;
		this.tickMs = options.tickMs ?? 1_000;
		this.events = new TypedEmitter<LayoutSchedulerEvents>(options.logger ?? silentLogger);
	}

	get current(): ScheduleTarget {
		return this.target;
	}

	setManifest(manifest: DesiredState | null): void {
		this.manifest = manifest;
		this.tick();
	}

	start(): void {
		if (this.timer) return;
		this.tick();
		this.timer = setInterval(() => this.tick(), this.tickMs);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	/** 純函式：算出此刻應該播哪一個版面，不改變任何狀態。 */
	evaluate(now: Date = this.clock.now()): ScheduleTarget {
		const manifest = this.manifest;
		if (!manifest) return IDLE_TARGET;

		const available = new Map(manifest.layouts.map(layout => [layout.revisionId, layout]));
		// 只考慮本機真的有版面資料的排程。切到一個還沒下載的修訂只會換來一片黑畫面，
		// 那比繼續播舊內容糟得多。
		const candidates = manifest.schedules.filter(entry => available.has(entry.layoutRevisionId));
		const hit = resolveActiveSchedule(candidates, now);
		if (hit) {
			const layout = available.get(hit.entry.layoutRevisionId) ?? null;
			if (layout) {
				return { scheduleId: hit.entry.id, scheduleName: hit.entry.name, layoutRevisionId: layout.revisionId, layout, source: "schedule" };
			}
		}

		if (manifest.defaultLayout) {
			return { scheduleId: null, scheduleName: null, layoutRevisionId: manifest.defaultLayout.revisionId, layout: manifest.defaultLayout, source: "default" };
		}
		return IDLE_TARGET;
	}

	/**
	 * 下一個排程會用到的版面修訂。
	 * 垃圾回收要靠它避開「現在還沒播、但等一下就要播」的素材。
	 */
	upcomingLayoutRevisionIds(): string[] {
		const manifest = this.manifest;
		if (!manifest) return [];
		const ids = new Set<string>();
		if (manifest.defaultLayout) ids.add(manifest.defaultLayout.revisionId);
		for (const entry of manifest.schedules) ids.add(entry.layoutRevisionId);
		return [...ids];
	}

	private tick(): void {
		const next = this.evaluate();
		if (next.layoutRevisionId === this.target.layoutRevisionId && next.scheduleId === this.target.scheduleId && next.source === this.target.source) return;
		this.target = next;
		this.events.emit("change", next);
	}
}
