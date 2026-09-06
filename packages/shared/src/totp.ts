const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

export function base32Decode(input: string): Uint8Array {
	const normalized = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];
	for (const char of normalized) {
		const index = BASE32_ALPHABET.indexOf(char);
		if (index === -1) throw new Error("Base32 字串含有無效字元");
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Uint8Array.from(bytes);
}

export interface TotpOptions {
	/** 時間步長（秒）。RFC 6238 的預設值是 30。 */
	stepSeconds?: number;
	digits?: number;
	algorithm?: "SHA-1" | "SHA-256" | "SHA-512";
}

const DEFAULT_OPTIONS: Required<TotpOptions> = {
	stepSeconds: 30,
	digits: 6,
	algorithm: "SHA-1"
};

function counterToBytes(counter: number): Uint8Array {
	const bytes = new Uint8Array(8);
	const view = new DataView(bytes.buffer);
	view.setBigUint64(0, BigInt(counter), false);
	return bytes;
}

async function hmac(keyBytes: Uint8Array, message: Uint8Array, algorithm: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", keyBytes as unknown as ArrayBuffer, { name: "HMAC", hash: algorithm }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, message as unknown as ArrayBuffer);
	return new Uint8Array(signature);
}

/** RFC 4226 的 HOTP。TOTP 只是把計數器換成時間步長。 */
export async function hotp(secret: Uint8Array, counter: number, options: TotpOptions = {}): Promise<string> {
	const { digits, algorithm } = { ...DEFAULT_OPTIONS, ...options };
	const digest = await hmac(secret, counterToBytes(counter), algorithm);
	const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
	const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
	return String(binary % 10 ** digits).padStart(digits, "0");
}

export async function generateTotp(secretBase32: string, atMs: number = Date.now(), options: TotpOptions = {}): Promise<string> {
	const { stepSeconds } = { ...DEFAULT_OPTIONS, ...options };
	const counter = Math.floor(atMs / 1000 / stepSeconds);
	return hotp(base32Decode(secretBase32), counter, options);
}

export interface TotpVerifyOptions extends TotpOptions {
	/**
	 * 容忍的時間步長偏移。1 代表接受前後各一個步長，
	 * 也就是在預設設定下允許裝置時鐘誤差約 ±30 秒。
	 */
	window?: number;
}

/**
 * 驗證使用者輸入的一次性密碼。
 *
 * 回傳命中的時間步長偏移量，讓呼叫端可以拒絕重複使用同一組驗證碼；
 * 不符合時回傳 `null`。
 */
export async function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now(), options: TotpVerifyOptions = {}): Promise<number | null> {
	const { stepSeconds, digits } = { ...DEFAULT_OPTIONS, ...options };
	const window = options.window ?? 1;
	const normalized = code.replace(/\s+/g, "");
	if (normalized.length !== digits) return null;

	const secret = base32Decode(secretBase32);
	const counter = Math.floor(atMs / 1000 / stepSeconds);
	for (let offset = -window; offset <= window; offset += 1) {
		const candidate = await hotp(secret, counter + offset, options);
		if (timingSafeEqualString(candidate, normalized)) return offset;
	}
	return null;
}

/** 定時比較，避免以回應時間推敲正確驗證碼。 */
export function timingSafeEqualString(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) {
		diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return diff === 0;
}

export interface OtpauthUriOptions {
	issuer: string;
	accountName: string;
	secretBase32: string;
	digits?: number;
	stepSeconds?: number;
	algorithm?: "SHA1" | "SHA256" | "SHA512";
}

export function buildOtpauthUri({ issuer, accountName, secretBase32, digits = 6, stepSeconds = 30, algorithm = "SHA1" }: OtpauthUriOptions): string {
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
	const params = new URLSearchParams({
		secret: secretBase32,
		issuer,
		algorithm,
		digits: String(digits),
		period: String(stepSeconds)
	});
	return `otpauth://totp/${label}?${params.toString()}`;
}
