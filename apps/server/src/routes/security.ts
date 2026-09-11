import { recordAudit } from "@/lib/audit";
import { clientIp, requireSession, sessionOf } from "@/lib/auth";
import { conflict, invalidCredentials, notFound } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { listActiveSessions, revokeSession } from "@/lib/session";
import { confirmTotpCredential, countRemainingRecoveryCodes, disableTotp, findTotpCredential, issueRecoveryCodes, startTotpSetup, verifyTotpCode } from "@/lib/totp";
import { routeRateLimit, type RateLimitTuning } from "@/plugins/rate-limit";
import { sessions } from "@huan/db";
import {
	IdSchema,
	OkSchema,
	SecurityOverviewSchema,
	TotpActivateRequestSchema,
	TotpActivateResponseSchema,
	TotpDisableRequestSchema,
	TotpSetupRequestSchema,
	TotpSetupResponseSchema
} from "@huan/protocol";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export interface SecurityRouteOptions {
	rateLimits: RateLimitTuning;
}

export const securityRoutes: FastifyPluginAsyncZod<SecurityRouteOptions> = async (app, options) => {
	const { db, env, totpKey } = app.ctx;
	const authLimit = routeRateLimit(options.rateLimits.auth, options.rateLimits.timeWindow);

	app.get("/security", { preHandler: requireSession, schema: { tags: ["security"], summary: "安全設定總覽", response: { 200: SecurityOverviewSchema } } }, async request => {
		const { user, sessionId } = sessionOf(request);
		const credential = await findTotpCredential(db, user.id);
		return {
			totpEnabled: Boolean(credential?.confirmedAt),
			recoveryCodesRemaining: await countRemainingRecoveryCodes(db, user.id),
			sessions: await listActiveSessions(db, user.id, sessionId)
		};
	});

	app.post(
		"/security/totp/setup",
		{
			preHandler: requireSession,
			config: authLimit,
			schema: { tags: ["security"], summary: "開始綁定驗證器", body: TotpSetupRequestSchema, response: { 200: TotpSetupResponseSchema } }
		},
		async request => {
			const { user } = sessionOf(request);
			/** 先確認密碼，否則有人借用一台沒鎖的瀏覽器就能把 2FA 綁到自己的驗證器上。 */
			if (!(await verifyPassword(user.passwordHash, request.body.password))) throw invalidCredentials("目前的密碼不正確");

			const existing = await findTotpCredential(db, user.id);
			if (existing?.confirmedAt) throw conflict("這個帳號已經啟用兩階段驗證，請先停用再重新綁定");

			return startTotpSetup(db, totpKey, { userId: user.id, accountName: user.email, issuer: env.TOTP_ISSUER });
		}
	);

	app.post(
		"/security/totp/activate",
		{
			preHandler: requireSession,
			config: authLimit,
			schema: { tags: ["security"], summary: "確認驗證碼並啟用兩階段驗證", body: TotpActivateRequestSchema, response: { 200: TotpActivateResponseSchema } }
		},
		async request => {
			const { user } = sessionOf(request);
			const credential = await findTotpCredential(db, user.id);
			if (!credential) throw notFound("請先開始綁定流程");
			if (credential.confirmedAt) throw conflict("這個帳號已經啟用兩階段驗證");

			if (!(await verifyTotpCode(db, totpKey, credential, request.body.code))) throw invalidCredentials("驗證碼不正確");

			await confirmTotpCredential(db, user.id);
			const recoveryCodes = await issueRecoveryCodes(db, user.id);

			await recordAudit(db, {
				action: "auth.totp_enabled",
				actorUserId: user.id,
				actorLabel: user.username,
				targetType: "user",
				targetId: user.id,
				targetLabel: user.username,
				ipAddress: clientIp(request)
			});

			/** 明文復原碼只在這一個回應裡出現一次，資料庫與日誌都只有雜湊。 */
			return { recoveryCodes };
		}
	);

	app.post(
		"/security/totp/disable",
		{
			preHandler: requireSession,
			config: authLimit,
			schema: { tags: ["security"], summary: "停用兩階段驗證", body: TotpDisableRequestSchema, response: { 200: OkSchema } }
		},
		async request => {
			const { user } = sessionOf(request);
			if (!(await verifyPassword(user.passwordHash, request.body.password))) throw invalidCredentials("目前的密碼不正確");

			const credential = await findTotpCredential(db, user.id);
			if (!credential?.confirmedAt) throw conflict("這個帳號沒有啟用兩階段驗證");
			if (!(await verifyTotpCode(db, totpKey, credential, request.body.code))) throw invalidCredentials("驗證碼不正確");

			await disableTotp(db, user.id);
			await recordAudit(db, {
				action: "auth.totp_disabled",
				actorUserId: user.id,
				actorLabel: user.username,
				targetType: "user",
				targetId: user.id,
				targetLabel: user.username,
				ipAddress: clientIp(request)
			});
			return { ok: true as const };
		}
	);

	app.post(
		"/security/totp/recovery-codes",
		{
			preHandler: requireSession,
			config: authLimit,
			schema: { tags: ["security"], summary: "重新產生復原碼", body: TotpDisableRequestSchema, response: { 200: TotpActivateResponseSchema } }
		},
		async request => {
			const { user } = sessionOf(request);
			if (!(await verifyPassword(user.passwordHash, request.body.password))) throw invalidCredentials("目前的密碼不正確");

			const credential = await findTotpCredential(db, user.id);
			if (!credential?.confirmedAt) throw conflict("這個帳號沒有啟用兩階段驗證");
			if (!(await verifyTotpCode(db, totpKey, credential, request.body.code))) throw invalidCredentials("驗證碼不正確");

			return { recoveryCodes: await issueRecoveryCodes(db, user.id) };
		}
	);

	app.delete(
		"/security/sessions/:id",
		{
			preHandler: requireSession,
			schema: { tags: ["security"], summary: "撤銷指定的登入 session", params: z.object({ id: IdSchema }), response: { 200: OkSchema } }
		},
		async request => {
			const { user } = sessionOf(request);
			const [target] = await db
				.select({ id: sessions.id })
				.from(sessions)
				.where(and(eq(sessions.id, request.params.id), eq(sessions.userId, user.id)))
				.limit(1);
			if (!target) throw notFound("找不到這個 session");

			await revokeSession(db, target.id);
			await recordAudit(db, {
				action: "auth.session_revoked",
				actorUserId: user.id,
				actorLabel: user.username,
				targetType: "session",
				targetId: target.id,
				ipAddress: clientIp(request)
			});
			return { ok: true as const };
		}
	);
};
