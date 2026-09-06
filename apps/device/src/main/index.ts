import { ElectronCredentialStore } from "@/main/credentials";
import { createConsoleLogger } from "@/main/logger";
import { createPlatformAdapter } from "@/main/platform";
import { hardenSandboxSession, HUAN_MEDIA_SCHEME, registerMediaProtocol, registerMediaProtocolSchemes } from "@/main/protocol";
import { readDeviceSettings, writeDeviceSettings } from "@/main/settings";
import type { DeviceSnapshot, PairingSnapshot } from "@/shared/ipc";
import { SANDBOX_PARTITION } from "@/shared/ipc";
import { DeviceAgent, type DeviceAgentStatus, type ScheduleTarget } from "@huan/device-core";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { toDataURL } from "qrcode";

registerMediaProtocolSchemes();

const logger = createConsoleLogger();
const platform = createPlatformAdapter();

/** 只允許單一實例：兩個播放器同時操作同一份本機狀態會讓 manifest 互相覆蓋。 */
if (!app.requestSingleInstanceLock()) {
	app.quit();
}

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: DeviceAgent | null = null;
let pairing: PairingSnapshot | null = null;
let target: ScheduleTarget | null = null;
let status: DeviceAgentStatus = "stopped";
let storageError: string | null = null;
let pairingAbort: AbortController | null = null;

const isDevelopment = !app.isPackaged;

function appDataDir(): string {
	return join(app.getPath("userData"), "huan");
}

function send(channel: string, payload: unknown): void {
	window?.webContents.send(channel, payload);
}

async function buildSnapshot(): Promise<DeviceSnapshot> {
	const info = await platform.read();
	const disk = await platform.getDiskInfo(appDataDir());
	const assets = agent ? await agent.assetSummary() : { readyAssetIds: [], pendingAssetIds: [], readyCount: 0, totalCount: 0 };
	const settings = await readDeviceSettings(appDataDir());
	return {
		status,
		online: agent?.online ?? false,
		deviceId: agent?.deviceIdentity?.deviceId ?? null,
		deviceName: agent?.deviceIdentity?.deviceName ?? settings.deviceName,
		serverUrl: settings.serverUrl,
		appVersion: app.getVersion(),
		platform: info.platform,
		arch: info.arch,
		osVersion: info.osVersion,
		displays: info.displays,
		temperatureCelsius: info.temperatureCelsius,
		uptimeSeconds: info.uptimeSeconds,
		diskFreeBytes: disk.freeBytes,
		diskTotalBytes: disk.totalBytes,
		desiredVersion: agent?.desiredVersion ?? null,
		activeVersion: agent?.activeVersion ?? null,
		lastSyncedAt: agent?.lastSyncedAt ?? null,
		currentLayoutName: target?.layout?.name ?? null,
		currentScheduleName: target?.scheduleName ?? null,
		readyAssetCount: assets.readyCount,
		totalAssetCount: assets.totalCount,
		storageError,
		revokePending: agent?.revokePending ?? false
	};
}

async function pushSnapshot(): Promise<void> {
	if (!window) return;
	send("device:snapshot", await buildSnapshot());
}

function pushTarget(): void {
	send("device:layout", target);
}

async function createWindow(): Promise<void> {
	const settings = await readDeviceSettings(appDataDir());

	window = new BrowserWindow({
		width: 1280,
		height: 720,
		show: false,
		backgroundColor: "#000000",
		autoHideMenuBar: true,
		fullscreen: !isDevelopment,
		kiosk: !isDevelopment && settings.kiosk,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			/**
			 * 這三個設定不會為了任何功能而放寬。播放使用者上傳的 HTML 也一樣 ——
			 * 那份 HTML 會在再一層 sandbox iframe 裡執行，而不是靠關掉這些開關。
			 */
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webviewTag: false
		}
	});

	window.once("ready-to-show", () => window?.show());

	/** 播放器不是瀏覽器：任何想要導航到外部網址的行為都交給系統瀏覽器，不在 kiosk 視窗裡開。 */
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith("http://localhost") && !url.startsWith("file://")) event.preventDefault();
	});

	if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
		await window.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}
}

function createTray(): void {
	/**
	 * 系統匣圖示是綁定後唯一的本機入口。看板平常是全螢幕的，
	 * 沒有這個入口就得靠鍵盤快捷鍵才能看裝置資訊或解除綁定。
	 */
	const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
	tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
	tray.setToolTip("HUAN 讙 播放器");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "裝置資訊", click: () => send("device:open-panel", true) },
			{ label: "立即同步", click: () => void agent?.sync("manual") },
			{ type: "separator" },
			{ label: "結束", click: () => app.quit() }
		])
	);
}

const TRAY_ICON_DATA_URL =
	"data:image/svg+xml;base64," +
	Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><rect x="1" y="3" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="6" width="9" height="8" rx="1" fill="currentColor"/><rect x="15" y="6" width="3" height="3.5" rx="1" fill="currentColor"/><rect x="15" y="10.5" width="3" height="3.5" rx="1" fill="currentColor"/></svg>`
	).toString("base64");

async function createAgent(): Promise<DeviceAgent> {
	const dir = appDataDir();
	const settings = await readDeviceSettings(dir);

	const instance = new DeviceAgent({
		appDataDir: dir,
		serverUrl: settings.serverUrl,
		deviceName: settings.deviceName,
		appVersion: app.getVersion(),
		platform,
		credentials: new ElectronCredentialStore(join(dir, "config", "credential.bin"), message => logger.warn(message)),
		diskUsage: async () => {
			const disk = await platform.getDiskInfo(dir);
			return { freeBytes: disk.freeBytes ?? 0, totalBytes: disk.totalBytes ?? 0 };
		},
		logger,
		/** 由播放器自己的畫面主導配對流程，不要在背景默默開始。 */
		autoPair: false
	});

	instance.events.on("status", next => {
		status = next;
		void pushSnapshot();
	});
	instance.events.on("online", () => void pushSnapshot());
	instance.events.on("pairing_code", code => {
		pairing = { code: code.code, pairingUrl: code.pairingUrl, qrDataUrl: null, expiresAt: code.expiresAt, error: null };
		send("device:pairing", pairing);
		/** QR 編碼在主行程做完再推一次，配對碼本身可以先顯示，不必等圖產生。 */
		void toDataURL(code.pairingUrl, { margin: 1, width: 512, errorCorrectionLevel: "M" })
			.then(dataUrl => {
				if (pairing?.code !== code.code) return;
				pairing = { ...pairing, qrDataUrl: dataUrl };
				send("device:pairing", pairing);
			})
			.catch(error => logger.warn("QR Code 產生失敗", { error: String(error) }));
	});
	instance.events.on("pairing_failed", ({ reason }) => {
		pairing = pairing ? { ...pairing, error: reason } : { code: "", pairingUrl: "", qrDataUrl: null, expiresAt: "", error: reason };
		send("device:pairing", pairing);
	});
	instance.events.on("paired", () => {
		pairing = null;
		send("device:pairing", null);
		void pushSnapshot();
	});
	instance.events.on("layout_changed", next => {
		target = next;
		pushTarget();
		void pushSnapshot();
	});
	instance.events.on("sync_finished", () => void pushSnapshot());
	instance.events.on("asset_progress", () => void pushSnapshot());
	instance.events.on("heartbeat", () => void pushSnapshot());
	instance.events.on("restart_player", () => {
		/** 重新載入 renderer 就足夠了：主行程持有的狀態沒有壞掉，重啟整個 app 只會讓畫面黑得更久。 */
		window?.webContents.reload();
	});
	instance.events.on("unbound", () => {
		target = null;
		pushTarget();
		void pushSnapshot();
		void startPairing();
	});
	instance.reconciler.events.on("storage_error", ({ message }) => {
		storageError = message;
		void pushSnapshot();
	});

	return instance;
}

async function startPairing(): Promise<void> {
	if (!agent) return;
	pairingAbort?.abort();
	pairingAbort = new AbortController();
	try {
		await agent.pair({ signal: pairingAbort.signal });
	} catch (error) {
		logger.error("配對流程結束", { error: String(error) });
	}
}

function registerIpc(): void {
	ipcMain.handle("device:snapshot", () => buildSnapshot());
	ipcMain.handle("device:layout", () => target);
	ipcMain.handle("device:pairing", () => pairing);
	ipcMain.handle("device:sync", async () => {
		await agent?.sync("manual");
		return true;
	});
	ipcMain.handle("device:unbind", async () => {
		await agent?.unbind();
		return true;
	});
	ipcMain.handle("device:restart-pairing", async () => {
		await startPairing();
		return true;
	});
	ipcMain.handle("device:set-server-url", async (_event, value: unknown) => {
		if (typeof value !== "string" || value.length === 0 || value.length > 300) return false;
		try {
			const url = new URL(value);
			if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		} catch {
			return false;
		}
		/** 只有還沒綁定時才允許改伺服器位址；綁定後換位址等於偷換帳戶。 */
		if (agent && (await agent.storage.readIdentity())) return false;
		const current = await readDeviceSettings(appDataDir());
		await writeDeviceSettings(appDataDir(), { ...current, serverUrl: value });
		await restartAgent();
		return true;
	});
	/**
	 * 目前啟用版本的 assetId → 本機檔名對照。
	 *
	 * renderer 只拿得到檔名，拿不到路徑：實際位置由主行程的自訂協定解析，
	 * 沙箱裡的頁面因此不可能推導出媒體目錄以外的任何路徑。
	 */
	ipcMain.handle("device:assets", async () => {
		const manifest = await agent?.storage.readActiveManifest();
		if (!manifest) return {};
		const map: Record<string, string> = {};
		for (const asset of manifest.assets) map[asset.assetId] = asset.filename;
		return map;
	});
	ipcMain.handle("device:media-url", (_event, fileName: unknown) => {
		if (typeof fileName !== "string") return null;
		return `${HUAN_MEDIA_SCHEME}://media/${encodeURIComponent(fileName)}`;
	});
}

async function restartAgent(): Promise<void> {
	await agent?.stop();
	agent = await createAgent();
	await agent.start();
	if (!(await agent.storage.readIdentity())) await startPairing();
}

app.whenReady().then(async () => {
	const dir = appDataDir();
	registerMediaProtocol(join(dir, "media"));
	hardenSandboxSession(SANDBOX_PARTITION);
	registerIpc();

	await createWindow();
	createTray();

	/** 開發時常常需要在全螢幕下打開開發者工具或退出 kiosk。 */
	globalShortcut.register("CommandOrControl+Shift+I", () => window?.webContents.toggleDevTools());
	globalShortcut.register("CommandOrControl+Shift+D", () => send("device:open-panel", true));
	globalShortcut.register("Escape", () => {
		if (window?.isKiosk()) window.setKiosk(false);
	});

	agent = await createAgent();
	await agent.start();
	target = agent.currentTarget;
	pushTarget();
	if (!(await agent.storage.readIdentity())) await startPairing();
	await pushSnapshot();
});

app.on("second-instance", () => {
	if (!window) return;
	if (window.isMinimized()) window.restore();
	window.focus();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", async () => {
	globalShortcut.unregisterAll();
	pairingAbort?.abort();
	tray?.destroy();
	await agent?.stop();
});
