import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * 產生 8 個字元的配對碼。
 *
 * 字母表排除 0/O/1/I，是因為這串字會被人從螢幕上抄到後台；
 * 使用 `randomInt` 而不是取餘數，避免字母表長度不整除造成的分布偏差。
 */
export function generatePairingCode(): string {
	let code = "";
	for (let index = 0; index < 8; index += 1) {
		code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
	}
	return code;
}

/** URL-safe 的隨機字串，用於 session token、pairing token 與裝置憑證。 */
export function generateOpaqueToken(byteLength = 32): string {
	return randomBytes(byteLength).toString("base64url");
}

/** 復原碼以 `XXXXX-XXXXX` 呈現，實際比對時只看去掉連字號後的大寫字串。 */
export function generateRecoveryCode(): string {
	const raw = Array.from({ length: 10 }, () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)]).join("");
	return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
	return code.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

export function generateTotpSecretBytes(byteLength = 20): Uint8Array {
	return new Uint8Array(randomBytes(byteLength));
}

/**
 * 不可逆地雜湊一個高熵 token。
 *
 * Session token 與裝置憑證都是隨機產生的 256 bit 值，不需要 Argon2 那種
 * 針對低熵密碼的慢雜湊；單次 SHA-256 就足夠，而且讓每次請求的驗證成本維持在微秒等級。
 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
	} catch {
		return false;
	}
}

export function sha256Hex(data: Buffer | string): string {
	return createHash("sha256").update(data).digest("hex");
}

/**
 * 用 AES-256-GCM 加密一段短字串（例如 TOTP 密鑰），輸出 base64 的 iv‖tag‖ciphertext。
 *
 * 每次都用新的隨機 12-byte IV，GCM 的 16-byte tag 一併驗證完整性，被竄改的密文
 * 解密時會直接丟例外而不是回傳錯誤的明文。金鑰必須是 32 bytes。
 */
export function encryptWithKey(key: Buffer, plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** `encryptWithKey` 的反向操作。密文被動過或金鑰不對時丟例外，絕不回傳半對的明文。 */
export function decryptWithKey(key: Buffer, payload: string): string {
	const raw = Buffer.from(payload, "base64");
	const iv = raw.subarray(0, 12);
	const tag = raw.subarray(12, 28);
	const ciphertext = raw.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** 串流計算檔案的 SHA-256，避免把幾百 MB 的影片整個讀進記憶體。 */
export async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(createReadStream(filePath), hash);
	return hash.digest("hex");
}
