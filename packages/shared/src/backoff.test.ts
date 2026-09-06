import { describe, expect, it } from "vitest";
import { backoffBaseDelay, backoffDelay } from "./backoff.js";

describe("backoffBaseDelay", () => {
	it("以 2 的次方成長", () => {
		expect(backoffBaseDelay(0)).toBe(1_000);
		expect(backoffBaseDelay(1)).toBe(2_000);
		expect(backoffBaseDelay(2)).toBe(4_000);
		expect(backoffBaseDelay(3)).toBe(8_000);
		expect(backoffBaseDelay(4)).toBe(16_000);
	});

	it("在上限封頂", () => {
		expect(backoffBaseDelay(20)).toBe(60_000);
	});
});

describe("backoffDelay", () => {
	it("抖動落在設定的比例之內", () => {
		expect(backoffDelay(2, {}, () => 0)).toBe(3_000);
		expect(backoffDelay(2, {}, () => 1)).toBe(5_000);
		expect(backoffDelay(2, {}, () => 0.5)).toBe(4_000);
	});

	it("永遠不會回傳負數", () => {
		expect(backoffDelay(0, { jitterRatio: 2 }, () => 0)).toBe(0);
	});
});
