import type { AssetManifestEntry, DesiredState, LayoutBundle, ScheduleManifestEntry } from "@huan/protocol";
import { createHash, randomUUID } from "node:crypto";

/**
 * 測試用的假資料工廠。
 *
 * 這個檔案不會進 `dist`（`tsconfig.build.json` 已排除），也不由 `index.ts` 匯出；
 * 放在 `src` 下純粹是為了讓多個測試檔共用同一份結構，避免每個測試各自手刻 manifest 而漸漸走鐘。
 */

export function makeLayout(overrides: Partial<LayoutBundle> = {}): LayoutBundle {
	return {
		layoutId: randomUUID(),
		revisionId: randomUUID(),
		revisionNumber: 1,
		name: "版面",
		document: {
			canvas: { width: 1920, height: 1080 },
			background: { color: "#000000", imageAssetId: null, imageFit: "cover" },
			gap: 0,
			root: { type: "slot", id: "root", content: null }
		},
		...overrides
	};
}

export function makeAsset(content: string | Uint8Array, overrides: Partial<AssetManifestEntry> = {}): AssetManifestEntry {
	const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
	const variantId = overrides.variantId ?? randomUUID();
	return {
		assetId: randomUUID(),
		variantId,
		kind: "video",
		contentType: "video/mp4",
		filename: "clip.mp4",
		sha256: createHash("sha256").update(bytes).digest("hex"),
		sizeBytes: bytes.byteLength,
		downloadPath: `/device/assets/${variantId}/url`,
		...overrides
	};
}

export function makeSchedule(layoutRevisionId: string, overrides: Partial<ScheduleManifestEntry> = {}): ScheduleManifestEntry {
	return {
		id: randomUUID(),
		name: "排程",
		priority: 100,
		timezone: "Asia/Taipei",
		startDate: null,
		endDate: null,
		daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
		startTime: "09:00",
		endTime: "17:00",
		layoutRevisionId,
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

export function makeDesiredState(overrides: Partial<DesiredState> = {}): DesiredState {
	return {
		deviceId: randomUUID(),
		version: 1,
		protocolVersion: 1,
		issuedAt: "2026-01-01T00:00:00.000Z",
		deviceName: "測試裝置",
		defaultLayout: null,
		layouts: [],
		schedules: [],
		assets: [],
		settings: { heartbeatIntervalSeconds: 60, fallbackSyncIntervalSeconds: 300, maxConcurrentDownloads: 3 },
		...overrides
	};
}

export function sha256Of(content: string | Uint8Array): string {
	const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
	return createHash("sha256").update(bytes).digest("hex");
}

/* ── 假的 fetch ───────────────────────────────────────────────────────── */

export interface StubRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
}

export type StubHandler = (request: StubRequest) => Response | null | Promise<Response | null>;

export interface StubFetch {
	(input: string, init?: RequestInit): Promise<Response>;
	calls: StubRequest[];
}

/**
 * 取代 `fetch` 的測試替身。
 *
 * 刻意讓未被處理的路徑「連線失敗」而不是回 404：那才是裝置在現場真正會遇到的離線行為，
 * 也才會走到 client 的 `retryable` 判斷。
 */
export function createStubFetch(handler: StubHandler): StubFetch {
	const calls: StubRequest[] = [];
	const stub = async (input: string, init?: RequestInit): Promise<Response> => {
		const request: StubRequest = {
			url: input,
			method: init?.method ?? "GET",
			headers: normalizeHeaders(init?.headers),
			body: typeof init?.body === "string" ? init.body : null
		};
		calls.push(request);
		const response = await handler(request);
		if (!response) throw new Error(`ECONNREFUSED ${input}`);
		return response;
	};
	stub.calls = calls;
	return stub;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	if (!headers) return result;
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			result[key.toLowerCase()] = value;
		});
		return result;
	}
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) result[String(key).toLowerCase()] = String(value);
		return result;
	}
	for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = String(value);
	return result;
}

export function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function bytesResponse(bytes: Uint8Array, init: { status?: number; acceptRanges?: boolean; contentRange?: string } = {}): Response {
	const headers: Record<string, string> = {};
	if (init.acceptRanges !== false) headers["accept-ranges"] = "bytes";
	if (init.contentRange) headers["content-range"] = init.contentRange;
	// 複製到一塊確定不是 SharedArrayBuffer 的記憶體：`BodyInit` 不接受可共享的緩衝區。
	const body = new Uint8Array(new ArrayBuffer(bytes.byteLength));
	body.set(bytes);
	return new Response(body, { status: init.status ?? 200, headers });
}

/** 固定時鐘，可以手動往前推。排程與保留期的測試都靠它。 */
export class FakeClock {
	constructor(private current: Date) {}

	now(): Date {
		return new Date(this.current.getTime());
	}

	set(next: Date): void {
		this.current = next;
	}

	advance(ms: number): void {
		this.current = new Date(this.current.getTime() + ms);
	}
}
