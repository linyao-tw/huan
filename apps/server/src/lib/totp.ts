import { totpCredentials, totpRecoveryCodes, type Database } from "@huan/db";
import { base32Encode, buildOtpauthUri, verifyTotp } from "@huan/shared";
import { generateRecoveryCode, generateTotpSecretBytes, hashToken, normalizeRecoveryCode } from "@huan/shared/node";
import { and, count, eq, isNull } from "drizzle-orm";
import QRCode from "qrcode";

export const RECOVERY_CODE_COUNT = 10;
const TOTP_STEP_SECONDS = 30;

export type TotpCredentialRow = typeof totpCredentials.$inferSelect;

export async function findTotpCredential(db: Database, userId: string): Promise<TotpCredentialRow | null> {
	const [row] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, userId)).limit(1);
	return row ?? null;
}

export interface TotpSetupMaterial {
	secret: string;
	otpauthUri: string;
	qrCodeDataUrl: string;
}

/**
 * 產生（或重新產生）尚未確認的 TOTP 密鑰。
 *
 * 密鑰只在這個回應裡出現一次，之後任何端點與日誌都不會再輸出；
 * 使用者在確認前重新開始設定時直接覆蓋舊的未確認密鑰，避免留下孤兒資料列。
 */
export async function startTotpSetup(db: Database, params: { userId: string; accountName: string; issuer: string }): Promise<TotpSetupMaterial> {
	const secret = base32Encode(generateTotpSecretBytes(20));
	await db
		.insert(totpCredentials)
		.values({ userId: params.userId, secret, confirmedAt: null, lastUsedStep: null })
		.onConflictDoUpdate({
			target: totpCredentials.userId,
			set: { secret, confirmedAt: null, lastUsedStep: null, updatedAt: new Date() }
		});

	const otpauthUri = buildOtpauthUri({ issuer: params.issuer, accountName: params.accountName, secretBase32: secret });
	const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
	return { secret, otpauthUri, qrCodeDataUrl };
}

/**
 * 驗證一次性密碼並記錄命中的時間步長。
 *
 * 只接受比 `lastUsedStep` 更新的步長：同一組驗證碼在有效視窗內可以被重播，
 * 攔截到畫面上的六位數就能再登入一次，所以用過的步長必須直接作廢。
 */
export async function verifyTotpCode(db: Database, credential: TotpCredentialRow, code: string, now: Date = new Date()): Promise<boolean> {
	const offset = await verifyTotp(credential.secret, code, now.getTime(), { window: 1 });
	if (offset === null) return false;

	const step = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS) + offset;
	if (credential.lastUsedStep !== null && step <= credential.lastUsedStep) return false;

	await db.update(totpCredentials).set({ lastUsedStep: step, updatedAt: now }).where(eq(totpCredentials.userId, credential.userId));
	return true;
}

export async function confirmTotpCredential(db: Database, userId: string, now: Date = new Date()): Promise<void> {
	await db.update(totpCredentials).set({ confirmedAt: now, updatedAt: now }).where(eq(totpCredentials.userId, userId));
}

export async function disableTotp(db: Database, userId: string): Promise<void> {
	await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
	await db.delete(totpCredentials).where(eq(totpCredentials.userId, userId));
}

/** 重新產生復原碼。舊的一律作廢，避免使用者以為兩份都還能用。 */
export async function issueRecoveryCodes(db: Database, userId: string): Promise<string[]> {
	await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
	const codes: string[] = [];
	const values: { userId: string; codeHash: string }[] = [];
	while (codes.length < RECOVERY_CODE_COUNT) {
		const code = generateRecoveryCode();
		const codeHash = hashToken(normalizeRecoveryCode(code));
		if (values.some(entry => entry.codeHash === codeHash)) continue;
		codes.push(code);
		values.push({ userId, codeHash });
	}
	await db.insert(totpRecoveryCodes).values(values);
	return codes;
}

/** 復原碼是一次性的：用過就標記 `usedAt`，之後同一組碼不再有效。 */
export async function consumeRecoveryCode(db: Database, userId: string, rawCode: string, now: Date = new Date()): Promise<boolean> {
	const codeHash = hashToken(normalizeRecoveryCode(rawCode));
	const updated = await db
		.update(totpRecoveryCodes)
		.set({ usedAt: now })
		.where(and(eq(totpRecoveryCodes.userId, userId), eq(totpRecoveryCodes.codeHash, codeHash), isNull(totpRecoveryCodes.usedAt)))
		.returning({ id: totpRecoveryCodes.id });
	return updated.length > 0;
}

export async function countRemainingRecoveryCodes(db: Database, userId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(totpRecoveryCodes)
		.where(and(eq(totpRecoveryCodes.userId, userId), isNull(totpRecoveryCodes.usedAt)));
	return Number(row?.value ?? 0);
}
