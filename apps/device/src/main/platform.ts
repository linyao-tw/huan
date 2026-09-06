import { readLinuxTemperature, toDeviceArch, toDevicePlatform, type PlatformInfo, type PlatformInfoProvider } from "@huan/device-core";
import type { DeviceArch, DevicePlatform, DisplayInfo } from "@huan/protocol";
import { screen } from "electron";
import { statfs } from "node:fs/promises";
import { arch as osArch, platform as osPlatform, release, uptime } from "node:os";

export interface DiskInfo {
	freeBytes: number | null;
	totalBytes: number | null;
}

/**
 * 平台差異全部收在這個介面後面。
 *
 * 沒有這一層，`process.platform === "win32"` 就會散落在下載、儲存、回報等各處，
 * 而每一處的判斷條件都會慢慢長歪。
 */
export interface PlatformAdapter extends PlatformInfoProvider {
	readonly platform: DevicePlatform;
	readonly arch: DeviceArch;
	getDisplays(): DisplayInfo[];
	getDiskInfo(path: string): Promise<DiskInfo>;
	getTemperature(): Promise<number | null>;
	getUptime(): number;
}

function displaysFromElectron(): DisplayInfo[] {
	const primaryId = screen.getPrimaryDisplay().id;
	return screen.getAllDisplays().map((display, index) => {
		const { width, height } = display.size;
		return {
			id: String(display.id),
			label: display.label || `顯示器 ${index + 1}`,
			width,
			height,
			scaleFactor: display.scaleFactor,
			orientation: width >= height ? ("landscape" as const) : ("portrait" as const),
			primary: display.id === primaryId
		};
	});
}

/**
 * `statfs` 在 Node 18.15 之後於三個平台都可用，因此不需要為了磁碟空間
 * 引入原生模組 —— 每多一個原生相依，六個平台架構的打包就多一分失敗的機會。
 */
async function readDisk(path: string): Promise<DiskInfo> {
	try {
		const stats = await statfs(path);
		return {
			freeBytes: Number(stats.bavail) * Number(stats.bsize),
			totalBytes: Number(stats.blocks) * Number(stats.bsize)
		};
	} catch {
		return { freeBytes: null, totalBytes: null };
	}
}

class BasePlatformAdapter implements PlatformAdapter {
	readonly platform: DevicePlatform;
	readonly arch: DeviceArch;

	constructor() {
		this.platform = toDevicePlatform(osPlatform());
		this.arch = toDeviceArch(osArch());
	}

	getDisplays(): DisplayInfo[] {
		return displaysFromElectron();
	}

	getDiskInfo(path: string): Promise<DiskInfo> {
		return readDisk(path);
	}

	/** 預設沒有可讀的溫度來源。回報 null 而不是 0：Admin 看到「—」才知道是讀不到。 */
	async getTemperature(): Promise<number | null> {
		return null;
	}

	getUptime(): number {
		return Math.round(uptime());
	}

	async read(): Promise<PlatformInfo> {
		return {
			platform: this.platform,
			arch: this.arch,
			osVersion: release(),
			displays: this.getDisplays(),
			temperatureCelsius: await this.getTemperature(),
			uptimeSeconds: this.getUptime()
		};
	}
}

class LinuxAdapter extends BasePlatformAdapter {
	/** Raspberry Pi 與多數 Linux SBC 把 CPU 溫度放在 thermal_zone0，讀不到就是 null。 */
	override getTemperature(): Promise<number | null> {
		return readLinuxTemperature();
	}
}

/** Windows 沒有不需要特殊權限就能取得 CPU 溫度的公開 API，因此永遠回報 null。 */
class WindowsAdapter extends BasePlatformAdapter {}

/** macOS 同樣沒有公開的溫度 API，回報 null。 */
class MacOSAdapter extends BasePlatformAdapter {}

export function createPlatformAdapter(): PlatformAdapter {
	switch (osPlatform()) {
		case "linux":
			return new LinuxAdapter();
		case "win32":
			return new WindowsAdapter();
		case "darwin":
			return new MacOSAdapter();
		default:
			return new BasePlatformAdapter();
	}
}
