import { readFile, rm } from "node:fs/promises";
import { describeError, silentLogger, type Logger } from "./logger.js";
import { atomicWriteFile, isNotFound } from "./storage.js";

/**
 * 裝置憑證的存放介面。
 *
 * 刻意做成可注入：Electron 播放器提供的實作會用 `safeStorage.encryptString`
 * 把密文交給作業系統保管（macOS Keychain、Windows DPAPI、Linux libsecret），
 * 模擬裝置與整合測試則用下面的 0600 檔案版本。device-core 其餘部分完全不需要知道差別。
 */
export interface CredentialStore {
	get(): Promise<string | null>;
	set(secret: string): Promise<void>;
	clear(): Promise<void>;
}

/**
 * 純檔案實作，權限鎖在 `0600`。
 *
 * 這個實作只保護「同一台機器上的其他使用者」，不防備能讀取磁碟映像的攻擊者。
 * 正式的 Electron 播放器請改用 OS 金鑰鏈實作 —— 這裡不做加密，是因為把金鑰
 * 跟密文放在同一個目錄只是自我安慰，不會真的增加安全性。
 */
export class FileCredentialStore implements CredentialStore {
	private cached: string | null = null;
	private loaded = false;

	constructor(
		private readonly filePath: string,
		private readonly logger: Logger = silentLogger
	) {}

	async get(): Promise<string | null> {
		if (this.loaded) return this.cached;
		try {
			const raw = await readFile(this.filePath, "utf8");
			this.cached = raw.trim() === "" ? null : raw.trim();
		} catch (error) {
			if (!isNotFound(error)) this.logger.warn("讀取裝置憑證失敗", { error: describeError(error) });
			this.cached = null;
		}
		this.loaded = true;
		return this.cached;
	}

	async set(secret: string): Promise<void> {
		await atomicWriteFile(this.filePath, `${secret}\n`, { mode: 0o600 });
		this.cached = secret;
		this.loaded = true;
	}

	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
		this.cached = null;
		this.loaded = true;
	}
}

/** 測試與一次性流程用的記憶體實作。 */
export class MemoryCredentialStore implements CredentialStore {
	private secret: string | null;

	constructor(initial: string | null = null) {
		this.secret = initial;
	}

	async get(): Promise<string | null> {
		return this.secret;
	}

	async set(secret: string): Promise<void> {
		this.secret = secret;
	}

	async clear(): Promise<void> {
		this.secret = null;
	}
}

/**
 * 組出 `Authorization: Bearer <deviceId>.<secret>` 的 token 部分。
 *
 * 伺服器回傳的 `credential` 可能是裸 secret，也可能已經是組好的 `<deviceId>.<secret>`。
 * 兩種都接受，避免整台裝置只因為前綴差一段就永遠連不上；secret 是 base64url，
 * 本身不含 `.`，所以這個判斷不會誤判。
 */
export function buildDeviceToken(deviceId: string, credential: string): string {
	return credential.startsWith(`${deviceId}.`) ? credential : `${deviceId}.${credential}`;
}
