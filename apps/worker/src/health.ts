import { createServer, type Server } from "node:http";
import type { Logger } from "pino";

export interface HealthServerOptions {
	port: number;
	logger: Logger;
	/** 回報 Worker 是否還在正常取件。輪詢迴圈卡死時這裡會轉為 false。 */
	isHealthy: () => boolean;
}

/**
 * Worker 沒有對外 API，但容器編排需要一個存活探針。
 *
 * 用 Node 內建的 http 起一個只有兩條路由的伺服器，比讓 healthcheck 去翻
 * process 清單或心跳檔可靠得多，也不需要在映像裡塞 curl 或 pgrep。
 */
export function startHealthServer({ port, logger, isHealthy }: HealthServerOptions): Server {
	const server = createServer((request, response) => {
		if (request.url === "/health/live") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ status: "ok" }));
			return;
		}
		if (request.url === "/health/ready") {
			const healthy = isHealthy();
			response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
			response.end(JSON.stringify({ status: healthy ? "ok" : "degraded" }));
			return;
		}
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ status: "not_found" }));
	});

	server.listen(port, "0.0.0.0", () => logger.info({ port }, "存活檢查端點已啟動"));
	/** 探針失敗不該把 Worker 帶走：轉檔本身還在正常運作。 */
	server.on("error", error => logger.warn({ err: String(error), port }, "存活檢查端點無法啟動"));
	return server;
}
