import type { ServerEnv } from "@huan/config";
import { createHash } from "node:crypto";

/**
 * 開發環境沒設 `TOTP_SECRET_KEY` 時用的固定金鑰。
 *
 * 從一個常數字串雜湊出 32 bytes，讓本機每次啟動都得到同一把金鑰，重啟後既有的
 * TOTP 密鑰仍解得開。這把金鑰是公開的、毫無保護力，只為了讓開發環境不必先設定
 * 環境變數就能跑；production 一定要自己設一把真的。
 */
const DEV_FALLBACK_KEY = createHash("sha256").update("huan-totp-dev-key-do-not-use-in-production").digest();

/**
 * 解析出加密 TOTP 密鑰用的 32-byte 金鑰。
 *
 * production 一定要提供 `TOTP_SECRET_KEY`（base64 的 32 bytes），缺了就讓伺服器
 * 起不來——寧可不啟動，也不要靜默地退回一把公開的開發金鑰、把所有人的 TOTP 密鑰
 * 用眾所周知的金鑰加密。其他環境沒設就用上面的固定開發金鑰並印一次警告。
 */
export function resolveTotpKey(env: ServerEnv, warn: (message: string) => void): Buffer {
	if (env.TOTP_SECRET_KEY) {
		const key = Buffer.from(env.TOTP_SECRET_KEY, "base64");
		if (key.length !== 32) {
			throw new Error("TOTP_SECRET_KEY 必須是 base64 編碼的 32 bytes（可用 `openssl rand -base64 32` 產生）");
		}
		return key;
	}

	if (env.NODE_ENV === "production") {
		throw new Error("production 必須設定 TOTP_SECRET_KEY（base64 的 32 bytes）；沒有它 TOTP 密鑰就沒有加密金鑰");
	}

	/** 只在 development 提醒；test 大量建 context，印警告只是噪音。 */
	if (env.NODE_ENV === "development") {
		warn("未設定 TOTP_SECRET_KEY，改用固定的開發金鑰。這把金鑰是公開的，切勿用於 production。");
	}
	return DEV_FALLBACK_KEY;
}
