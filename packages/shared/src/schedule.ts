import type { ScheduleManifestEntry } from "@huan/protocol";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatterCache.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23"
		});
		formatterCache.set(timeZone, formatter);
	}
	return formatter;
}

export interface LocalWallClock {
	/** `YYYY-MM-DD` */
	date: string;
	/** `HH:MM` */
	time: string;
	/** 0 = 星期日 */
	weekday: number;
}

/**
 * 把一個時間點換算成某個 IANA 時區的牆上時間。
 *
 * 排程判定完全建立在牆上時間之上，這也是處理日光節約時間最不容易出錯的方式：
 * 平台的時區資料庫負責換算，我們只比較「當地現在幾點」。
 */
export function toWallClock(instant: Date, timeZone: string): LocalWallClock {
	const parts = getFormatter(timeZone).formatToParts(instant);
	const lookup = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? "";
	const date = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
	const time = `${lookup("hour")}:${lookup("minute")}`;
	return { date, time, weekday: weekdayOfCalendarDate(date) };
}

/** 以 Zeller 風格的純算術取得星期，避免再建一次 `Date` 造成時區來回換算。 */
export function weekdayOfCalendarDate(date: string): number {
	const [year, month, day] = date.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function shiftCalendarDate(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number) as [number, number, number];
	const shifted = new Date(Date.UTC(year, month - 1, day + days));
	const yyyy = String(shifted.getUTCFullYear()).padStart(4, "0");
	const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(shifted.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function minutesOfClockTime(time: string): number {
	const [hours, minutes] = time.split(":").map(Number) as [number, number];
	return hours * 60 + minutes;
}

/** 每日視窗的長度（分鐘）。`endTime <= startTime` 代表跨午夜。 */
export function windowMinutes(entry: Pick<ScheduleManifestEntry, "startTime" | "endTime">): number {
	const start = minutesOfClockTime(entry.startTime);
	const end = minutesOfClockTime(entry.endTime);
	return end > start ? end - start : 1440 - start + end;
}

function withinDateRange(entry: Pick<ScheduleManifestEntry, "startDate" | "endDate">, date: string): boolean {
	if (entry.startDate && date < entry.startDate) return false;
	if (entry.endDate && date > entry.endDate) return false;
	return true;
}

/**
 * 判斷某個排程在指定時間點是否生效，並回傳這次命中的「錨定日期」。
 *
 * 跨午夜的視窗錨定在開始的那一天：22:00–02:00、星期一生效，
 * 指的是星期一晚上十點到星期二凌晨兩點。
 */
export function matchesAt(entry: ScheduleManifestEntry, instant: Date): { anchorDate: string } | null {
	const wall = toWallClock(instant, entry.timezone);
	const start = minutesOfClockTime(entry.startTime);
	const end = minutesOfClockTime(entry.endTime);
	const nowMinutes = minutesOfClockTime(wall.time);
	const days = new Set(entry.daysOfWeek);

	if (end > start) {
		if (nowMinutes < start || nowMinutes >= end) return null;
		if (!days.has(wall.weekday)) return null;
		if (!withinDateRange(entry, wall.date)) return null;
		return { anchorDate: wall.date };
	}

	if (nowMinutes >= start) {
		if (days.has(wall.weekday) && withinDateRange(entry, wall.date)) return { anchorDate: wall.date };
		return null;
	}

	if (nowMinutes < end) {
		const previous = shiftCalendarDate(wall.date, -1);
		if (days.has(weekdayOfCalendarDate(previous)) && withinDateRange(entry, previous)) return { anchorDate: previous };
	}

	return null;
}

/**
 * 兩個同時生效的排程，誰說了算。
 *
 * 依序比較：
 * 1. `priority` 大的勝出；
 * 2. 每日視窗較短的勝出（愈短代表指定得愈精確，用來覆蓋長時段的底圖）；
 * 3. 指定天數較少的勝出；
 * 4. 有日期區間的勝過沒有日期區間的；
 * 5. `updatedAt` 較新的勝出；
 * 6. 以 `id` 字典序作為最後的決勝，確保結果永遠是決定性的。
 *
 * 回傳負值代表 `a` 勝出。
 */
export function compareSchedulePrecedence(a: ScheduleManifestEntry, b: ScheduleManifestEntry): number {
	if (a.priority !== b.priority) return b.priority - a.priority;

	const aWindow = windowMinutes(a);
	const bWindow = windowMinutes(b);
	if (aWindow !== bWindow) return aWindow - bWindow;

	if (a.daysOfWeek.length !== b.daysOfWeek.length) return a.daysOfWeek.length - b.daysOfWeek.length;

	const aBounded = a.startDate !== null || a.endDate !== null;
	const bBounded = b.startDate !== null || b.endDate !== null;
	if (aBounded !== bBounded) return aBounded ? -1 : 1;

	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;

	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ScheduleResolution {
	entry: ScheduleManifestEntry;
	anchorDate: string;
}

/** 找出目前應該播放的排程。沒有任何排程命中時回傳 `null`，呼叫端應改用預設版面。 */
export function resolveActiveSchedule(entries: readonly ScheduleManifestEntry[], instant: Date): ScheduleResolution | null {
	const matched: ScheduleResolution[] = [];
	for (const entry of entries) {
		const hit = matchesAt(entry, instant);
		if (hit) matched.push({ entry, anchorDate: hit.anchorDate });
	}
	if (matched.length === 0) return null;
	matched.sort((left, right) => compareSchedulePrecedence(left.entry, right.entry));
	return matched[0] ?? null;
}
