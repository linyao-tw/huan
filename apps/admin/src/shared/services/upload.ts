import { ApiError } from "@/shared/services/http";

export interface UploadProgress {
	loaded: number;
	total: number;
}

export interface DirectUploadOptions {
	url: string;
	headers: Record<string, string>;
	file: File;
	onProgress?: (progress: UploadProgress) => void;
	signal?: AbortSignal;
}

/**
 * 直傳 RustFS。
 *
 * 這裡刻意用 XMLHttpRequest 而不是 fetch：`fetch` 沒有上傳進度事件，
 * 而數 GB 的影片如果沒有進度條，使用者只會看到一個像當掉的畫面。
 */
export function uploadFileWithProgress({ url, headers, file, onProgress, signal }: DirectUploadOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("上傳已取消", "AbortError"));
			return;
		}

		const request = new XMLHttpRequest();
		request.open("PUT", url, true);
		for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

		const abort = (): void => request.abort();
		signal?.addEventListener("abort", abort, { once: true });

		const cleanup = (): void => signal?.removeEventListener("abort", abort);

		request.upload.addEventListener("progress", event => {
			if (!event.lengthComputable) return;
			onProgress?.({ loaded: event.loaded, total: event.total });
		});

		request.addEventListener("load", () => {
			cleanup();
			if (request.status >= 200 && request.status < 300) {
				onProgress?.({ loaded: file.size, total: file.size });
				resolve();
				return;
			}
			reject(new ApiError({ status: request.status, code: "upload_failed", message: `檔案上傳失敗（HTTP ${request.status}），請重試。` }));
		});

		request.addEventListener("error", () => {
			cleanup();
			reject(new ApiError({ status: 0, code: "upload_failed", message: "檔案上傳中斷，請確認網路後重試。" }));
		});

		request.addEventListener("abort", () => {
			cleanup();
			reject(new DOMException("上傳已取消", "AbortError"));
		});

		request.send(file);
	});
}

export type UploadTaskPhase = "queued" | "requesting" | "uploading" | "completing" | "done" | "error" | "cancelled";

export interface UploadTask {
	id: string;
	name: string;
	sizeBytes: number;
	phase: UploadTaskPhase;
	loaded: number;
	assetId: string | null;
	errorMessage: string | null;
}

export const UPLOAD_PHASE_LABELS: Record<UploadTaskPhase, string> = {
	queued: "等待中",
	requesting: "取得上傳授權",
	uploading: "上傳中",
	completing: "建立轉檔工作",
	done: "已送出",
	error: "失敗",
	cancelled: "已取消"
};
