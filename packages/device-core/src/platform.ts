import type { DeviceArch, DevicePlatform, DisplayInfo } from "@huan/protocol";
import { readFile } from "node:fs/promises";
import { arch as osArch, platform as osPlatform, release, uptime } from "node:os";
import type { PlatformInfo, PlatformInfoProvider } from "./types.js";

export function toDevicePlatform(value: string): DevicePlatform {
	if (value === "linux" || value === "win32" || value === "darwin") return value;
	return "unknown";
}

export function toDeviceArch(value: string): DeviceArch {
	if (value === "x64" || value === "arm64" || value === "arm") return value;
	return "unknown";
}

/**
 * Raspberry Pi 與多數 Linux SBC 都把 CPU 溫度放在這裡，單位是千分之一度。
 * 讀不到就回 `null` —— Windows 與 macOS 本來就沒有這個檔案，那不是錯誤。
 */
export async function readLinuxTemperature(path = "/sys/class/thermal/thermal_zone0/temp"): Promise<number | null> {
	try {
		const raw = await readFile(path, "utf8");
		const milli = Number.parseInt(raw.trim(), 10);
		if (!Number.isFinite(milli)) return null;
		return Math.round((milli / 1000) * 10) / 10;
	} catch {
		return null;
	}
}

export interface NodePlatformInfoOptions {
	/** 無 GUI 的環境（模擬裝置、CI）沒有真正的顯示器，由呼叫端提供。 */
	displays?: DisplayInfo[];
	platform?: DevicePlatform;
	arch?: DeviceArch;
	osVersion?: string | null;
	readTemperature?: () => Promise<number | null>;
	uptimeSeconds?: () => number | null;
}

export function createNodePlatformInfoProvider(options: NodePlatformInfoOptions = {}): PlatformInfoProvider {
	const platform = options.platform ?? toDevicePlatform(osPlatform());
	const arch = options.arch ?? toDeviceArch(osArch());
	const readTemperature = options.readTemperature ?? (platform === "linux" ? () => readLinuxTemperature() : async () => null);
	return {
		async read(): Promise<PlatformInfo> {
			return {
				platform,
				arch,
				osVersion: options.osVersion !== undefined ? options.osVersion : release(),
				displays: options.displays ?? [],
				temperatureCelsius: await readTemperature(),
				uptimeSeconds: options.uptimeSeconds ? options.uptimeSeconds() : Math.round(uptime())
			};
		}
	};
}

/** 從 `1920x1080` 這種字串做出一個顯示器描述，模擬裝置與測試都用得到。 */
export function displayFromSize(size: string, index = 0): DisplayInfo | null {
	const match = /^(\d{2,5})x(\d{2,5})$/.exec(size.trim().toLowerCase());
	if (!match) return null;
	const width = Number.parseInt(match[1] ?? "", 10);
	const height = Number.parseInt(match[2] ?? "", 10);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
	return {
		id: `display-${index}`,
		label: `模擬顯示器 ${index + 1}`,
		width,
		height,
		scaleFactor: 1,
		orientation: width >= height ? "landscape" : "portrait",
		primary: index === 0
	};
}
