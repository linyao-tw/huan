import { API_PREFIX, type ApiError as ApiErrorBody } from "@huan/protocol";
import type { z } from "zod";

export interface ApiErrorOptions {
	status: number;
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

/**
 * 所有 API 失敗都收斂成這一種例外。
 *
 * `code` 是 Server 的穩定識別字（`totp_required`、`asset_in_use`…），
 * UI 依它決定要換頁、開對話框還是只顯示訊息；`message` 已經是繁體中文，可直接呈現。
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: Record<string, unknown> | undefined;

	constructor({ status, code, message, details }: ApiErrorOptions) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

/** 網路本身失敗時（離線、DNS、CORS）也要有一致的形狀，畫面才不需要分兩種錯誤處理。 */
function networkError(error: unknown): ApiError {
	return new ApiError({
		status: 0,
		code: "network_error",
		message: error instanceof Error && error.message ? `無法連線到伺服器：${error.message}` : "無法連線到伺服器，請確認網路狀態後再試一次。"
	});
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * 401 只清掉快取的 session，不自己導頁。
 *
 * 導頁交給 router 的守衛，這樣「已經在 /login」的情況不會再被推一次，
 * 也就不會出現重新整理→401→導頁→重新整理的迴圈。
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
	unauthorizedHandler = handler;
}

export interface RequestOptions<Output> {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	body?: unknown;
	query?: Record<string, string | number | boolean | undefined | null>;
	signal?: AbortSignal;
	/** 有給就用 zod 收斂回應，讓型別錯誤在邊界就爆掉，而不是在畫面深處。 */
	schema?: z.ZodType<Output>;
	/** 401 時不要清除 session（登入端點本身的 401 是「帳密錯誤」，不是「登入過期」）。 */
	skipUnauthorizedHandler?: boolean;
}

function buildUrl(path: string, query: RequestOptions<unknown>["query"]): string {
	const base = `${API_PREFIX}${path}`;
	if (!query) return base;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "") continue;
		params.set(key, String(value));
	}
	const search = params.toString();
	return search ? `${base}?${search}` : base;
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
	try {
		const payload: unknown = await response.json();
		if (payload && typeof payload === "object" && "code" in payload && "message" in payload) {
			const body = payload as ApiErrorBody;
			return { code: String(body.code), message: String(body.message), ...(body.details ? { details: body.details } : {}) };
		}
	} catch {
		// 落到下面的預設訊息；Server 沒有回 JSON 時不應該讓畫面炸掉。
	}
	/*
	 * 狀態碼留在 code 裡給開發者，訊息給使用者。
	 *
	 * 「伺服器回應 500」對按下按鈕的人沒有任何幫助——他不知道 500 是什麼，
	 * 也不會因為知道而做出不同的事。要說的是「現在怎麼辦」。
	 */
	const message = response.status >= 500 ? "系統暫時有狀況，稍後再試一次。" : "這個操作沒有完成，請重新整理後再試一次。";
	return { code: `http_${response.status}`, message };
}

export async function apiRequest<Output>(path: string, options: RequestOptions<Output> = {}): Promise<Output> {
	const { method = "GET", body, query, signal, schema, skipUnauthorizedHandler } = options;

	const init: RequestInit = {
		method,
		credentials: "include",
		headers: { Accept: "application/json" },
		...(signal ? { signal } : {})
	};

	if (body !== undefined) {
		init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}

	let response: Response;
	try {
		response = await fetch(buildUrl(path, query), init);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") throw error;
		throw networkError(error);
	}

	if (response.status === 401 && !skipUnauthorizedHandler) unauthorizedHandler?.();

	if (!response.ok) {
		const errorBody = await parseErrorBody(response);
		throw new ApiError({ status: response.status, code: errorBody.code, message: errorBody.message, ...(errorBody.details ? { details: errorBody.details } : {}) });
	}

	if (response.status === 204) return undefined as Output;

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw networkError(error);
	}

	if (!schema) return payload as Output;

	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		throw new ApiError({
			status: response.status,
			code: "invalid_response",
			message: "伺服器回應的格式無法解析，請重新整理或聯絡管理員。",
			details: { issues: parsed.error.issues }
		});
	}
	return parsed.data;
}

export interface Paginated<Item> {
	items: Item[];
	total: number;
	limit: number;
	offset: number;
}
