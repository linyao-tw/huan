import type { DeviceArch, DevicePlatform, DisplayInfo } from "@huan/protocol";

/**
 * 所有時間相關的判斷都走這個介面。
 *
 * 排程切換與保留期回收都是「現在幾點」決定的，測試若只能等真實時間流逝就不可能寫，
 * 因此連 `new Date()` 都是注入進來的。
 */
export interface Clock {
	now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

export const systemSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 硬體資訊。取不到的欄位一律 `null`，不以假數值填補：
 * Admin 看到 `null` 會顯示「—」，看到 0 會以為溫度真的是 0 度。
 */
export interface PlatformInfo {
	platform: DevicePlatform;
	arch: DeviceArch;
	osVersion: string | null;
	displays: DisplayInfo[];
	temperatureCelsius: number | null;
	uptimeSeconds: number | null;
}

export interface PlatformInfoProvider {
	read(): Promise<PlatformInfo>;
}

/**
 * 讀取本機 JSON 檔用的最小驗證介面。
 *
 * 之所以不直接寫 `z.ZodType`，是因為 device-core 不把 zod 放進自己的公開型別：
 * `@huan/protocol` 的 schema 結構上就滿足這個介面，手寫的守衛函式也一樣，
 * 兩者可以混用而不必讓這個套件多一個直接相依。
 */
export interface JsonValidator<T> {
	safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** 用純函式守衛做出一個 `JsonValidator`。回傳 `null` 代表結構不符。 */
export function jsonValidator<T>(parse: (value: unknown) => T | null): JsonValidator<T> {
	return {
		safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } {
			const parsed = parse(value);
			if (parsed === null) return { success: false, error: new Error("本機狀態檔結構不符") };
			return { success: true, data: parsed };
		}
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
