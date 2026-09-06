import { z } from "zod";
import { CalendarDateSchema, ClockTimeSchema, IdSchema, IsoDateTimeSchema, TimeZoneSchema } from "./common.js";

/** 0 = 星期日，6 = 星期六，與 `Date.prototype.getDay()` 一致。 */
export const WeekdaySchema = z.number().int().min(0).max(6);

export const SchedulePrioritySchema = z.number().int().min(0).max(1000);

export const ScheduleSchema = z.object({
	id: IdSchema,
	name: z.string(),
	enabled: z.boolean(),
	layoutId: IdSchema,
	layoutName: z.string(),
	timezone: TimeZoneSchema,
	priority: z.number().int(),
	startDate: CalendarDateSchema.nullable(),
	endDate: CalendarDateSchema.nullable(),
	daysOfWeek: z.array(WeekdaySchema).min(1).max(7),
	startTime: ClockTimeSchema,
	/** 小於或等於 `startTime` 時代表跨午夜，例如 22:00 → 02:00。 */
	endTime: ClockTimeSchema,
	deviceIds: z.array(IdSchema),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type Schedule = z.infer<typeof ScheduleSchema>;

const ScheduleBodySchema = z.object({
	name: z.string().min(1, "請輸入排程名稱").max(120),
	enabled: z.boolean().default(true),
	layoutId: IdSchema,
	timezone: TimeZoneSchema,
	priority: SchedulePrioritySchema.default(100),
	startDate: CalendarDateSchema.nullable().default(null),
	endDate: CalendarDateSchema.nullable().default(null),
	daysOfWeek: z.array(WeekdaySchema).min(1, "至少選擇一天").max(7),
	startTime: ClockTimeSchema,
	endTime: ClockTimeSchema,
	deviceIds: z.array(IdSchema).default([])
});

export const CreateScheduleRequestSchema = ScheduleBodySchema.refine(value => value.startTime !== value.endTime, "開始與結束時間不能相同").refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, "結束日期不能早於開始日期");
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;

export const UpdateScheduleRequestSchema = CreateScheduleRequestSchema;
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;

/**
 * 下載到 Device 的排程項目。Device 離線時就是靠這份資料自行切換版面，
 * 因此每一筆都內嵌自己的版面修訂編號，不需要再向 Server 詢問。
 */
export const ScheduleManifestEntrySchema = z.object({
	id: IdSchema,
	name: z.string(),
	priority: z.number().int(),
	timezone: TimeZoneSchema,
	startDate: CalendarDateSchema.nullable(),
	endDate: CalendarDateSchema.nullable(),
	daysOfWeek: z.array(WeekdaySchema),
	startTime: ClockTimeSchema,
	endTime: ClockTimeSchema,
	layoutRevisionId: IdSchema,
	updatedAt: IsoDateTimeSchema
});
export type ScheduleManifestEntry = z.infer<typeof ScheduleManifestEntrySchema>;
