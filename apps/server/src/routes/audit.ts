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
