import { JobError, USER_MESSAGES } from "@/errors";
import { downscaleFilter, ffprobe, runFfmpeg } from "@/ffmpeg";
import { measureArtifact, requireAssetId, runStep } from "@/jobs/common";
import type { JobContext } from "@/jobs/types";
import { markAssetProcessing, markAssetReady, replaceVariant, requireOriginalVariant, retireOriginal, saveAssetProbe } from "@/media";
import { sha256File } from "@huan/shared/node";
import { join } from "node:path";

/** 12000×9000 的來源不可以送到 Raspberry Pi，播放版本一律縮到 1080p 以內。 */
export const IMAGE_PLAYBACK_MAX_WIDTH = 1920;
export const IMAGE_PLAYBACK_MAX_HEIGHT = 1080;
export const IMAGE_PREVIEW_MAX_EDGE = 1280;
export const IMAGE_THUMBNAIL_MAX_EDGE = 640;

/**
 * 解碼前的來源像素上限（100 MP，約 10000×10000）。
 *
 * 縮放濾鏡只約束「輸出」尺寸，FFmpeg 仍得先把整張來源解碼進記憶體。一張體積很小
 * 但畫布極大的圖（解壓炸彈）足以讓 worker OOM。probe 拿到尺寸後先擋，不進解碼。
 */
export const IMAGE_MAX_SOURCE_PIXELS = 100_000_000;

/**
 * 輸出格式只有兩種：來源有 alpha 就輸出 PNG，其餘一律 JPEG。
 *
 * 不輸出 WebP 是刻意的取捨——JPEG 與 PNG 在所有播放平台與瀏覽器都能解碼，
 * 而 WebP 的編碼支援取決於 FFmpeg 有沒有編進 libwebp，不值得為了幾成檔案大小
 * 讓產物在某些機器上開不起來。
 */
export function imageFormatFor(hasAlpha: boolean | null): { extension: string; contentType: string; alpha: boolean } {
	return hasAlpha === true ? { extension: ".png", contentType: "image/png", alpha: true } : { extension: ".jpg", contentType: "image/jpeg", alpha: false };
}

/**
 * `-frames:v 1` 代表圖片素材只會有一張靜態畫面。
 *
 * 動態 GIF 因此只保留第一格。HUAN 目前把 GIF 當靜態圖處理，需要動畫的內容請上傳影片；
 * 這是已知且刻意的限制，不是漏掉的功能。
 */
export function buildImageRenditionArgs(options: { sourcePath: string; outputPath: string; maxWidth: number; maxHeight: number; alpha: boolean }): string[] {
	const args = [
		"-hide_banner",
		"-nostdin",
		"-loglevel",
		"error",
		"-y",
		"-i",
		options.sourcePath,
		"-map",
		"0:v:0",
		"-frames:v",
		"1",
		"-update",
		"1",
		"-vf",
		downscaleFilter(options.maxWidth, options.maxHeight)
	];
	if (options.alpha) args.push("-pix_fmt", "rgba");
	else args.push("-pix_fmt", "yuvj420p", "-q:v", "2");
	args.push("-f", "image2", options.outputPath);
	return args;
}

export async function processImage(context: JobContext): Promise<void> {
	const assetId = requireAssetId(context);
	const { db, storage, binaries, logger } = context;

	const original = await requireOriginalVariant(db, assetId);
	await markAssetProcessing(db, assetId);

	const sourcePath = join(context.workDir, "source");
	logger.info({ objectKey: original.objectKey }, "下載原始圖片");
	await runStep(context, "下載原始圖片", USER_MESSAGES.imageProcess, () => storage.downloadToFile(original.objectKey, sourcePath));

	const probe = await runStep(context, "分析原始圖片", USER_MESSAGES.imageProcess, () => ffprobe(binaries, sourcePath));
	if (probe.width === null || probe.height === null) {
		throw new JobError("來源沒有可讀取的影像尺寸", USER_MESSAGES.imageProcess);
	}
	if (probe.width * probe.height > IMAGE_MAX_SOURCE_PIXELS) {
		throw new JobError(`來源影像過大（${probe.width}×${probe.height}），超過 ${IMAGE_MAX_SOURCE_PIXELS} 像素上限`, USER_MESSAGES.imageProcess);
	}
	/** 圖片沒有播放長度，probe 的 duration 對它沒有意義，寫入前歸零避免 UI 顯示「0.04 秒」。 */
	await saveAssetProbe(db, assetId, { ...probe, durationMs: null, frameRate: null });
	logger.info({ width: probe.width, height: probe.height, hasAlpha: probe.hasAlpha }, "原始圖片規格");

	const format = imageFormatFor(probe.hasAlpha);

	const thumbnailPath = join(context.workDir, `thumbnail${format.extension}`);
	await runStep(context, "產生縮圖", USER_MESSAGES.imageProcess, () =>
		runFfmpeg(binaries, buildImageRenditionArgs({ sourcePath, outputPath: thumbnailPath, maxWidth: IMAGE_THUMBNAIL_MAX_EDGE, maxHeight: IMAGE_THUMBNAIL_MAX_EDGE, alpha: format.alpha }))
	);
	const thumbnail = await measureArtifact(context, thumbnailPath, { withDuration: false });

	const previewPath = join(context.workDir, `preview${format.extension}`);
	await runStep(context, "產生預覽圖", USER_MESSAGES.imageProcess, () =>
		runFfmpeg(binaries, buildImageRenditionArgs({ sourcePath, outputPath: previewPath, maxWidth: IMAGE_PREVIEW_MAX_EDGE, maxHeight: IMAGE_PREVIEW_MAX_EDGE, alpha: format.alpha }))
	);
	const preview = await measureArtifact(context, previewPath, { withDuration: false });

	const playbackPath = join(context.workDir, `playback${format.extension}`);
	await runStep(context, "產生播放圖", USER_MESSAGES.imageProcess, () =>
		runFfmpeg(binaries, buildImageRenditionArgs({ sourcePath, outputPath: playbackPath, maxWidth: IMAGE_PLAYBACK_MAX_WIDTH, maxHeight: IMAGE_PLAYBACK_MAX_HEIGHT, alpha: format.alpha }))
	);
	const playback = await measureArtifact(context, playbackPath, { withDuration: false });
	const playbackSha256 = await sha256File(playbackPath);

	const thumbnailKey = storage.objectKeyFor("thumbnail", format.extension);
	const previewKey = storage.objectKeyFor("preview", format.extension);
	const playbackKey = storage.objectKeyFor("playback", format.extension);

	await runStep(context, "上傳產物", USER_MESSAGES.imageProcess, async () => {
		await storage.uploadFile(thumbnailKey, thumbnailPath, format.contentType);
		await storage.uploadFile(previewKey, previewPath, format.contentType);
		await storage.uploadFile(playbackKey, playbackPath, format.contentType);
	});

	await replaceVariant(db, storage, logger, {
		assetId,
		role: "thumbnail",
		objectKey: thumbnailKey,
		contentType: format.contentType,
		sizeBytes: thumbnail.sizeBytes,
		sha256: null,
		width: thumbnail.width,
		height: thumbnail.height,
		durationMs: null
	});
	await replaceVariant(db, storage, logger, {
		assetId,
		role: "preview",
		objectKey: previewKey,
		contentType: format.contentType,
		sizeBytes: preview.sizeBytes,
		sha256: null,
		width: preview.width,
		height: preview.height,
		durationMs: null
	});
	await replaceVariant(db, storage, logger, {
		assetId,
		role: "playback",
		objectKey: playbackKey,
		contentType: format.contentType,
		sizeBytes: playback.sizeBytes,
		sha256: playbackSha256,
		width: playback.width,
		height: playback.height,
		durationMs: null
	});

	await runStep(context, "刪除原始檔", USER_MESSAGES.imageProcess, () => retireOriginal(db, storage, logger, assetId));
	await markAssetReady(db, assetId);
	logger.info({ playbackKey, width: playback.width, height: playback.height, sizeBytes: playback.sizeBytes }, "圖片處理完成");
}
