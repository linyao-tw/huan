import { sendNotFound } from "@/plugins/error-handler";
import fastifyStatic from "@fastify/static";
import { API_PREFIX } from "@huan/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";

const SPA_ENTRY = "index.html";

/**
 * 直接服務 Admin 的 production build。
 *
 * 單一容器就能跑完整個系統，正式部署少一個 nginx 要維護。
 * `/api` 與 `/health` 底下的 404 仍然回 JSON，否則 Admin 的 fetch 會拿到一頁 HTML
 * 然後在 JSON.parse 的地方炸掉，錯誤訊息完全看不出原因。
 */
export async function registerStatic(app: FastifyInstance, distDir: string): Promise<void> {
	const root = resolve(distDir);
	await app.register(fastifyStatic, { root, index: false, wildcard: false });

	app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
		const isApiPath = request.url.startsWith(API_PREFIX) || request.url.startsWith("/health");
		if (isApiPath || request.method !== "GET") return sendNotFound(request, reply);
		return reply.type("text/html; charset=utf-8").sendFile(SPA_ENTRY, root);
	});
}
