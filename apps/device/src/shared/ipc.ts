import type { DeviceAgentStatus } from "@huan/device-core";
import type { DeviceArch, DeviceIdle, DevicePlatform, DisplayInfo } from "@huan/protocol";

/** 上傳的 HTML 跑在自己的 session partition，與播放器本身完全隔離。 */
export const SANDBOX_PARTITION = "huan-sandbox";

export interface DeviceSnapshot {
	status: DeviceAgentStatus;
	online: boolean;
	deviceId: string | null;
	deviceName: string;
	serverUrl: string;
	appVersion: string;
	platform: DevicePlatform;
	arch: DeviceArch;
	osVersion: string | null;
	displays: DisplayInfo[];
	temperatureCelsius: number | null;
	uptimeSeconds: number | null;
	diskFreeBytes: number | null;
	diskTotalBytes: number | null;
	desiredVersion: number | null;
	activeVersion: number | null;
	lastSyncedAt: string | null;
	currentLayoutName: string | null;
	currentScheduleName: string | null;
	readyAssetCount: number;
	totalAssetCount: number;
	storageError: string | null;
	revokePending: boolean;
	/** 沒有版面可播時要顯示什麼。跟著目標狀態一起下來，離線時沿用本機那一份。 */
	idle: DeviceIdle;
}

export interface PairingSnapshot {
	code: string;
	pairingUrl: string;
	/** 主行程產生的 QR Code data URL。編碼放在主行程，renderer 不需要多帶一個函式庫。 */
	qrDataUrl: string | null;
	expiresAt: string;
	error: string | null;
}
