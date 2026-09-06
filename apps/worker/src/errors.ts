/**
 * 工作失敗時的雙軌訊息。
 *
 * `userMessage` 會寫進 `media_assets.error_message`，Admin 會原封不動顯示給使用者，
 * 因此絕不可以包含檔案路徑、物件鍵或 FFmpeg 指令列；技術細節只透過 `cause` 與結構化日誌保留。
 */
export class JobError extends Error {
	readonly userMessage: string;

	constructor(message: string, userMessage: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "JobError";
		this.userMessage = userMessage;
	}
}

/** 面向使用者的固定文案。訊息要能指引下一步，不要只說「失敗」。 */
export const USER_MESSAGES = {
	videoTranscode: "影片轉檔失敗，來源檔案可能損毀或格式不支援。",
	imageProcess: "圖片處理失敗，來源檔案可能損毀或格式不支援。",
	htmlProcess: "HTML 處理失敗，請確認是單一自含的 HTML 檔案且大小在 5 MB 以內。",
	htmlTooLarge: "HTML 檔案超過 5 MB 上限，請精簡內容後重新上傳。",
	htmlNotHtml: "上傳的檔案不是有效的 HTML 文件，請重新上傳。",
	missingOriginal: "找不到可用的原始檔，請重新上傳這個素材。",
	storageUnavailable: "儲存服務暫時無法存取，請稍後再試。",
	unexpected: "素材處理失敗，請稍後再試或重新上傳。"
} as const;

/**
 * 把任何例外收斂成使用者看得懂的一句話。
 *
 * 預設值刻意保守：寧可講得籠統，也不要把內部細節漏給使用者。
 */
export function toUserMessage(error: unknown, fallback: string = USER_MESSAGES.unexpected): string {
	return error instanceof JobError ? error.userMessage : fallback;
}

/** 日誌用的技術描述。這個字串只會進 stdout 的結構化日誌，不會寫進資料庫。 */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		const cause = error.cause instanceof Error ? ` <- ${error.cause.name}: ${error.cause.message}` : "";
		return `${error.name}: ${error.message}${cause}`;
	}
	return String(error);
}
