import { JobError, USER_MESSAGES, describeError } from "@/errors";
import { FfmpegError, ffprobe } from "@/ffmpeg";
import type { JobContext } from "@/jobs/types";
import { StorageError } from "@/storage";
import { stat } from "node:fs/promises";

export function requireAssetId(context: JobContext): string {
	const assetId = context.job.assetId;
	if (!assetId) throw new JobError(`工作 ${context.job.id} 缺少 asset_id`, USER_MESSAGES.unexpected);
	return assetId;
}

/**
 * 執行一個步驟並把例外收斂成 `JobError`。
 *
 * FFmpeg 的 stderr 與物件鍵只寫進結構化日誌；丟給上層的 `JobError` 只帶一句
 * 可以直接顯示給使用者的中文說明。
 */
export async function runStep<T>(context: JobContext, step: string, userMessage: string, action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof JobError) throw error;
		if (error instanceof FfmpegError) {
			context.logger.error({ step, exitCode: error.exitCode, signal: error.signal, stderr: error.stderrTail }, "FFmpeg 步驟失敗");
			throw new JobError(`${step} 失敗`, userMessage, { cause: error });
		}
		if (error instanceof StorageError) {
			context.logger.error({ step, err: describeError(error) }, "物件儲存步驟失敗");
			throw new JobError(`${step} 失敗`, USER_MESSAGES.storageUnavailable, { cause: error });
		}
		context.logger.error({ step, err: describeError(error) }, "工作步驟失敗");
		throw new JobError(`${step} 失敗`, userMessage, { cause: error });
	}
}

export interface ArtifactMeasurement {
	sizeBytes: number;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}

/**
 * 量測產物本身，而不是沿用來源的數值。
 *
 * 縮放濾鏡會為了偶數邊長微調尺寸，資料庫裡必須是 Device 實際會拿到的那一組數字。
 */
export async function measureArtifact(context: JobContext, filePath: string, options: { withDuration: boolean }): Promise<ArtifactMeasurement> {
	const info = await stat(filePath);
	if (info.size === 0) throw new JobError(`產物 ${filePath} 是空檔案`, USER_MESSAGES.unexpected);
	const probe = await ffprobe(context.binaries, filePath);
	return {
		sizeBytes: info.size,
		width: probe.width,
		height: probe.height,
		durationMs: options.withDuration ? probe.durationMs : null
	};
}
