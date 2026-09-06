import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

export interface DeviceSettings {
	serverUrl: string;
	deviceName: string;
	kiosk: boolean;
}

function defaults(): DeviceSettings {
	return {
		serverUrl: process.env.HUAN_SERVER_URL ?? "http://localhost:4000",
		deviceName: process.env.HUAN_DEVICE_NAME ?? hostname(),
		kiosk: process.env.HUAN_KIOSK !== "false"
	};
}

function settingsPath(appDataDir: string): string {
	return join(appDataDir, "config", "settings.json");
}

export async function readDeviceSettings(appDataDir: string): Promise<DeviceSettings> {
	try {
		const raw = await readFile(settingsPath(appDataDir), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return defaults();
		const record = parsed as Record<string, unknown>;
		const base = defaults();
		return {
			serverUrl: typeof record.serverUrl === "string" && record.serverUrl.length > 0 ? record.serverUrl : base.serverUrl,
			deviceName: typeof record.deviceName === "string" && record.deviceName.length > 0 ? record.deviceName : base.deviceName,
			kiosk: typeof record.kiosk === "boolean" ? record.kiosk : base.kiosk
		};
	} catch {
		/** 設定檔不存在或壞掉時退回預設值，而不是讓播放器開不起來。 */
		return defaults();
	}
}

/** 與 device-core 一致的原子寫入：先寫暫存檔再 rename，斷電不會留下半份設定。 */
export async function writeDeviceSettings(appDataDir: string, settings: DeviceSettings): Promise<void> {
	const target = settingsPath(appDataDir);
	await mkdir(join(appDataDir, "config"), { recursive: true });
	const temporary = `${target}.tmp`;
	await writeFile(temporary, `${JSON.stringify(settings, null, "\t")}\n`, "utf8");
	await rename(temporary, target);
}
