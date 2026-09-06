import { authenticateDeviceToken, extractBearerToken } from "@/lib/device-auth";
import { forbidden, unauthorized } from "@/lib/errors";
import { clientIp } from "@/lib/request-ip";
import { resolveSession, type SessionActor } from "@/lib/session";
import type { UserRole } from "@huan/protocol";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

export { clientIp };

export function userAgent(request: FastifyRequest): string | null {
	const value = request.headers["user-agent"];
	return (Array.isArray(value) ? value[0] : value)?.slice(0, 500) ?? null;
}

/** 讀 cookie 但不強制登入。給「有登入就回資料、沒登入就回 401」以外的情境使用。 */
export async function readSession(request: FastifyRequest): Promise<SessionActor | null> {
	if (request.sessionActor) return request.sessionActor;
	const token = request.cookies[request.server.ctx.env.SESSION_COOKIE_NAME];
	if (!token) return null;
	const actor = await resolveSession(request.server.ctx.db, token);
	request.sessionActor = actor;
	return actor;
}

export const requireSession: preHandlerAsyncHookHandler = async request => {
	const actor = await readSession(request);
	if (!actor) throw unauthorized();
};

/**
 * 角色守衛。
 *
 * 做成可重複使用的守衛而不是在每個 handler 裡各自 if：權限檢查散落在
 * handler 內部時，漏掉一個地方沒人會發現，而路由定義上少一個守衛看得出來。
 */
export function requireRole(...roles: readonly UserRole[]): preHandlerAsyncHookHandler {
	return async request => {
		const actor = await readSession(request);
		if (!actor) throw unauthorized();
		if (!roles.includes(actor.user.role)) throw forbidden("這個操作只有最高管理員可以執行");
	};
}

export function sessionOf(request: FastifyRequest): SessionActor {
	if (!request.sessionActor) throw unauthorized();
	return request.sessionActor;
}

/** 從 header 或查詢字串取出裝置 token。Electron 的 WebSocket 帶不了自訂 header，因此保留查詢字串。 */
export function deviceTokenFromRequest(request: FastifyRequest): string | null {
	const fromHeader = extractBearerToken(request.headers.authorization);
	if (fromHeader) return fromHeader;
	const query: unknown = request.query;
	if (query && typeof query === "object" && "token" in query) {
		const value = (query as { token?: unknown }).token;
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

export const requireDevice: preHandlerAsyncHookHandler = async request => {
	const token = deviceTokenFromRequest(request);
	if (!token) throw unauthorized("缺少裝置憑證");
	const actor = await authenticateDeviceToken(request.server.ctx.db, token);
	if (!actor) throw unauthorized("裝置憑證無效或已撤銷");
	request.deviceActor = actor;
};

export function deviceOf(request: FastifyRequest): NonNullable<FastifyRequest["deviceActor"]> {
	if (!request.deviceActor) throw unauthorized("缺少裝置憑證");
	return request.deviceActor;
}
