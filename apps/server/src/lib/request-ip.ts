import type { FastifyRequest } from "fastify";

/**
 * 取用戶端 IP，取不到就回 `null`。
 *
 * `request.ip` 在 `trustProxy` 開啟時要讀底層 socket 的 `remoteAddress`，
 * 而 WebSocket 的 upgrade 請求（尤其是測試用的 `injectWS`）不一定有真正的
 * socket。這個 getter 會直接拋例外，讓節流與日誌在連線建立階段就把請求打成 500。
 */
export function clientIp(request: FastifyRequest): string | null {
	try {
		return request.ip ?? null;
	} catch {
		return null;
	}
}
