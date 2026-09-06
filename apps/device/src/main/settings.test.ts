import { readDeviceSettings, writeDeviceSettings } from "@/main/settings";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir = "";

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "huan-settings-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("readDeviceSettings", () => {
	it("沒有設定檔時回傳預設值", async () => {
		const settings = await readDeviceSettings(dir);
		expect(settings.serverUrl).toMatch(/^https?:\/\//);
		expect(settings.deviceName.length).toBeGreaterThan(0);
	});

	/**
	 * 看板通常裝在牆上，沒有 UPS。半寫入或損毀的設定檔不能讓播放器開不起來，
	 * 那會把一次斷電變成一次到場維修。
	 */
	it("設定檔損毀時退回預設值而不是拋例外", async () => {
		await mkdir(join(dir, "config"), { recursive: true });
		await writeFile(join(dir, "config", "settings.json"), "{ 這不是 JSON", "utf8");
		await expect(readDeviceSettings(dir)).resolves.toHaveProperty("serverUrl");
	});

	it("欄位型別不對時只忽略那一個欄位", async () => {
		await mkdir(join(dir, "config"), { recursive: true });
		await writeFile(join(dir, "config", "settings.json"), JSON.stringify({ serverUrl: 42, deviceName: "門市 A", kiosk: "yes" }), "utf8");
		const settings = await readDeviceSettings(dir);
		expect(settings.deviceName).toBe("門市 A");
		expect(settings.serverUrl).toMatch(/^https?:\/\//);
		expect(typeof settings.kiosk).toBe("boolean");
	});
});

describe("writeDeviceSettings", () => {
	it("寫入後讀得回來", async () => {
		await writeDeviceSettings(dir, { serverUrl: "https://huan.example.com", deviceName: "櫃檯螢幕", kiosk: false });
		expect(await readDeviceSettings(dir)).toEqual({ serverUrl: "https://huan.example.com", deviceName: "櫃檯螢幕", kiosk: false });
	});

	it("寫入是原子的，不會留下暫存檔", async () => {
		await writeDeviceSettings(dir, { serverUrl: "https://huan.example.com", deviceName: "櫃檯螢幕", kiosk: true });
		const { readdir } = await import("node:fs/promises");
		const entries = await readdir(join(dir, "config"));
		expect(entries).toContain("settings.json");
		expect(entries.some(name => name.endsWith(".tmp"))).toBe(false);
	});
});
