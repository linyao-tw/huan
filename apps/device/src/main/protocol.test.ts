import { isSafeMediaFileName } from "@/main/protocol";
import { describe, expect, it } from "vitest";

/**
 * 自訂協定是 renderer 唯一能碰到檔案系統的入口。
 *
 * 這一組測試守住的是「沙箱裡的頁面不能讀到媒體目錄以外的東西」——
 * 播放器會載入使用者上傳的 HTML，這裡放行的每一種字串都等於一個攻擊面。
 */
describe("isSafeMediaFileName", () => {
	it("接受由 UUID 與副檔名組成的正常檔名", () => {
		expect(isSafeMediaFileName("9f3a7c21-4b8e-4d13-9a2c-11223344aabb.mp4")).toBe(true);
		expect(isSafeMediaFileName("thumb_01.png")).toBe(true);
	});

	it("拒絕任何路徑分隔字元", () => {
		for (const value of ["a/b.mp4", "a\\b.mp4", "/etc/passwd", "C:\\Windows\\win.ini"]) {
			expect(isSafeMediaFileName(value)).toBe(false);
		}
	});

	it("拒絕路徑穿越", () => {
		for (const value of ["..", ".", "../secret.mp4", "..%2Fsecret.mp4", "....//secret.mp4"]) {
			expect(isSafeMediaFileName(value)).toBe(false);
		}
	});

	it("拒絕空字串、空位元組與過長的名稱", () => {
		expect(isSafeMediaFileName("")).toBe(false);
		expect(isSafeMediaFileName("a\u0000.mp4")).toBe(false);
		expect(isSafeMediaFileName(`${"a".repeat(200)}.mp4`)).toBe(false);
	});

	it("拒絕不在允許字元集內的名稱", () => {
		for (const value of ["名稱.mp4", "a b.mp4", "a;b.mp4", "a$b.mp4", "a'b.mp4"]) {
			expect(isSafeMediaFileName(value)).toBe(false);
		}
	});
});
