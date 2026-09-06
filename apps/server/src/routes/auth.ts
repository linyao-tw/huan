import { recordAudit } from "@/lib/audit";
import { clientIp, requireSession, sessionOf, userAgent } from "@/lib/auth";
import { consumeChallenge, createAuthChallenge, findUsableChallenge } from "@/lib/challenge";
import { forbidden, invalidCredentials, rateLimited, unauthorized } from "@/lib/errors";
import { clearFailedAttempts, isLoginThrottled, recordLoginAttempt } from "@/lib/login-throttle";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearSessionCookie, createSession, resolveSession, revokeAllUserSessions, revokeSession, setSessionCookie } from "@/lib/session";
import { consumeRecoveryCode, findTotpCredential, verifyTotpCode } from "@/lib/totp";
import { findUserByIdentifier, isTotpEnabled, serializeUser, type UserRow } from "@/lib/users";
import { routeRateLimit, type RateLimitTuning } from "@/plugins/rate-limit";
import { users } from "@huan/db";
import { ChangePasswordRequestSchema, LoginRequestSchema, LoginResponseSchema, OkSchema, SessionResponseSchema, TotpChallengeRequestSchema } from "@huan/protocol";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

export interface AuthRouteOptions {
	rateLimits: RateLimitTuning;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
	const { db, env } = app.ctx;
	const authLimit = routeRateLimit(options.rateLimits.auth, options.rateLimits.timeWindow);

	async function completeLogin(user: UserRow, request: FastifyRequest, reply: FastifyReply, method: "password" | "totp" | "recovery_code"): Promise<UserRow> {
		const now = new Date();
		const issued = await createSession(db, env, user.id, { ipAddress: clientIp(request), userAgent: userAgent(request) });
		setSessionCookie(reply, env, issued.token, issued.expiresAt);
		await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, user.id));
		await recordAudit(db, {
			action: "auth.login",
			actorUserId: user.id,
			actorLabel: user.username,
			targetType: "user",
			targetId: user.id,
			targetLabel: user.username,
			ipAddress: clientIp(request),
			metadata: { method }
		});
		return { ...user, lastLoginAt: now };
	}

	app.post(
		"/auth/login",
		{
			config: authLimit,
			schema: { tags: ["auth"], summary: "以 Email 或帳號登入", body: LoginRequestSchema, response: { 200: LoginResponseSchema } }
		},
		async (request, reply) => {
			const { identifier, password } = request.body;
			const attempt = { identifier, ipAddress: clientIp(request) };

			if (await isLoginThrottled(db, env, attempt)) {
				throw rateLimited("登入嘗試次數過多，請稍後再試");
			}

			const user = await findUserByIdentifier(db, identifier);
			const passwordMatches = user ? await verifyPassword(user.passwordHash, password) : false;

			if (!user || !passwordMatches) {
				await recordLoginAttempt(db, attempt, false);
				await recordAudit(db, {
					action: "auth.login_failed",
					actorUserId: user?.id ?? null,
					actorLabel: identifier.slice(0, 254),
					ipAddress: clientIp(request),
					metadata: { reason: user ? "wrong_password" : "unknown_identifier" }
				});
				throw invalidCredentials();
			}

			if (user.status !== "active") {
				await recordLoginAttempt(db, attempt, false);
				await recordAudit(db, {
					action: "auth.login_failed",
					actorUserId: user.id,
					actorLabel: user.username,
					ipAddress: clientIp(request),
					metadata: { reason: "account_disabled" }
				});
				throw forbidden("這個帳號已被停用，請聯絡管理員");
			}

			await recordLoginAttempt(db, attempt, true);
			await clearFailedAttempts(db, attempt);

			const credential = await findTotpCredential(db, user.id);
			if (credential?.confirmedAt) {
				const challenge = await createAuthChallenge(db, user.id, { ipAddress: clientIp(request), userAgent: userAgent(request) });
				return reply.status(200).send({ status: "totp_required" as const, challengeToken: challenge.token, expiresAt: challenge.expiresAt.toISOString() });
			}

			const updated = await completeLogin(user, request, reply, "password");
			return reply.status(200).send({ status: "authenticated" as const, user: serializeUser(updated, false) });
		}
	);

	app.post(
		"/auth/totp/challenge",
		{
			config: authLimit,
			schema: { tags: ["auth"], summary: "完成兩階段驗證", body: TotpChallengeRequestSchema, response: { 200: SessionResponseSchema } }
		},
		async (request, reply) => {
			const { challengeToken, code, recoveryCode } = request.body;

			const challenge = await findUsableChallenge(db, challengeToken);
			if (!challenge) throw unauthorized("驗證階段已過期，請重新登入");

			const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
			if (!user || user.status !== "active") throw unauthorized("驗證階段已過期，請重新登入");

			const attempt = { identifier: user.username, ipAddress: clientIp(request) };
			if (await isLoginThrottled(db, env, attempt)) throw rateLimited("驗證嘗試次數過多，請稍後再試");

			const credential = await findTotpCredential(db, user.id);
			if (!credential?.confirmedAt) throw unauthorized("這個帳號沒有啟用兩階段驗證");

			const method = code ? ("totp" as const) : ("recovery_code" as const);
			const verified = code ? await verifyTotpCode(db, credential, code) : recoveryCode ? await consumeRecoveryCode(db, user.id, recoveryCode) : false;

			if (!verified) {
				await recordLoginAttempt(db, attempt, false);
				await recordAudit(db, {
					action: "auth.login_failed",
					actorUserId: user.id,
					actorLabel: user.username,
					ipAddress: clientIp(request),
					metadata: { reason: method === "totp" ? "invalid_totp_code" : "invalid_recovery_code" }
				});
				throw invalidCredentials("驗證碼不正確");
			}

			/** challenge 只能用一次；兩個請求同時到達時只有先更新到資料列的那一個算數。 */
			if (!(await consumeChallenge(db, challenge.id))) throw unauthorized("驗證階段已過期，請重新登入");

			await clearFailedAttempts(db, attempt);
			const updated = await completeLogin(user, request, reply, method);
			return reply.status(200).send({ user: serializeUser(updated, true) });
		}
	);

	app.post("/auth/logout", { config: authLimit, schema: { tags: ["auth"], summary: "登出", response: { 200: OkSchema } } }, async (request, reply) => {
		const token = request.cookies[env.SESSION_COOKIE_NAME];
		if (token) {
			const resolved = request.sessionActor ?? (await resolveSession(db, token));
			if (resolved) {
				await revokeSession(db, resolved.sessionId);
				await recordAudit(db, {
					action: "auth.logout",
					actorUserId: resolved.user.id,
					actorLabel: resolved.user.username,
					ipAddress: clientIp(request)
				});
			}
		}
		clearSessionCookie(reply, env);
		return reply.status(200).send({ ok: true as const });
	});

	app.get("/auth/session", { preHandler: requireSession, schema: { tags: ["auth"], summary: "取得目前登入的使用者", response: { 200: SessionResponseSchema } } }, async request => {
		const { user } = sessionOf(request);
		return { user: serializeUser(user, await isTotpEnabled(db, user.id)) };
	});

	app.post(
		"/auth/password",
		{
			preHandler: requireSession,
			config: authLimit,
			schema: { tags: ["auth"], summary: "變更自己的密碼", body: ChangePasswordRequestSchema, response: { 200: OkSchema } }
		},
		async (request, reply) => {
			const { user, sessionId } = sessionOf(request);
			const { currentPassword, newPassword } = request.body;

			if (!(await verifyPassword(user.passwordHash, currentPassword))) throw invalidCredentials("目前的密碼不正確");

			await db
				.update(users)
				.set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
				.where(eq(users.id, user.id));
			/** 換密碼的動機常常是「我懷疑帳號被盜用」，所以其他裝置上的 session 一律作廢。 */
			await revokeAllUserSessions(db, user.id, sessionId);

			await recordAudit(db, {
				action: "auth.password_changed",
				actorUserId: user.id,
				actorLabel: user.username,
				targetType: "user",
				targetId: user.id,
				targetLabel: user.username,
				ipAddress: clientIp(request)
			});
			return reply.status(200).send({ ok: true as const });
		}
	);
};
