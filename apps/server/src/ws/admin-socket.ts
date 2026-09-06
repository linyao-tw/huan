import { resolveSession } from "@/lib/session";
import type { WebSocket } from "@fastify/websocket";
import type { AdminEvent } from "@huan/protocol";
import type { FastifyInstance, FastifyRequest } from "fastify";

const CLOSE_UNAUTHORIZED = 4401;

function send(socket: WebSocket, event: AdminEvent): void {
	socket.send(JSON.stringify(event));
}

/**
 * Admin 後台的即時推播。
 *
 * 裝置上下線與素材狀態變化會不斷發生，靠輪詢就得在「延遲」與「打爆 API」之間選一個；
 * 這條通道只送「哪個東西變了」，Admin 收到後用既有的 REST 查詢重新取資料。
 */
export function registerAdminSocket(app: FastifyInstance): void {
	const ctx = app.ctx;

	app.get("/admin/socket", { websocket: true, schema: { hide: true } }, async (socket: WebSocket, request: FastifyRequest) => {
		const token = request.cookies[ctx.env.SESSION_COOKIE_NAME];
		const actor = token ? await resolveSession(ctx.db, token) : null;
		if (!actor) {
			socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
			return;
		}

		ctx.hub.attachAdmin(socket);
		send(socket, { type: "hello", serverTime: new Date().toISOString() });

		socket.on("message", (raw: unknown) => {
			/** Admin 端目前只會送 ping；其他訊框一律忽略，不讓瀏覽器有機會驅動伺服器行為。 */
			try {
				const parsed: unknown = JSON.parse(String(raw));
				if (parsed && typeof parsed === "object" && (parsed as { type?: unknown }).type === "ping") {
					send(socket, { type: "pong", serverTime: new Date().toISOString() });
					return;
				}
			} catch {
				// 解析失敗與未知訊框一起走下面的紀錄
			}
			request.log.debug({ userId: actor.user.id }, "忽略未知的 Admin WebSocket 訊框");
		});

		socket.on("close", () => {
			ctx.hub.detachAdmin(socket);
		});

		socket.on("error", (error: Error) => {
			request.log.warn({ err: error, userId: actor.user.id }, "Admin WebSocket 發生錯誤");
		});
	});
}
