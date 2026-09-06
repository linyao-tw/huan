import type { CredentialStore } from "@huan/device-core";
import { safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 用作業系統提供的加密能力保管裝置憑證。
 *
 * `safeStorage` 在 macOS 走鑰匙圈、Windows 走 DPAPI、Linux 走 libsecret，
 * 因此不需要為了「不要明文存密碼」這件事引入任何原生模組。
 *
 * 系統沒有可用的金鑰環時（例如無人值守、沒有解鎖 keyring 的 Linux 看板機），
 * `isEncryptionAvailable()` 會回 false。此時退回權限 0600 的檔案，並記錄警告 ——
 * 拒絕啟動會讓一台已經配對好的看板在重開機後變成黑畫面，那比較糟；
 * 裝置憑證的權限範圍僅限這一台裝置，而且隨時可以從後台撤銷。
 */
export class ElectronCredentialStore implements CredentialStore {
	constructor(
		private readonly filePath: string,
		private readonly onFallback?: (message: string) => void
	) {}

	async get(): Promise<string | null> {
		try {
			const raw = await readFile(this.filePath);
			if (raw.length === 0) return null;
			if (raw.subarray(0, 4).toString("utf8") === "enc:") {
				if (!safeStorage.isEncryptionAvailable()) return null;
				return safeStorage.decryptString(raw.subarray(4));
			}
			return raw.toString("utf8");
		} catch {
			return null;
		}
	}

	async set(credential: string): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		if (safeStorage.isEncryptionAvailable()) {
			const encrypted = safeStorage.encryptString(credential);
			await writeFile(this.filePath, Buffer.concat([Buffer.from("enc:", "utf8"), encrypted]), { mode: 0o600 });
			return;
		}
		this.onFallback?.("作業系統沒有提供可用的加密儲存，裝置憑證改以權限 0600 的檔案保存。");
		await writeFile(this.filePath, credential, { encoding: "utf8", mode: 0o600 });
	}

	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
	}
}
