import { describe, expect, it } from "vitest";
import { EnvValidationError, loadServerEnv, loadWorkerEnv, publicStorageEndpoint, shouldUseSecureCookie } from "./index.js";

const base = {
	DATABASE_URL: "postgres://huan:huan@localhost:5432/huan",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "huan",
	S3_SECRET_ACCESS_KEY: "huan-secret"
};

describe("loadServerEnv", () => {
	it("補上合理的預設值", () => {
		const env = loadServerEnv(base);
		expect(env.PORT).toBe(4000);
		expect(env.NODE_ENV).toBe("development");
		expect(env.S3_BUCKET).toBe("huan");
		expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
	});

	it("把逗號分隔的來源拆成陣列", () => {
		const env = loadServerEnv({ ...base, CORS_ORIGINS: "https://a.example, https://b.example" });
		expect(env.CORS_ORIGINS).toEqual(["https://a.example", "https://b.example"]);
	});

	it("缺少必要變數時明確指出是哪一個", () => {
		expect(() => loadServerEnv({ ...base, DATABASE_URL: undefined })).toThrow(EnvValidationError);
		try {
			loadServerEnv({ ...base, S3_ACCESS_KEY_ID: undefined });
		} catch (error) {
			expect((error as EnvValidationError).issues.join()).toContain("S3_ACCESS_KEY_ID");
		}
	});

	it("拒絕格式錯誤的網址", () => {
		expect(() => loadServerEnv({ ...base, PUBLIC_URL: "not-a-url" })).toThrow(EnvValidationError);
	});

	it("接受多種布林寫法", () => {
		expect(loadServerEnv({ ...base, S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE).toBe(false);
		expect(loadServerEnv({ ...base, S3_FORCE_PATH_STYLE: "yes" }).S3_FORCE_PATH_STYLE).toBe(true);
	});
});

describe("shouldUseSecureCookie", () => {
	it("production 預設要求 Secure", () => {
		expect(shouldUseSecureCookie({ NODE_ENV: "production", SESSION_COOKIE_SECURE: undefined })).toBe(true);
	});

	it("開發環境預設不要求", () => {
		expect(shouldUseSecureCookie({ NODE_ENV: "development", SESSION_COOKIE_SECURE: undefined })).toBe(false);
	});

	it("明確設定時以設定為準", () => {
		expect(shouldUseSecureCookie({ NODE_ENV: "development", SESSION_COOKIE_SECURE: true })).toBe(true);
	});
});

describe("publicStorageEndpoint", () => {
	it("沒有設定對外端點時沿用內部端點", () => {
		expect(publicStorageEndpoint({ S3_ENDPOINT: "http://rustfs:9000" })).toBe("http://rustfs:9000");
	});

	it("有設定時優先使用對外端點", () => {
		expect(publicStorageEndpoint({ S3_ENDPOINT: "http://rustfs:9000", S3_PUBLIC_ENDPOINT: "https://cdn.example" })).toBe("https://cdn.example");
	});
});

describe("loadWorkerEnv", () => {
	it("提供 FFmpeg 的預設執行檔名稱", () => {
		const env = loadWorkerEnv(base);
		expect(env.FFMPEG_PATH).toBe("ffmpeg");
		expect(env.FFPROBE_PATH).toBe("ffprobe");
		expect(env.WORKER_CONCURRENCY).toBe(2);
	});
});
