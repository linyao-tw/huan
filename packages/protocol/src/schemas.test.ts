import { describe, expect, it } from "vitest";
import { ColorSchema, ExternalUrlSchema, TimeZoneSchema } from "./common.js";
import { PairingCodeSchema } from "./device.js";
import { LayoutDocumentSchema, PLAYLIST_DEFAULT_IMAGE_DURATION_MS } from "./layout.js";
import { CreateScheduleRequestSchema } from "./schedule.js";
import { PasswordSchema, UsernameSchema } from "./user.js";

describe("TimeZoneSchema", () => {
	it("接受有效的 IANA 時區", () => {
		expect(TimeZoneSchema.parse("Asia/Taipei")).toBe("Asia/Taipei");
		expect(TimeZoneSchema.parse("America/New_York")).toBe("America/New_York");
	});

	it("拒絕不存在的時區", () => {
		expect(() => TimeZoneSchema.parse("Mars/Olympus")).toThrow();
		expect(() => TimeZoneSchema.parse("UTC+8")).toThrow();
	});
});

describe("ColorSchema", () => {
	it("接受 hex 與 rgb 寫法", () => {
		for (const value of ["#fff", "#ffffff", "#ffffff80", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)"]) {
			expect(ColorSchema.parse(value)).toBe(value);
		}
	});

	it("拒絕任意 CSS 字串", () => {
		for (const value of ["red; background: url(javascript:alert(1))", "var(--x)", "url(#a)", "expression(1)"]) {
			expect(() => ColorSchema.parse(value)).toThrow();
		}
	});
});

describe("ExternalUrlSchema", () => {
	it("接受 http 與 https", () => {
		expect(ExternalUrlSchema.parse("https://example.com/page")).toBe("https://example.com/page");
	});

	it("拒絕其他協定與內嵌帳密", () => {
		for (const value of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<h1>x</h1>", "https://user:pass@example.com"]) {
			expect(() => ExternalUrlSchema.parse(value)).toThrow();
		}
	});

	it("拒絕指向內網、loopback 與雲端 metadata 的位址", () => {
		for (const value of [
			"http://localhost:9000/",
			"http://127.0.0.1:4010/api/v1/devices",
			"https://foo.localhost/",
			"http://169.254.169.254/latest/meta-data/",
			"http://metadata.google.internal/",
			"http://10.0.0.5/",
			"http://192.168.1.1/",
			"http://172.16.0.1/",
			"http://[::1]:9000/",
			"http://service.internal/"
		]) {
			expect(() => ExternalUrlSchema.parse(value)).toThrow();
		}
	});

	it("拒絕把 IPv4 藏在 IPv6 裡的寫法（compatible / mapped / NAT64）", () => {
		for (const value of [
			"http://[::127.0.0.1]/", // IPv4-compatible，正規化成 ::7f00:1
			"http://[::ffff:127.0.0.1]/", // IPv4-mapped
			"http://[::ffff:169.254.169.254]/", // mapped 的 metadata
			"http://[64:ff9b::127.0.0.1]/", // NAT64 包 loopback
			"http://[64:ff9b::10.0.0.1]/", // NAT64 包私有網段
			"http://[fc00::1]/", // 唯一本地
			"http://[fe80::1]/" // link-local
		]) {
			expect(() => ExternalUrlSchema.parse(value)).toThrow();
		}
	});

	it("仍然接受一般的公開網址（含公開 IPv6）", () => {
		for (const value of ["https://example.com/", "https://172.15.0.1/", "https://8.8.8.8/", "https://[2001:4860:4860::8888]/"]) {
			expect(ExternalUrlSchema.parse(value)).toBe(value);
		}
	});
});

describe("PairingCodeSchema", () => {
	it("忽略連字號與大小寫", () => {
		expect(PairingCodeSchema.parse("abcd-2345")).toBe("ABCD2345");
	});

	it("拒絕含有易混淆字元的輸入", () => {
		expect(() => PairingCodeSchema.parse("0OI1ABCD")).toThrow();
	});

	it("拒絕長度不符的輸入", () => {
		expect(() => PairingCodeSchema.parse("ABC")).toThrow();
	});
});

describe("LayoutDocumentSchema", () => {
	const base = {
		canvas: { width: 1920, height: 1080 },
		background: { color: "#000000", imageAssetId: null, imageFit: "cover" },
		gap: 0,
		root: { type: "slot", id: "s1", content: null }
	};

	it("接受合法的巢狀分割樹", () => {
		const parsed = LayoutDocumentSchema.parse({
			...base,
			root: {
				type: "split",
				id: "d1",
				direction: "horizontal",
				ratio: 0.7,
				first: { type: "slot", id: "s1", content: null },
				second: {
					type: "split",
					id: "d2",
					direction: "vertical",
					ratio: 0.5,
					first: { type: "slot", id: "s2", content: null },
					second: { type: "slot", id: "s3", content: null }
				}
			}
		});
		expect(parsed.root.type).toBe("split");
	});

	it("補上內容的預設值", () => {
		const parsed = LayoutDocumentSchema.parse({
			...base,
			root: { type: "slot", id: "s1", content: { type: "text", text: "測試" } }
		});
		const content = parsed.root.type === "slot" ? parsed.root.content : null;
		expect(content).toMatchObject({ fontSize: 48, align: "center", verticalAlign: "center" });
	});

	it("拒絕超出範圍的畫布尺寸", () => {
		expect(() => LayoutDocumentSchema.parse({ ...base, canvas: { width: 10, height: 10 } })).toThrow();
		expect(() => LayoutDocumentSchema.parse({ ...base, canvas: { width: 99999, height: 1080 } })).toThrow();
	});

	it("拒絕無法操作的分割比例", () => {
		expect(() =>
			LayoutDocumentSchema.parse({
				...base,
				root: { type: "split", id: "d1", direction: "horizontal", ratio: 0.999, first: base.root, second: { type: "slot", id: "s2", content: null } }
			})
		).toThrow();
	});

	it("接受圖片影片混排的媒體輪播，並捨棄舊文件的逐則秒數", () => {
		const parsed = LayoutDocumentSchema.parse({
			...base,
			root: {
				type: "slot",
				id: "s1",
				content: {
					type: "playlist",
					items: [
						{ assetId: "11111111-1111-4111-8111-111111111111", kind: "image", durationMs: 5000 },
						{ assetId: "22222222-2222-4222-8222-222222222222", kind: "video" }
					]
				}
			}
		});
		const content = parsed.root.type === "slot" ? parsed.root.content : null;
		expect(content?.type).toBe("playlist");
		/** 停留秒數改成整份清單共用，舊文件裡的逐則秒數會被丟掉，回到預設值。 */
		expect(content?.type === "playlist" && content.imageDurationMs).toBe(PLAYLIST_DEFAULT_IMAGE_DURATION_MS);
		expect(content?.type === "playlist" && content.items[0]).toEqual({ assetId: "11111111-1111-4111-8111-111111111111", kind: "image" });
	});

	it("拒絕沒有任何一則的空輪播", () => {
		expect(() =>
			LayoutDocumentSchema.parse({
				...base,
				root: { type: "slot", id: "s1", content: { type: "playlist", items: [] } }
			})
		).toThrow();
	});
});

describe("CreateScheduleRequestSchema", () => {
	const base = {
		name: "早餐時段",
		layoutId: "11111111-1111-4111-8111-111111111111",
		timezone: "Asia/Taipei",
		daysOfWeek: [1, 2, 3, 4, 5],
		startTime: "08:00",
		endTime: "11:00"
	};

	it("補上預設值", () => {
		const parsed = CreateScheduleRequestSchema.parse(base);
		expect(parsed.priority).toBe(100);
		expect(parsed.enabled).toBe(true);
		expect(parsed.deviceIds).toEqual([]);
	});

	it("拒絕開始與結束相同的時間", () => {
		expect(() => CreateScheduleRequestSchema.parse({ ...base, startTime: "08:00", endTime: "08:00" })).toThrow();
	});

	it("接受跨午夜的時間", () => {
		expect(CreateScheduleRequestSchema.parse({ ...base, startTime: "22:00", endTime: "02:00" }).endTime).toBe("02:00");
	});

	it("拒絕結束早於開始的日期區間", () => {
		expect(() => CreateScheduleRequestSchema.parse({ ...base, startDate: "2026-03-10", endDate: "2026-03-01" })).toThrow();
	});

	it("拒絕格式錯誤的時間", () => {
		expect(() => CreateScheduleRequestSchema.parse({ ...base, startTime: "8:00" })).toThrow();
		expect(() => CreateScheduleRequestSchema.parse({ ...base, endTime: "25:00" })).toThrow();
	});
});

describe("使用者欄位", () => {
	it("帳號限制為小寫英數與少數符號", () => {
		expect(UsernameSchema.parse("huan.admin")).toBe("huan.admin");
		expect(() => UsernameSchema.parse("HUAN")).toThrow();
		expect(() => UsernameSchema.parse("a")).toThrow();
		expect(() => UsernameSchema.parse(".leading")).toThrow();
	});

	it("密碼長度下限為 12", () => {
		expect(() => PasswordSchema.parse("short")).toThrow();
		expect(PasswordSchema.parse("a-long-enough-password")).toBe("a-long-enough-password");
	});
});
