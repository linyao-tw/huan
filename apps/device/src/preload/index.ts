import type { DeviceSnapshot, PairingSnapshot } from "@/shared/ipc";
import type { ScheduleTarget } from "@huan/device-core";
import { contextBridge, ipcRenderer } from "electron";

/**
 * 暴露給 renderer 的完整介面。
 *
 * 這裡刻意只有幾個具體的操作，沒有任何「執行任意 IPC」的通道：
 * renderer 會載入使用者上傳的內容，一旦給它一個泛用的 invoke，
 * contextIsolation 就形同虛設。
 */
const api = {
	getSnapshot: (): Promise<DeviceSnapshot> => ipcRenderer.invoke("device:snapshot"),
	getLayout: (): Promise<ScheduleTarget | null> => ipcRenderer.invoke("device:layout"),
	getPairing: (): Promise<PairingSnapshot | null> => ipcRenderer.invoke("device:pairing"),
	sync: (): Promise<boolean> => ipcRenderer.invoke("device:sync"),
	unbind: (): Promise<boolean> => ipcRenderer.invoke("device:unbind"),
	restartPairing: (): Promise<boolean> => ipcRenderer.invoke("device:restart-pairing"),
	setServerUrl: (value: string): Promise<boolean> => ipcRenderer.invoke("device:set-server-url", value),
	getAssets: (): Promise<Record<string, string>> => ipcRenderer.invoke("device:assets"),
	mediaUrl: (fileName: string): Promise<string | null> => ipcRenderer.invoke("device:media-url", fileName),

	onSnapshot: (listener: (snapshot: DeviceSnapshot) => void): (() => void) => subscribe("device:snapshot", listener),
	onLayout: (listener: (target: ScheduleTarget | null) => void): (() => void) => subscribe("device:layout", listener),
	onPairing: (listener: (pairing: PairingSnapshot | null) => void): (() => void) => subscribe("device:pairing", listener),
	onOpenPanel: (listener: (open: boolean) => void): (() => void) => subscribe("device:open-panel", listener)
};

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
	const handler = (_event: unknown, payload: T): void => listener(payload);
	ipcRenderer.on(channel, handler);
	return () => {
		ipcRenderer.off(channel, handler);
	};
}

contextBridge.exposeInMainWorld("huan", api);

export type HuanBridge = typeof api;
