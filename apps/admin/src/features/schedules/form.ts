import { CalendarDateSchema, ClockTimeSchema, type CreateScheduleRequest, type Schedule } from "@huan/protocol";

export interface ScheduleFormValues {
	name: string;
	enabled: boolean;
	layoutId: string | null;
	timezone: string;
	priority: number;
	startDate: string | null;
	endDate: string | null;
	daysOfWeek: number[];
	startTime: string;
	endTime: string;
	deviceIds: string[];
}

export interface ScheduleFormErrors {
	name?: string;
	layoutId?: string;
	timezone?: string;
	daysOfWeek?: string;
	startTime?: string;
	endTime?: string;
	endDate?: string;
}

export function emptyScheduleForm(timezone: string): ScheduleFormValues {
	return { name: "", enabled: true, layoutId: null, timezone, priority: 100, startDate: null, endDate: null, daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", deviceIds: [] };
}

export function scheduleToForm(schedule: Schedule): ScheduleFormValues {
	return {
		name: schedule.name,
		enabled: schedule.enabled,
		layoutId: schedule.layoutId,
		timezone: schedule.timezone,
		priority: schedule.priority,
		startDate: schedule.startDate,
		endDate: schedule.endDate,
		daysOfWeek: [...schedule.daysOfWeek],
		startTime: schedule.startTime,
		endTime: schedule.endTime,
		deviceIds: [...schedule.deviceIds]
	};
}

/**
 * 表單驗證與 `CreateScheduleRequest` 的規則一致，但錯誤要指到欄位上。
 *
 * 相同的開始與結束時間代表「零長度視窗」，而不是「整天」；`endTime < startTime` 才是跨午夜。
 * 這個區別如果只靠伺服器回 400，使用者永遠不會知道自己想表達的是哪一種。
 */
export function validateScheduleForm(values: ScheduleFormValues): ScheduleFormErrors {
	const errors: ScheduleFormErrors = {};

	if (values.name.trim().length === 0) errors.name = "請輸入排程名稱";
	else if (values.name.trim().length > 120) errors.name = "排程名稱最多 120 個字";

	if (!values.layoutId) errors.layoutId = "請選一個要播的版面";

	if (values.timezone.trim().length === 0) errors.timezone = "請選擇時區";

	if (values.daysOfWeek.length === 0) errors.daysOfWeek = "至少要選一天";

	if (!ClockTimeSchema.safeParse(values.startTime).success) errors.startTime = "時間請用 24 小時制填寫，例如 09:30";
	if (!ClockTimeSchema.safeParse(values.endTime).success) errors.endTime = "時間請用 24 小時制填寫，例如 09:30";

	if (!errors.startTime && !errors.endTime && values.startTime === values.endTime) errors.endTime = "開始和結束時間不能相同。要播整天的話，填 00:00 到 23:59。";

	if (values.startDate && !CalendarDateSchema.safeParse(values.startDate).success) errors.endDate = "日期請照 2026-05-10 這樣填";
	if (values.endDate && !CalendarDateSchema.safeParse(values.endDate).success) errors.endDate = "日期請照 2026-05-10 這樣填";
	if (values.startDate && values.endDate && values.startDate > values.endDate) errors.endDate = "結束日期不能早於開始日期";

	return errors;
}

export function isScheduleFormValid(errors: ScheduleFormErrors): boolean {
	return Object.keys(errors).length === 0;
}

export function toScheduleRequest(values: ScheduleFormValues): CreateScheduleRequest {
	if (!values.layoutId) throw new Error("layoutId 是必填欄位，送出前必須先通過 validateScheduleForm");
	return {
		name: values.name.trim(),
		enabled: values.enabled,
		layoutId: values.layoutId,
		timezone: values.timezone,
		priority: values.priority,
		startDate: values.startDate,
		endDate: values.endDate,
		daysOfWeek: [...values.daysOfWeek].sort((a, b) => a - b),
		startTime: values.startTime,
		endTime: values.endTime,
		deviceIds: values.deviceIds
	};
}

export interface TimelineBlock {
	scheduleId: string;
	name: string;
	weekday: number;
	/** 以一天為 1 的比例，方便直接換算成百分比定位。 */
	start: number;
	end: number;
	/** 跨午夜視窗延續到隔天的那一段。 */
	continuation: boolean;
}

function minutesOf(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * 把排程攤平成週視圖上的方塊。
 *
 * 跨午夜的視窗會切成兩塊：當天的尾巴與隔天的開頭。這樣重疊才看得出來，
 * 否則 22:00 到 02:00 在週視圖上會變成一條倒著畫的線。
 */
export function buildTimelineBlocks(schedules: readonly Pick<Schedule, "id" | "name" | "daysOfWeek" | "startTime" | "endTime" | "enabled">[]): TimelineBlock[] {
	const blocks: TimelineBlock[] = [];
	const dayMinutes = 24 * 60;

	for (const schedule of schedules) {
		if (!schedule.enabled) continue;
		const start = minutesOf(schedule.startTime);
		const end = minutesOf(schedule.endTime);

		for (const weekday of schedule.daysOfWeek) {
			if (end > start) {
				blocks.push({ scheduleId: schedule.id, name: schedule.name, weekday, start: start / dayMinutes, end: end / dayMinutes, continuation: false });
				continue;
			}
			blocks.push({ scheduleId: schedule.id, name: schedule.name, weekday, start: start / dayMinutes, end: 1, continuation: false });
			if (end > 0) blocks.push({ scheduleId: schedule.id, name: schedule.name, weekday: (weekday + 1) % 7, start: 0, end: end / dayMinutes, continuation: true });
		}
	}

	return blocks;
}
