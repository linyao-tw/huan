import { ApiProblem } from "@/lib/errors";
import type { ApiError } from "@huan/protocol";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";

function send(reply: FastifyReply, statusCode: number, body: ApiError): FastifyReply {
	return reply.status(statusCode).type("application/json; charset=utf-8").send(body);
}

/**
 * 把所有錯誤收斂成 `ApiErrorSchema` 的形狀。
 *
 * Admin 與 Device 只需要處理一種錯誤格式；未預期的例外則只回一句通用訊息，
 * 堆疊與 SQL 留在伺服器日誌裡，不透過 API 洩漏內部結構。
 */
export function registerErrorHandler(app: FastifyInstance): void {
	app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
		if (error instanceof ApiProblem) {
			if (error.statusCode >= 500) request.log.error({ err: error }, "請求失敗");
			return send(reply, error.statusCode, error.toResponse());
		}

		if (hasZodFastifySchemaValidationErrors(error)) {
			return send(reply, 400, {
				code: "validation_failed",
				message: "送出的資料不符合格式",
				details: {
					issues: error.validation.map(issue => ({ path: issue.instancePath, message: issue.message ?? "" }))
				}
			});
		}

		if (isResponseSerializationError(error)) {
			request.log.error({ err: error }, "回應序列化失敗：伺服器產生了不符合契約的資料");
			return send(reply, 500, { code: "internal_error", message: "伺服器發生未預期的錯誤" });
		}

		const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;

		if (statusCode === 429) {
			return send(reply, 429, { code: "rate_limited", message: "請求次數過多，請稍後再試" });
		}

		if (statusCode === 400 && error.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
			return send(reply, 400, { code: "validation_failed", message: "請求內容不可為空" });
		}

		if (statusCode >= 500) {
			request.log.error({ err: error }, "未預期的伺服器錯誤");
			return send(reply, statusCode, { code: "internal_error", message: "伺服器發生未預期的錯誤" });
		}

		/**
		 * 其餘 4xx 回固定訊息，原始 `error.message` 只進日誌。
		 * 框架層錯誤的原文可能透露內部結構，不必回給呼叫端。
		 */
		request.log.warn({ err: error }, "未歸類的用戶端錯誤");
		return send(reply, statusCode, { code: "request_failed", message: "請求無法處理，請確認內容後再試一次" });
	});
}

/** 預設的 404。靜態檔案的 SPA fallback 會包住它，因此獨立匯出而不是直接註冊。 */
export function sendNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
	return send(reply, 404, { code: "not_found", message: `找不到 ${request.method} ${request.url}` });
}
