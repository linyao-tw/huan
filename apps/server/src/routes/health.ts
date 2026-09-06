import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const LiveResponseSchema = z.object({
	status: z.literal("ok"),
	serverTime: z.iso.datetime({ offset: true })
});

const ReadyResponseSchema = z.object({
	status: z.enum(["ok", "degraded"]),
	database: z.enum(["ok", "unavailable"]),
	serverTime: z.iso.datetime({ offset: true })
});

/**
 * 就緒檢查刻意只看 PostgreSQL。
 *
 * RustFS 掛掉時 Server 仍然能提供 Admin API 與 desired state，Device 也能繼續播
 * 已經下載到本機的內容；把物件儲存納入就緒條件，只會讓 orchestrator 在一個
 * 「其實還能服務」的時候把整個 Server 踢掉，讓故障範圍變大而不是變小。
 */
export const healthRoutes: FastifyPluginAsyncZod = async app => {
	app.get("/health/live", { schema: { tags: ["health"], summary: "存活檢查", response: { 200: LiveResponseSchema } } }, async () => ({
		status: "ok" as const,
		serverTime: new Date().toISOString()
	}));

	app.get("/health/ready", { schema: { tags: ["health"], summary: "就緒檢查", response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } }, async (request, reply) => {
		try {
			await app.ctx.db.execute(sql`select 1`);
		} catch (error) {
			request.log.error({ err: error }, "資料庫就緒檢查失敗");
			return reply.status(503).send({ status: "degraded" as const, database: "unavailable" as const, serverTime: new Date().toISOString() });
		}
		return reply.status(200).send({ status: "ok" as const, database: "ok" as const, serverTime: new Date().toISOString() });
	});
};
