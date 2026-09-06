import { buildTimelineBlocks, emptyScheduleForm, isScheduleFormValid, toScheduleRequest, validateScheduleForm, type ScheduleFormValues } from "@/pages/schedules/form";
import { CreateScheduleRequestSchema } from "@huan/protocol";
import { describe, expect, it } from "vitest";

function validForm(overrides: Partial<ScheduleFormValues> = {}): ScheduleFormValues {
	return { ...emptyScheduleForm("Asia/Taipei"), name: "午餐菜單", layoutId: "22222222-2222-4222-8222-222222222222", ...overrides };
}

describe("排程表單驗證", () => {
	it("完整填寫時沒有錯誤", () => {
		expect(validateScheduleForm(validForm())).toEqual({});
		expect(isScheduleFormValid(validateScheduleForm(validForm()))).toBe(true);
	});

	it("拒絕相同的開始與結束時間", () => {
		const errors = validateScheduleForm(validForm({ startTime: "09:00", endTime: "09:00" }));
		expect(errors.endTime).toBeDefined();
		expect(errors.endTime).toContain("不能相同");
		expect(isScheduleFormValid(errors)).toBe(false);
	});

	it("接受跨午夜的時段", () => {
		expect(validateScheduleForm(validForm({ startTime: "22:00", endTime: "02:00" }))).toEqual({});
	});

	it("拒絕結束日期早於開始日期", () => {
		const errors = validateScheduleForm(validForm({ startDate: "2026-05-10", endDate: "2026-05-01" }));
		expect(errors.endDate).toBe("結束日期不能早於開始日期");
		expect(isScheduleFormValid(errors)).toBe(false);
	});

	it("接受起訖同一天的日期區間", () => {
		expect(validateScheduleForm(validForm({ startDate: "2026-05-10", endDate: "2026-05-10" }))).toEqual({});
	});

	it("要求名稱、版面與至少一天", () => {
		const errors = validateScheduleForm(validForm({ name: "  ", layoutId: null, daysOfWeek: [] }));
		expect(errors.name).toBeDefined();
		expect(errors.layoutId).toBeDefined();
		expect(errors.daysOfWeek).toBeDefined();
	});

	it("拒絕格式錯誤的時間", () => {
		const errors = validateScheduleForm(validForm({ startTime: "9:00", endTime: "25:00" }));
		expect(errors.startTime).toBeDefined();
		expect(errors.endTime).toBeDefined();
	});

	it("通過驗證的表單一定能通過協定的 schema", () => {
		const request = toScheduleRequest(validForm({ daysOfWeek: [5, 1, 3] }));
		expect(CreateScheduleRequestSchema.safeParse(request).success).toBe(true);
		expect(request.daysOfWeek).toEqual([1, 3, 5]);
	});
});

describe("週視圖方塊", () => {
	const base = { id: "s1", name: "午餐", enabled: true } as const;

	it("一般時段只產生一個方塊", () => {
		const blocks = buildTimelineBlocks([{ ...base, daysOfWeek: [1], startTime: "06:00", endTime: "12:00" }]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.weekday).toBe(1);
		expect(blocks[0]?.start).toBeCloseTo(0.25, 6);
		expect(blocks[0]?.end).toBeCloseTo(0.5, 6);
	});

	it("跨午夜時段切成當天尾巴與隔天開頭兩塊", () => {
		const blocks = buildTimelineBlocks([{ ...base, daysOfWeek: [6], startTime: "22:00", endTime: "02:00" }]);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({ weekday: 6, continuation: false });
		expect(blocks[0]?.end).toBe(1);
		expect(blocks[1]).toMatchObject({ weekday: 0, continuation: true, start: 0 });
		expect(blocks[1]?.end).toBeCloseTo(2 / 24, 6);
	});

	it("停用的排程不出現在預覽中", () => {
		expect(buildTimelineBlocks([{ ...base, enabled: false, daysOfWeek: [1], startTime: "06:00", endTime: "12:00" }])).toHaveLength(0);
	});
});
