import { DEFAULT_SERVER_URL, UsageError, parseArgs, slugify } from "@/cli";
import { describe, expect, it } from "vitest";

/** 環境變數的預設值會干擾斷言，因此每個測試都傳入乾淨的環境。 */
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe("parseArgs", () => {
	it("沒有任何參數時給出可用的預設值", () => {
		const options = parseArgs([], EMPTY_ENV);
		expect(options.serverUrl).toBe(DEFAULT_SERVER_URL);
		expect(options.platform).toBe("linux");
		expect(options.arch).toBe("arm64");
		expect(options.displays).toHaveLength(1);
		expect(options.displays[0]).toMatchObject({ width: 1920, height: 1080, orientation: "landscape", primary: true });
	});

	it("讀取旗標", () => {
		const options = parseArgs(["--server", "https://huan.example.com", "--name", "門市 A", "--platform", "win32", "--arch", "x64", "--verbose"], EMPTY_ENV);
		expect(options.serverUrl).toBe("https://huan.example.com");
		expect(options.deviceName).toBe("門市 A");
		expect(options.platform).toBe("win32");
		expect(options.arch).toBe("x64");
		expect(options.verbose).toBe(true);
	});

	it("旗標蓋過環境變數", () => {
		const options = parseArgs(["--server", "https://flag.example.com"], { HUAN_SERVER_URL: "https://env.example.com" });
		expect(options.serverUrl).toBe("https://flag.example.com");
	});

	it("去掉伺服器網址結尾的斜線，避免組出 //api/v1 這種路徑", () => {
		expect(parseArgs(["--server", "http://localhost:4000///"], EMPTY_ENV).serverUrl).toBe("http://localhost:4000");
	});

	it("支援多個顯示器，第一個是主要顯示器", () => {
		const options = parseArgs(["--display", "1920x1080", "--display", "1080x1920"], EMPTY_ENV);
		expect(options.displays).toHaveLength(2);
		expect(options.displays[0]?.primary).toBe(true);
		expect(options.displays[1]?.primary).toBe(false);
		expect(options.displays[1]?.orientation).toBe("portrait");
	});

	/**
	 * 預設的資料目錄以裝置名稱命名：同一個 --name 重跑會沿用上次的配對，
	 * 換一個名字就是一台全新的裝置。
	 */
	it("不同的裝置名稱得到不同的資料目錄", () => {
		const first = parseArgs(["--name", "門市 A"], EMPTY_ENV).dataDir;
		const second = parseArgs(["--name", "門市 B"], EMPTY_ENV).dataDir;
		expect(first).not.toBe(second);
		expect(parseArgs(["--name", "門市 A"], EMPTY_ENV).dataDir).toBe(first);
	});

	it("明確指定的資料目錄會被解析成絕對路徑", () => {
		expect(parseArgs(["--data-dir", "./sim-data"], EMPTY_ENV).dataDir.startsWith("/")).toBe(true);
	});

	it("拒絕不認得的參數", () => {
		expect(() => parseArgs(["--nope"], EMPTY_ENV)).toThrow(UsageError);
	});

	it("旗標缺少值時明確報錯，而不是把下一個旗標吃掉", () => {
		expect(() => parseArgs(["--server", "--verbose"], EMPTY_ENV)).toThrow(UsageError);
	});

	it("拒絕格式錯誤的顯示器尺寸與網址", () => {
		expect(() => parseArgs(["--display", "1920"], EMPTY_ENV)).toThrow(UsageError);
		expect(() => parseArgs(["--display", "abc x def"], EMPTY_ENV)).toThrow(UsageError);
		expect(() => parseArgs(["--server", "ftp://example.com"], EMPTY_ENV)).toThrow(UsageError);
	});

	it("--help 不需要其他參數也能成立", () => {
		expect(parseArgs(["--help"], EMPTY_ENV).help).toBe(true);
		expect(parseArgs(["-h"], EMPTY_ENV).help).toBe(true);
	});
});

describe("slugify", () => {
	it("把裝置名稱轉成安全的目錄名稱", () => {
		expect(slugify("門市 A")).not.toContain(" ");
		expect(slugify("../../etc")).not.toContain("/");
		expect(slugify("Store#1")).toMatch(/^[a-z0-9-]*$/i);
	});

	it("完全沒有可用字元時仍然回傳非空字串", () => {
		expect(slugify("///").length).toBeGreaterThan(0);
	});
});
