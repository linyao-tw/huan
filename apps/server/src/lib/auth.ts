import { authenticateDeviceToken, extractBearerToken } from "@/lib/device-auth";
import { forbidden, notFound, unauthorized } from "@/lib/errors";
import { clientIp } from "@/lib/request-ip";
import { resolveSession, type SessionActor } from "@/lib/session";
import { devices, layouts, mediaAssets, schedules, type Database } from "@huan/db";
import type { UserRole } from "@huan/protocol";
import { and, eq, type SQL } from "drizzle-orm";
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

/**
 * 反向的角色守衛。
 *
 * `requireRole` 是白名單，只能表達「誰可以進來」。這裡要表達的規則相反：
 * 最高管理員只負責帳號管理，**不能**操作裝置、素材、版面與排程。用
 * `requireRole("user")` 寫起來看似等價，但它的意思是「只有 user 這個角色可以」，
 * 將來多一種角色就會被默默擋在門外；真正的規則是「除了最高管理員以外都可以」。
 *
 * 這裡回 403 而不是 404，是因為這是角色層面的拒絕，跟資料存不存在無關，
 * 使用者需要看得懂「這個帳號不該做這件事」，而不是以為東西不見了。
 */
export function forbidRole(...roles: readonly UserRole[]): preHandlerAsyncHookHandler {
	return async request => {
		const actor = await readSession(request);
		if (!actor) throw unauthorized();
		if (roles.includes(actor.user.role)) throw forbidden("最高管理員只負責帳號管理，不能操作裝置、素材、版面與排程");
	};
}

/** 裝置、素材、版面與排程這四組路由的唯一入口守衛：要登入，而且不能是最高管理員。 */
export const requireResourceOwner: preHandlerAsyncHookHandler = forbidRole("super_admin");

export function sessionOf(request: FastifyRequest): SessionActor {
	if (!request.sessionActor) throw unauthorized();
	return request.sessionActor;
}

/** 這個請求的資源擁有者。資源路由一律以它當作查詢條件，不接受請求裡送來的任何擁有者資訊。 */
export function ownerOf(request: FastifyRequest): string {
	return sessionOf(request).user.id;
}

/**
 * 有擁有者的四張資料表。
 *
 * 寫成聯集而不是「任何有 id 與 ownerId 的資料表」這種結構型別，是因為 drizzle 的
 * 資料表型別對欄位是不變的（invariant），結構型別過不了；而且租戶邊界上有哪幾張表
 * 本來就該是一份看得到的清單。
 */
type OwnedTable = typeof devices | typeof layouts | typeof mediaAssets | typeof schedules;

/**
 * 擁有者條件。
 *
 * 所有以 `:id` 取資料的查詢都走它：把 `id` 與 `ownerId` 綁成同一個 `where`，
 * 就寫不出「先查到再判斷是不是自己的」這種形狀，也就不會有某條路徑忘了判斷。
 */
export function ownedBy(table: OwnedTable, id: string, ownerId: string): SQL {
	const condition = and(eq(table.id, id), eq(table.ownerId, ownerId));
	/** `and()` 的回傳型別容許 undefined，而 undefined 傳進 `where()` 等於「沒有條件」：寧可當場炸掉，也不要靜悄悄查出全部資料。 */
	if (!condition) throw new Error("組不出擁有者條件");
	return condition;
}

/**
 * 取一筆屬於自己的資料，取不到就 404。
 *
 * 「不存在」與「不是你的」刻意回同一個 404：403 等於承認這個 id 真的存在，
 * 只是不屬於呼叫者，id 就變成可以列舉的。
 *
 * 這裡列出四張資料表而不是寫成泛型，是因為 drizzle 的 `from()` 對泛型資料表推不出
 * 資料列型別，回傳值會塌成 `Record<string, unknown>`；寧可多四行多載，也不要讓
 * 每個呼叫端各自把型別收斂回來。
 */
export async function loadOwned(db: Database, table: typeof devices, id: string, ownerId: string, message: string): Promise<typeof devices.$inferSelect>;
export async function loadOwned(db: Database, table: typeof layouts, id: string, ownerId: string, message: string): Promise<typeof layouts.$inferSelect>;
export async function loadOwned(db: Database, table: typeof mediaAssets, id: string, ownerId: string, message: string): Promise<typeof mediaAssets.$inferSelect>;
export async function loadOwned(db: Database, table: typeof schedules, id: string, ownerId: string, message: string): Promise<typeof schedules.$inferSelect>;
export async function loadOwned(
	db: Database,
	table: OwnedTable,
	id: string,
	ownerId: string,
	message: string
): Promise<typeof devices.$inferSelect | typeof layouts.$inferSelect | typeof mediaAssets.$inferSelect | typeof schedules.$inferSelect> {
	const [row] = await db
		.select()
		.from(table)
		.where(ownedBy(table, id, ownerId))
		.limit(1);
	if (!row) throw notFound(message);
	return row;
}

/**
 * 從 Authorization header 取出裝置 token。
 *
 * 只走 header，不接受 `?token=` 查詢字串：URL 會進伺服器日誌、反向代理的 access
 * log 與瀏覽器歷史，把長期有效的裝置憑證放進去等於到處留副本。裝置端用的是
 * Node 的 ws（`@huan/device-core`），握手時就能帶 header，不受瀏覽器 WebSocket
 * 不能設 header 的限制。
 */
export function deviceTokenFromRequest(request: FastifyRequest): string | null {
	return extractBearerToken(request.headers.authorization);
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
