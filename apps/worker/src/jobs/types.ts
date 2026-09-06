import type { FfmpegBinaries } from "@/ffmpeg";
import type { WorkerLogger } from "@/logger";
import type { ClaimedJob } from "@/queue";
import type { ObjectStorage } from "@/storage";
import type { WorkerEnv } from "@huan/config";
import type { Database } from "@huan/db";

export interface JobContext {
	readonly db: Database;
	readonly storage: ObjectStorage;
	readonly binaries: FfmpegBinaries;
	readonly env: WorkerEnv;
	/** 已經帶上 jobId、assetId 與 kind 的子 logger。 */
	readonly logger: WorkerLogger;
	readonly job: ClaimedJob;
	/** 這個工作專用的暫存目錄，成功或失敗都會在結束時整個刪除。 */
	readonly workDir: string;
}

export type JobHandler = (context: JobContext) => Promise<void>;
