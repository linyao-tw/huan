import { JobError, USER_MESSAGES } from "@/errors";
import { requireAssetId, runStep } from "@/jobs/common";
import type { JobContext } from "@/jobs/types";
import { markAssetProcessing, markAssetReady, replaceVariant, requireOriginalVariant, retireOriginal } from "@/media";
import { ObjectTooLargeError } from "@/storage";
import { sha256File } from "@huan/shared/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 單一自含 HTML 的大小上限。
 *
 * HTML 素材必須是一個檔案就能播放的頁面，內嵌字型與圖片後 5 MB 已經很寬鬆；
 * 再大通常代表使用者傳錯了東西，而且每台裝置都要下載這份檔案。
 */
export const HTML_MAX_BYTES = 5 * 1024 * 1024;

export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * 判斷這份位元組真的是 HTML 文字。
 *
 * 只看副檔名或 Content-Type 不夠：那兩者都由上傳端自己宣告。NUL 位元組代表二進位檔，
 * U+FFFD 代表它不是合法的 UTF-8，兩者都不可能是我們要塞進 sandbox iframe 的頁面。
 */
export function looksLikeHtml(content: Buffer): boolean {
	if (content.length === 0) return false;
	if (content.includes(0)) return false;
	const text = content.toString("utf8");
	if (text.includes("�")) return false;
	return /<\s*(!doctype\s+html|html|head|body|meta|title|div|span|p|section|main|script|style|link|img|canvas|iframe)\b/i.test(text);
}

/**
 * HTML 不需要轉檔，只做驗證與搬移。
 *
 * 這裡刻意不產生縮圖：用 FFmpeg 的 `drawtext` 畫一張假預覽圖只會讓素材庫看起來
 * 像有預覽其實沒有。HTML 素材不建立 `thumbnail` 產物，Admin 端以圖示呈現。
 */
export async function processHtml(context: JobContext): Promise<void> {
	const assetId = requireAssetId(context);
	const { db, storage, logger } = context;

	const original = await requireOriginalVariant(db, assetId);
	await markAssetProcessing(db, assetId);

	const head = await runStep(context, "讀取原始檔資訊", USER_MESSAGES.htmlProcess, () => storage.head(original.objectKey));
	if (head === null) throw new JobError(`物件 ${original.objectKey} 不存在`, USER_MESSAGES.missingOriginal);
	if (head.sizeBytes > HTML_MAX_BYTES) throw new JobError(`HTML 物件 ${head.sizeBytes} bytes 超過上限`, USER_MESSAGES.htmlTooLarge);

	const sourcePath = join(context.workDir, "source.html");
	logger.info({ objectKey: original.objectKey, sizeBytes: head.sizeBytes }, "下載 HTML 原始檔");
	try {
		await storage.downloadToFile(original.objectKey, sourcePath, { maxBytes: HTML_MAX_BYTES });
	} catch (error) {
		if (error instanceof ObjectTooLargeError) throw new JobError("HTML 物件超過上限", USER_MESSAGES.htmlTooLarge, { cause: error });
		throw new JobError("下載 HTML 原始檔失敗", USER_MESSAGES.storageUnavailable, { cause: error });
	}

	const content = await readFile(sourcePath);
	if (!looksLikeHtml(content)) throw new JobError("內容不是有效的 HTML 文字", USER_MESSAGES.htmlNotHtml);

	const sha256 = await sha256File(sourcePath);
	const playbackKey = storage.objectKeyFor("playback", ".html");
	await runStep(context, "上傳 HTML 產物", USER_MESSAGES.htmlProcess, () => storage.uploadFile(playbackKey, sourcePath, HTML_CONTENT_TYPE));

	await replaceVariant(db, storage, logger, {
		assetId,
		role: "playback",
		objectKey: playbackKey,
		contentType: HTML_CONTENT_TYPE,
		sizeBytes: content.byteLength,
		sha256,
		width: null,
		height: null,
		durationMs: null
	});

	await runStep(context, "刪除原始檔", USER_MESSAGES.htmlProcess, () => retireOriginal(db, storage, logger, assetId));
	await markAssetReady(db, assetId);
	logger.info({ playbackKey, sizeBytes: content.byteLength }, "HTML 處理完成");
}
