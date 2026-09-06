import { z } from "zod";
import { IsoDateTimeSchema } from "./common.js";
import { PasswordSchema, UserSchema } from "./user.js";

/** 登入識別字可以是 Email 或帳號，Server 依內容自行判斷。 */
export const LoginRequestSchema = z.object({
	identifier: z.string().min(1, "請輸入 Email 或帳號").max(254),
	password: z.string().min(1, "請輸入密碼").max(200)
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** TOTP 一次性密碼是 6 位數字。 */
export const TotpCodeSchema = z.string().regex(/^\d{6}$/, "驗證碼必須是 6 位數字");

/** 復原碼以 `XXXXX-XXXXX` 呈現，比對時忽略連字號與大小寫。 */
export const RecoveryCodeSchema = z
	.string()
	.min(10)
	.max(24)
	.transform(value => value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase());

/**
 * 登入結果有兩種：直接完成，或需要第二階段驗證。
 * `challengeToken` 是短時效的一次性憑證，只能用來完成 2FA，不能存取任何 API。
 */
export const LoginResponseSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("authenticated"),
		user: UserSchema
	}),
	z.object({
		status: z.literal("totp_required"),
		challengeToken: z.string().min(1),
		expiresAt: IsoDateTimeSchema
	})
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TotpChallengeRequestSchema = z
	.object({
		challengeToken: z.string().min(1),
		code: TotpCodeSchema.optional(),
		recoveryCode: RecoveryCodeSchema.optional()
	})
	.refine(value => Boolean(value.code) !== Boolean(value.recoveryCode), "請只提供驗證碼或復原碼其中一種");
export type TotpChallengeRequest = z.infer<typeof TotpChallengeRequestSchema>;

export const SessionResponseSchema = z.object({
	user: UserSchema
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SessionSummarySchema = z.object({
	id: z.string(),
	current: z.boolean(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	createdAt: IsoDateTimeSchema,
	lastSeenAt: IsoDateTimeSchema,
	expiresAt: IsoDateTimeSchema
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** 啟用 2FA 前必須先確認密碼，避免有人拿到未鎖定的瀏覽器就綁定自己的驗證器。 */
export const TotpSetupRequestSchema = z.object({
	password: z.string().min(1, "請輸入目前的密碼")
});
export type TotpSetupRequest = z.infer<typeof TotpSetupRequestSchema>;

/**
 * `secret` 只在啟用流程回傳一次，供使用者手動輸入驗證器。
 * Server 不會再次輸出這個值，也不會寫進任何日誌。
 */
export const TotpSetupResponseSchema = z.object({
	secret: z.string(),
	otpauthUri: z.string(),
	qrCodeDataUrl: z.string()
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponseSchema>;

export const TotpActivateRequestSchema = z.object({
	code: TotpCodeSchema
});
export type TotpActivateRequest = z.infer<typeof TotpActivateRequestSchema>;

/** 復原碼只在啟用當下顯示一次；Server 只保存雜湊。 */
export const TotpActivateResponseSchema = z.object({
	recoveryCodes: z.array(z.string())
});
export type TotpActivateResponse = z.infer<typeof TotpActivateResponseSchema>;

export const TotpDisableRequestSchema = z.object({
	password: z.string().min(1, "請輸入目前的密碼"),
	code: TotpCodeSchema
});
export type TotpDisableRequest = z.infer<typeof TotpDisableRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
	currentPassword: z.string().min(1, "請輸入目前的密碼"),
	newPassword: PasswordSchema
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const SecurityOverviewSchema = z.object({
	totpEnabled: z.boolean(),
	recoveryCodesRemaining: z.number().int().min(0),
	sessions: z.array(SessionSummarySchema)
});
export type SecurityOverview = z.infer<typeof SecurityOverviewSchema>;
