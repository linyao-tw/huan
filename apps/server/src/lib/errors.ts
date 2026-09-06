import type { ApiError } from "@huan/protocol";

/**
 * 所有預期內的錯誤都用這個型別拋出。
 *
 * 它同時帶著 HTTP 狀態碼與 `ApiErrorSchema` 的 `code`，讓錯誤處理器不必再猜
 * 「這個例外應該回哪個狀態碼」，Admin 與 Device 也永遠拿到同一種形狀的錯誤。
 */
export class ApiProblem extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>
	) {
		super(message);
		this.name = "ApiProblem";
	}

	toResponse(): ApiError {
		return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
	}
}

export function unauthorized(message = "請先登入"): ApiProblem {
	return new ApiProblem(401, "unauthorized", message);
}

export function invalidCredentials(message = "Email、帳號或密碼不正確"): ApiProblem {
	return new ApiProblem(401, "invalid_credentials", message);
}

export function forbidden(message = "沒有執行這個操作的權限"): ApiProblem {
	return new ApiProblem(403, "forbidden", message);
}

export function notFound(message = "找不到指定的資料"): ApiProblem {
	return new ApiProblem(404, "not_found", message);
}

export function conflict(message: string, details?: Record<string, unknown>, code = "conflict"): ApiProblem {
	return new ApiProblem(409, code, message, details);
}

export function validationFailed(message: string, details?: Record<string, unknown>): ApiProblem {
	return new ApiProblem(400, "validation_failed", message, details);
}

export function rateLimited(message = "嘗試次數過多，請稍後再試", details?: Record<string, unknown>): ApiProblem {
	return new ApiProblem(429, "rate_limited", message, details);
}

export function serviceUnavailable(message: string, details?: Record<string, unknown>): ApiProblem {
	return new ApiProblem(503, "service_unavailable", message, details);
}
