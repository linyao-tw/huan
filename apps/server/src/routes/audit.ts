import { serializeAuditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { toCount } from "@/lib/pagination";
import { auditLogs } from "@huan/db";
import { AuditLogQuerySchema, AuditLogSchema, paginatedSchema } from "@huan/protocol";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const AuditLogListResponseSchema = paginatedSchema(AuditLogSchema);

export const auditRoutes: FastifyPluginAsyncZod = async app => {
	const { db } = app.ctx;

	/**
	 * 稽核紀錄刻意保持全域，而且只有最高管理員看得到。
	 *
	 * 其他資源一律按擁有者切開，這裡是唯一的例外：稽核的用途是「誰在這個安裝上做了什麼」，
	 * 按擁有者切開就再也回答不了跨帳號的問題。代價是 `targetLabel` 會出現別人的資源名稱，
	 * 因此它不開放給一般使用者——一般使用者要看的是自己的資料，不是這份紀錄。
	 */
	app.get(
		"/audit-logs",
		{
			preHandler: requireRole("super_admin"),
			schema: { tags: ["audit"], summary: "查詢稽核紀錄", querystring: AuditLogQuerySchema, response: { 200: AuditLogListResponseSchema } }
		},
		async request => {
			const { action, actorUserId, limit, offset } = request.query;
			const filters: SQL[] = [];
			if (action) filters.push(eq(auditLogs.action, action));
			if (actorUserId) filters.push(eq(auditLogs.actorUserId, actorUserId));
			const where = filters.length > 0 ? and(...filters) : undefined;

			const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);
			const [total] = await db.select({ value: count() }).from(auditLogs).where(where);

			return { items: rows.map(serializeAuditLog), total: toCount(total?.value), limit, offset };
		}
	);
};
