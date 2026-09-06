import type { UserRow } from "@/lib/users";
import { shouldUseSecureCookie, type ServerEnv } from "@huan/config";
import { sessions, users, type Database } from "@huan/db";
import type { SessionSummary } from "@huan/protocol";
import { generateOpaqueToken, hashToken } from "@huan/shared/node";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply } from "fastify";

export interface SessionActor {
	sessionId: string;
	user: UserRow;
}

export interface SessionOrigin {
	ipAddress: string | null;
	userAgent: string | null;
}

export interface IssuedSession {
	sessionId: string;
	token: string;
	expiresAt: Date;
}

/**
 * 建立一組新的 session。
 *
 * 回傳的 `token` 是唯一一次能拿到明文的機會；資料庫只留 SHA-256，
 * 因此外洩備份的人拿不到可用的 cookie 值。
 */
export async function createSession(db: Database, env: ServerEnv, userId: string, origin: SessionOrigin): Promise<IssuedSession> {
	const token = generateOpaqueToken(32);
	const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
	const [row] = await db
		.insert(sessions)
		.values({
			userId,
			tokenHash: hashToken(token),
			ipAddress: origin.ipAddress,
			userAgent: origin.userAgent,
			expiresAt
		})
		.returning({ id: sessions.id });
	if (!row) throw new Error("建立 session 失敗");
	return { sessionId: row.id, token, expiresAt };
}

/** 以 cookie 中的不透明 token 換回使用者。順便更新 `lastSeenAt`，讓安全頁能顯示「最近活動」。 */
export async function resolveSession(db: Database, token: string): Promise<SessionActor | null> {
	const tokenHash = hashToken(token);
	const [row] = await db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
		.limit(1);
	if (!row) return null;
	if (row.user.status !== "active") return null;

	await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
	return { sessionId: row.session.id, user: row.user };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
	await db
		.update(sessions)
		.set({ revokedAt: new Date() })
		.where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllUserSessions(db: Database, userId: string, exceptSessionId?: string): Promise<void> {
	const rows = await db
		.select({ id: sessions.id })
		.from(sessions)
		.where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
	for (const row of rows) {
		if (row.id === exceptSessionId) continue;
		await revokeSession(db, row.id);
	}
}

export async function listActiveSessions(db: Database, userId: string, currentSessionId: string): Promise<SessionSummary[]> {
	const rows = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
		.orderBy(desc(sessions.lastSeenAt));
	return rows.map(row => ({
		id: row.id,
		current: row.id === currentSessionId,
		ipAddress: row.ipAddress,
		userAgent: row.userAgent,
		createdAt: row.createdAt.toISOString(),
		lastSeenAt: row.lastSeenAt.toISOString(),
		expiresAt: row.expiresAt.toISOString()
	}));
}

export function setSessionCookie(reply: FastifyReply, env: ServerEnv, token: string, expiresAt: Date): void {
	reply.setCookie(env.SESSION_COOKIE_NAME, token, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: shouldUseSecureCookie(env),
		expires: expiresAt,
		maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
	});
}

export function clearSessionCookie(reply: FastifyReply, env: ServerEnv): void {
	reply.clearCookie(env.SESSION_COOKIE_NAME, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: shouldUseSecureCookie(env)
	});
}
