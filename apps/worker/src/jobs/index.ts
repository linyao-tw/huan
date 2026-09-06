import { cleanupDistribution } from "@/jobs/cleanup-distribution";
import { processHtml } from "@/jobs/process-html";
import { processImage } from "@/jobs/process-image";
import { transcodeVideo } from "@/jobs/transcode-video";
import type { JobContext, JobHandler } from "@/jobs/types";
import type { WorkerJobKind } from "@huan/protocol";

/**
 * `cleanup_distribution` 平常由 Worker 的內部排程直接呼叫，不會每個週期都寫一筆資料列。
 * 這裡仍然註冊 handler，是為了讓運維可以手動排一筆立即執行的回收工作。
 */
async function runCleanupJob(context: JobContext): Promise<void> {
	await cleanupDistribution({
		db: context.db,
		storage: context.storage,
		logger: context.logger,
		retentionHours: context.env.DISTRIBUTION_RETENTION_HOURS
	});
}

export const jobHandlers: Record<WorkerJobKind, JobHandler> = {
	transcode_video: transcodeVideo,
	process_image: processImage,
	process_html: processHtml,
	cleanup_distribution: runCleanupJob
};

export { cleanupDistribution } from "@/jobs/cleanup-distribution";
export type { JobContext, JobHandler } from "@/jobs/types";
