import { JobError, USER_MESSAGES } from "@/errors";
import { buildFilterChain, downscaleFilter, ffprobe, fpsFilter, runFfmpeg } from "@/ffmpeg";
import { measureArtifact, requireAssetId, runStep } from "@/jobs/common";
import type { JobContext } from "@/jobs/types";
import { markAssetProcessing, markAssetReady, replaceVariant, requireOriginalVariant, retireOriginal, saveAssetProbe } from "@/media";
import { sha256File } from "@huan/shared/node";
import { join } from "node:path";

/** Raspberry Pi 的硬體解碼上限就在 1080p30，超過這個規格的產物在現場只會掉格。 */
export const PLAYBACK_MAX_WIDTH = 1920;
export const PLAYBACK_MAX_HEIGHT = 1080;
export const PLAYBACK_FPS_CAP = 30;

export const PREVIEW_MAX_WIDTH = 854;
export const PREVIEW_MAX_HEIGHT = 480;
export const PREVIEW_FPS_CAP = 30;

export const THUMBNAIL_MAX_WIDTH = 640;

/** 縮圖取影片一成處的畫面；太短的片子開頭就是唯一有代表性的畫面。 */
const THUMBNAIL_SEEK_RATIO = 0.1;
const THUMBNAIL_MIN_DURATION_MS = 3_000;

export interface VideoRenditionOptions {
	sourcePath: string;
	outputPath: string;
	maxWidth: number;
	maxHeight: number;
	fpsCap: number;
	sourceFrameRate: number | null;
	hasAudio: boolean;
	/** libx264 的相容性參數。playback 綁死 High@4.0，preview 只求檔案小。 */
	videoOptions: readonly string[];
	audioBitrate: string;
}

/**
 * 組出一次視訊轉檔的參數陣列。
 *
 * `-map 0:v:0` 只取第一條視訊軌：帶封面圖的 MP4 會多一條 mjpeg 視訊軌，
 * 不指定的話 libx264 會試著把封面也編進去而整支失敗。
 * `-map 0:a:0?` 的問號讓沒有聲音的來源也能通過，不會因為找不到音軌就中止。
 */
export function buildVideoRenditionArgs(options: VideoRenditionOptions): string[] {
	const filters = buildFilterChain([fpsFilter(options.sourceFrameRate, options.fpsCap), downscaleFilter(options.maxWidth, options.maxHeight)]);
	const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", options.sourcePath, "-map", "0:v:0"];
	if (options.hasAudio) args.push("-map", "0:a:0?");
	args.push("-vf", filters, "-c:v", "libx264", ...options.videoOptions, "-pix_fmt", "yuv420p");
	if (options.hasAudio) args.push("-c:a", "aac", "-b:a", options.audioBitrate, "-ac", "2");
	else args.push("-an");
	args.push("-movflags", "+faststart", "-f", "mp4", options.outputPath);
	return args;
}

export function buildThumbnailArgs(options: { sourcePath: string; outputPath: string; seekSeconds: number; maxWidth: number }): string[] {
	const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"];
	if (options.seekSeconds > 0) args.push("-ss", options.seekSeconds.toFixed(3));
	args.push("-i", options.sourcePath, "-map", "0:v:0", "-frames:v", "1", "-vf", `scale='min(${options.maxWidth},iw)':-2`, "-pix_fmt", "yuvj420p", "-q:v", "3", "-f", "image2", options.outputPath);
	return args;
}

export function thumbnailSeekSeconds(durationMs: number | null): number {
	if (durationMs === null || durationMs < THUMBNAIL_MIN_DURATION_MS) return 0;
	return (durationMs / 1000) * THUMBNAIL_SEEK_RATIO;
}

export async function transcodeVideo(context: JobContext): Promise<void> {
	const assetId = requireAssetId(context);
	const { db, storage, binaries, logger } = context;

	const original = await requireOriginalVariant(db, assetId);
	await markAssetProcessing(db, assetId);

	const sourcePath = join(context.workDir, "source");
	logger.info({ objectKey: original.objectKey }, "下載原始影片");
	await runStep(context, "下載原始影片", USER_MESSAGES.videoTranscode, () => storage.downloadToFile(original.objectKey, sourcePath));

	const probe = await runStep(context, "分析原始影片", USER_MESSAGES.videoTranscode, () => ffprobe(binaries, sourcePath));
	if (probe.videoCodec === null || probe.width === null || probe.height === null) {
		throw new JobError("來源沒有可用的視訊軌", USER_MESSAGES.videoTranscode);
	}
	await saveAssetProbe(db, assetId, probe);
	logger.info({ width: probe.width, height: probe.height, frameRate: probe.frameRate, durationMs: probe.durationMs, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec }, "原始影片規格");

	const hasAudio = probe.audioCodec !== null;

	const thumbnailPath = join(context.workDir, "thumbnail.jpg");
	await runStep(context, "產生縮圖", USER_MESSAGES.videoTranscode, () =>
		runFfmpeg(binaries, buildThumbnailArgs({ sourcePath, outputPath: thumbnailPath, seekSeconds: thumbnailSeekSeconds(probe.durationMs), maxWidth: THUMBNAIL_MAX_WIDTH }))
	);
	const thumbnail = await measureArtifact(context, thumbnailPath, { withDuration: false });

	const previewPath = join(context.workDir, "preview.mp4");
	await runStep(context, "產生預覽影片", USER_MESSAGES.videoTranscode, () =>
		runFfmpeg(
			binaries,
			buildVideoRenditionArgs({
				sourcePath,
				outputPath: previewPath,
				maxWidth: PREVIEW_MAX_WIDTH,
				maxHeight: PREVIEW_MAX_HEIGHT,
				fpsCap: PREVIEW_FPS_CAP,
				sourceFrameRate: probe.frameRate,
				hasAudio,
				videoOptions: ["-profile:v", "main", "-preset", "veryfast", "-crf", "28"],
				audioBitrate: "96k"
			})
		)
	);
	const preview = await measureArtifact(context, previewPath, { withDuration: true });

	const playbackPath = join(context.workDir, "playback.mp4");
	await runStep(context, "產生播放影片", USER_MESSAGES.videoTranscode, () =>
		runFfmpeg(
			binaries,
			buildVideoRenditionArgs({
				sourcePath,
				outputPath: playbackPath,
				maxWidth: PLAYBACK_MAX_WIDTH,
				maxHeight: PLAYBACK_MAX_HEIGHT,
				fpsCap: PLAYBACK_FPS_CAP,
				sourceFrameRate: probe.frameRate,
				hasAudio,
				videoOptions: ["-profile:v", "high", "-level", "4.0", "-preset", "medium", "-crf", "21"],
				audioBitrate: "128k"
			})
		)
	);
	const playback = await measureArtifact(context, playbackPath, { withDuration: true });
	const playbackSha256 = await sha256File(playbackPath);

	const thumbnailKey = storage.objectKeyFor("thumbnail", ".jpg");
	const previewKey = storage.objectKeyFor("preview", ".mp4");
	const playbackKey = storage.objectKeyFor("playback", ".mp4");

	await runStep(context, "上傳產物", USER_MESSAGES.videoTranscode, async () => {
		await storage.uploadFile(thumbnailKey, thumbnailPath, "image/jpeg");
		await storage.uploadFile(previewKey, previewPath, "video/mp4");
		await storage.uploadFile(playbackKey, playbackPath, "video/mp4");
	});

	await replaceVariant(db, storage, logger, {
		assetId,
		role: "thumbnail",
		objectKey: thumbnailKey,
		contentType: "image/jpeg",
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
		contentType: "video/mp4",
		sizeBytes: preview.sizeBytes,
		sha256: null,
		width: preview.width,
		height: preview.height,
		durationMs: preview.durationMs
	});
	await replaceVariant(db, storage, logger, {
		assetId,
		role: "playback",
		objectKey: playbackKey,
		contentType: "video/mp4",
		sizeBytes: playback.sizeBytes,
		sha256: playbackSha256,
		width: playback.width,
		height: playback.height,
		durationMs: playback.durationMs
	});

	await runStep(context, "刪除原始檔", USER_MESSAGES.videoTranscode, () => retireOriginal(db, storage, logger, assetId));
	await markAssetReady(db, assetId);
	logger.info({ playbackKey, width: playback.width, height: playback.height, sizeBytes: playback.sizeBytes }, "影片轉檔完成");
}
