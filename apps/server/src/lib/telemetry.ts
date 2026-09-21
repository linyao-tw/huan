import { context } from "@opentelemetry/api";
import { getRPCMetadata, RPCType } from "@opentelemetry/core";
import type { FastifyRequest } from "fastify";

/**
 * 把 Fastify 的路由樣板交給 HTTP 埋點。
 *
 * HTTP 埋點只看得到實際網址（`/api/v1/media/3f2c…`），不知道它屬於哪一條路由；不告訴它
 * 的話，每一筆 trace 的名稱都只有 `GET`，延遲指標也沒辦法照路由分組。這裡用它預留的
 * RPC metadata 回填 `http.route`，span 名稱就會變成 `GET /api/v1/media/:id`。
 *
 * 沒有啟用 OpenTelemetry 時 metadata 不存在，這個 hook 什麼都不做。
 */
export async function recordRouteForTelemetry(request: FastifyRequest): Promise<void> {
	const route = request.routeOptions.url;
	if (!route) return;
	const metadata = getRPCMetadata(context.active());
	if (metadata?.type === RPCType.HTTP) metadata.route = route;
}
