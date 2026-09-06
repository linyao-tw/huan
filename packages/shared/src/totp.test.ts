import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, buildOtpauthUri, generateTotp, hotp, verifyTotp } from "./totp.js";

const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = base32Encode(new TextEncoder().encode(RFC_SECRET_ASCII));

describe("base32", () => {
	it("往返轉換不會改變內容", () => {
		const bytes = new TextEncoder().encode(RFC_SECRET_ASCII);
		expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
	});

	it("符合 RFC 4648 的測試向量", () => {
		expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
	});

	it("拒絕無效字元", () => {
		expect(() => base32Decode("MZXW6YTBOI1")).toThrow();
	});
});

describe("hotp", () => {
	// RFC 4226 附錄 D 的測試向量。
	const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

	it.each(expected.map((code, counter) => [counter, code] as const))("counter %i 產生 %s", async (counter, code) => {
		const secret = new TextEncoder().encode(RFC_SECRET_ASCII);
		expect(await hotp(secret, counter)).toBe(code);
	});
});

describe("generateTotp", () => {
	// RFC 6238 附錄 B 的 SHA-1 測試向量（8 位數）。
	const vectors: readonly [number, string][] = [
		[59, "94287082"],
		[1111111109, "07081804"],
		[1111111111, "14050471"],
		[1234567890, "89005924"],
		[2000000000, "69279037"],
		[20000000000, "65353130"]
	];

	it.each(vectors)("unix time %i 產生 %s", async (unixSeconds, code) => {
		expect(await generateTotp(RFC_SECRET_BASE32, unixSeconds * 1000, { digits: 8 })).toBe(code);
	});
});

describe("verifyTotp", () => {
	const nowMs = 1_772_000_000_000;

	it("接受目前時間步長的驗證碼", async () => {
		const code = await generateTotp(RFC_SECRET_BASE32, nowMs);
		expect(await verifyTotp(RFC_SECRET_BASE32, code, nowMs)).toBe(0);
	});

	it("容忍前後一個時間步長的時鐘誤差", async () => {
		const previous = await generateTotp(RFC_SECRET_BASE32, nowMs - 30_000);
		const next = await generateTotp(RFC_SECRET_BASE32, nowMs + 30_000);
		expect(await verifyTotp(RFC_SECRET_BASE32, previous, nowMs)).toBe(-1);
		expect(await verifyTotp(RFC_SECRET_BASE32, next, nowMs)).toBe(1);
	});

	it("拒絕超出容忍範圍的驗證碼", async () => {
		const stale = await generateTotp(RFC_SECRET_BASE32, nowMs - 300_000);
		expect(await verifyTotp(RFC_SECRET_BASE32, stale, nowMs)).toBeNull();
	});

	it("拒絕長度不符的輸入", async () => {
		expect(await verifyTotp(RFC_SECRET_BASE32, "1234", nowMs)).toBeNull();
	});
});

describe("buildOtpauthUri", () => {
	it("組出驗證器可以掃描的 URI", () => {
		const uri = buildOtpauthUri({ issuer: "HUAN", accountName: "admin@example.com", secretBase32: RFC_SECRET_BASE32 });
		expect(uri.startsWith("otpauth://totp/HUAN:admin%40example.com?")).toBe(true);
		expect(uri).toContain(`secret=${RFC_SECRET_BASE32}`);
		expect(uri).toContain("issuer=HUAN");
		expect(uri).toContain("digits=6");
		expect(uri).toContain("period=30");
	});
});
