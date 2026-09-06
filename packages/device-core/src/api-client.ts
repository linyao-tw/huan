import {
	API_PREFIX,
	ApiErrorSchema,
	DesiredStateSchema,
	DesiredStateVersionSchema,
	DeviceDownloadUrlResponseSchema,
	HeartbeatResponseSchema,
	OkSchema,
	PairingStatusResponseSchema,
	StartPairingResponseSchema,
	type AssetAckRequest,
	type DesiredState,
	type DesiredStateVersion,
	type DeviceDownloadUrlResponse,
	type HeartbeatResponse,
	type Ok,
	type PairingStatusResponse,
	type ReportedState,
	type StartPairingRequest,
	type StartPairingResponse
} from "@huan/protocol";
import { describeError, silentLogger, type Logger } from "./logger.js";
import type { FetchLike, JsonValidator } from "./types.js";

export type DeviceApiErrorKind = "network" | "http" | "protocol";

export interface DeviceApiErrorInit {
	kind: DeviceApiErrorKind;
	status: number | null;
	code: string | null;
	/** 網路錯誤、5xx、408、429：等一下再試有機會成功。 */
	retryable: boolean;
	/** 401/403：憑證已被撤銷或裝置已被解除綁定，重試永遠不會成功。 */
	credentialRevoked: boolean;
}

export class DeviceApiError extends Error {
	readonly kind: DeviceApiErrorKind;
	readonly status: number | null;
	readonly code: string | null;
	readonly retryable: boolean;
	readonly credentialRevoked: boolean;

	constructor(message: string, init: DeviceApiErrorInit) {
		super(message);
		this.name = "DeviceApiError";
		this.kind = init.kind;
		this.status = init.status;
		this.code = init.code;
		this.retryable = init.retryable;
		this.credentialRevoked = init.credentialRevoked;
	}
}

export type TokenProvider = () => Promise<string | null> | string | null;

export interface DeviceApiClientOptions {
	baseUrl: string;
	fetch?: FetchLike;
	/** 每次請求都重新取得，解除綁定後就會拿到 `null`，不必再通知這個 client。 */
	token?: TokenProvider;
	logger?: Logger;
	timeoutMs?: number;
}

interface RequestOptions<T> {
	method: "GET" | "POST";
	path: string;
	schema: JsonValidator<T>;
	body?: unknown;
	/** 預設帶 Bearer；配對相關端點傳 `false`。 */
	auth?: boolean;
	headers?: Record<string, string>;
}

export function joinUrl(base: string, ...segments: string[]): string {
	let url = base.replace(/\/+$/, "");
	for (const segment of segments) {
		if (!segment) continue;
		url += segment.startsWith("/") ? segment : `/${segment}`;
	}
	return url;
}

/** 由 HTTP base URL 推出 WebSocket 端點，避免呼叫端各自拼字串拼錯。 */
export function deviceSocketUrl(baseUrl: string): string {
	const url = new URL(joinUrl(baseUrl, API_PREFIX, "/devices/socket"));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

/**
 * 裝置端 REST client。
 *
 * 每個回應都用 `@huan/protocol` 的 schema 驗過才交給呼叫端：伺服器改了欄位卻沒改協定時，
 * 我們要在這裡就明確失敗，而不是讓一個 `undefined` 流進播放邏輯裡。
 */
export class DeviceApiClient {
	readonly baseUrl: string;
	private readonly fetchImpl: FetchLike;
	private readonly token: TokenProvider;
	private readonly logger: Logger;
	private readonly timeoutMs: number;

	constructor(options: DeviceApiClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.token = options.token ?? (() => null);
		this.logger = options.logger ?? silentLogger;
		this.timeoutMs = options.timeoutMs ?? 20_000;
	}

	get socketUrl(): string {
		return deviceSocketUrl(this.baseUrl);
	}

	startPairing(request: StartPairingRequest): Promise<StartPairingResponse> {
		return this.send({ method: "POST", path: "/device/pairing/start", body: request, schema: StartPairingResponseSchema, auth: false });
	}

	pairingStatus(pairingToken: string): Promise<PairingStatusResponse> {
		return this.send({ method: "GET", path: "/device/pairing/status", schema: PairingStatusResponseSchema, auth: false, headers: { "x-huan-pairing-token": pairingToken } });
	}

	getDesiredState(): Promise<DesiredState> {
		return this.send({ method: "GET", path: "/device/state", schema: DesiredStateSchema });
	}

	getDesiredStateVersion(): Promise<DesiredStateVersion> {
		return this.send({ method: "GET", path: "/device/state/version", schema: DesiredStateVersionSchema });
	}

	heartbeat(reported: ReportedState): Promise<HeartbeatResponse> {
		return this.send({ method: "POST", path: "/device/heartbeat", body: { reported }, schema: HeartbeatResponseSchema });
	}

	/** `downloadPath` 直接來自 manifest，格式是相對於 API 前綴的 `/device/assets/:variantId/url`。 */
	getDownloadUrl(downloadPath: string): Promise<DeviceDownloadUrlResponse> {
		return this.send({ method: "GET", path: downloadPath, schema: DeviceDownloadUrlResponseSchema });
	}

	ackAsset(request: AssetAckRequest): Promise<Ok> {
		return this.send({ method: "POST", path: "/device/assets/ack", body: request, schema: OkSchema });
	}

	unbind(): Promise<Ok> {
		return this.send({ method: "POST", path: "/device/unbind", schema: OkSchema });
	}

	/**
	 * 解除綁定時憑證已經先在本機清掉了，但伺服器端的撤銷還沒完成。
	 * 這個方法讓上層用「保留在記憶體裡的那份憑證」補打一次，不必把密文寫回任何檔案。
	 */
	unbindWithToken(token: string): Promise<Ok> {
		return this.send({ method: "POST", path: "/device/unbind", schema: OkSchema, auth: false, headers: { authorization: `Bearer ${token}` } });
	}

	private async send<T>(options: RequestOptions<T>): Promise<T> {
		const url = joinUrl(this.baseUrl, API_PREFIX, options.path);
		const headers: Record<string, string> = { accept: "application/json", ...options.headers };
		if (options.body !== undefined) headers["content-type"] = "application/json";

		if (options.auth !== false) {
			const token = await this.token();
			if (!token) {
				throw new DeviceApiError("裝置尚未持有憑證，無法呼叫需要認證的端點", { kind: "http", status: 401, code: "unauthorized", retryable: false, credentialRevoked: false });
			}
			headers.authorization = `Bearer ${token}`;
		}

		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				method: options.method,
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch (error) {
			// 連不上跟伺服器回錯是兩件事：前者一定要重試，後者要看狀態碼。
			throw new DeviceApiError(`無法連線到伺服器：${describeError(error)}`, { kind: "network", status: null, code: null, retryable: true, credentialRevoked: false });
		}

		if (!response.ok) throw await this.toHttpError(response, options.path);

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			throw new DeviceApiError(`伺服器回應不是 JSON：${describeError(error)}`, { kind: "protocol", status: response.status, code: null, retryable: true, credentialRevoked: false });
		}

		const parsed = options.schema.safeParse(payload);
		if (!parsed.success) {
			this.logger.warn("伺服器回應不符合協定結構", { path: options.path, status: response.status });
			throw new DeviceApiError("伺服器回應不符合協定結構", { kind: "protocol", status: response.status, code: null, retryable: false, credentialRevoked: false });
		}
		return parsed.data;
	}

	private async toHttpError(response: Response, path: string): Promise<DeviceApiError> {
		const status = response.status;
		let code: string | null = null;
		let message = `伺服器回應 ${status}`;
		try {
			const body: unknown = await response.json();
			const parsed = ApiErrorSchema.safeParse(body);
			if (parsed.success) {
				code = parsed.data.code;
				message = parsed.data.message;
			}
		} catch {
			// 錯誤回應不是 JSON 也無所謂，狀態碼本身已經足以決定要不要重試。
		}
		const credentialRevoked = status === 401 || status === 403;
		const retryable = status === 408 || status === 429 || status >= 500;
		this.logger.debug("裝置 API 回應錯誤", { path, status, code });
		return new DeviceApiError(message, { kind: "http", status, code, retryable, credentialRevoked });
	}
}
