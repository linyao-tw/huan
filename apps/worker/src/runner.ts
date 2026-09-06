import { JobError, USER_MESSAGES, describeError, toUserMessage } from "@/errors";
import type { FfmpegBinaries } from "@/ffmpeg";
import { cleanupDistribution, jobHandlers } from "@/jobs";
import type { JobHandler } from "@/jobs/types";
import type { WorkerLogger } from "@/logger";
import { markAssetFailed } from "@/media";
import type { ClaimedJob, JobQueue } from "@/queue";
import type { ObjectStorage } from "@/storage";
import type { WorkerEnv } from "@huan/config";
import type { Database } from "@huan/db";
import type { WorkerJobKind } from "@huan/protocol";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 卡住的工作要多久掃一次。比 stale 門檻密集得多，被砍掉的工作才不會等上半小時。 */
const DEFAULT_STALE_SWEEP_INTERVAL_MS = 60_000;

/** distribution 回收由 Worker 自己排程，而不是每個週期往 worker_jobs 塞一列垃圾。 */
const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60_000;

export interface WorkerRunnerOptions {
	db: Database;
	storage: ObjectStorage;
	queue: JobQueue;
	env: WorkerEnv;
	logger: WorkerLogger;
	binaries?: FfmpegBinaries;
	handlers?: Record<WorkerJobKind, JobHandler>;
	staleSweepIntervalMs?: number;
	cleanupIntervalMs?: number;
	/** 設定成 0 可以停用內部排程的回收，測試會用到。 */
	runCleanup?: boolean;
}

const DEFAULT_USER_MESSAGE: Record<WorkerJobKind, string> = {
	transcode_video: USER_MESSAGES.videoTranscode,
	process_image: USER_MESSAGES.imageProcess,
	process_html: USER_MESSAGES.htmlProcess,
	cleanup_distribution: USER_MESSAGES.unexpected
};

export class WorkerRunner {
	private readonly options: WorkerRunnerOptions;
	private readonly binaries: FfmpegBinaries;
	private readonly handlers: Record<WorkerJobKind, JobHandler>;
	private readonly staleSweepIntervalMs: number;
	private readonly cleanupIntervalMs: number;
	private readonly inFlight = new Set<Promise<void>>();
	private readonly tmpRoot: string;

	private running = false;
	private wake: (() => void) | null = null;
	private nextStaleSweepAt = 0;
	private nextCleanupAt = 0;

	constructor(options: WorkerRunnerOptions) {
		this.options = options;
		this.binaries = options.binaries ?? { ffmpegPath: options.env.FFMPEG_PATH, ffprobePath: options.env.FFPROBE_PATH };
		this.handlers = options.handlers ?? jobHandlers;
		this.staleSweepIntervalMs = options.staleSweepIntervalMs ?? DEFAULT_STALE_SWEEP_INTERVAL_MS;
		this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
		this.tmpRoot = options.env.WORKER_TMP_DIR ?? tmpdir();
	}

	/** 輪詢直到 `requestStop()` 被呼叫；回傳的 promise 在所有進行中的工作都收尾後才 resolve。 */
	async start(): Promise<void> {
		await mkdir(this.tmpRoot, { recursive: true });
		this.running = true;
		this.options.logger.info({ concurrency: this.options.env.WORKER_CONCURRENCY, pollIntervalMs: this.options.env.WORKER_POLL_INTERVAL_MS, lockedBy: this.options.queue.lockedBy }, "Worker 開始輪詢");

		while (this.running) {
			let claimedAny = false;
			try {
				await this.sweepStaleJobs();
				await this.maybeCleanup();
				claimedAny = await this.fillSlots();
			} catch (error) {
				this.options.logger.error({ err: describeError(error) }, "輪詢失敗，稍後重試");
			}
			if (!this.running) break;
			/** 剛取到工作而且還有空位時不要睡滿一個週期，累積的佇列要能一次抽乾。 */
			const hasCapacity = this.inFlight.size < this.options.env.WORKER_CONCURRENCY;
			await this.pause(claimedAny && hasCapacity ? 0 : this.options.env.WORKER_POLL_INTERVAL_MS);
		}

		await this.drain();
		this.options.logger.info("Worker 已停止輪詢");
	}

	/** 停止取新工作。進行中的工作會跑完，不會被砍在一半。 */
	requestStop(): void {
		if (!this.running) return;
		this.running = false;
		this.wake?.();
	}

	get inFlightCount(): number {
		return this.inFlight.size;
	}

	/** 存活探針要看的不是「process 還在」，而是「輪詢迴圈還在跑」。 */
	get isPolling(): boolean {
		return this.running;
	}

	/** 走完一次完整流程並等進行中的工作結束。測試用，不參與正式輪詢。 */
	async runOnce(): Promise<boolean> {
		this.running = true;
		const claimed = await this.fillSlots();
		this.running = false;
		await this.drain();
		return claimed;
	}

	private async fillSlots(): Promise<boolean> {
		let claimed = false;
		while (this.running && this.inFlight.size < this.options.env.WORKER_CONCURRENCY) {
			const job = await this.options.queue.claim();
			if (!job) break;
			claimed = true;
			const task = this.runJob(job);
			this.inFlight.add(task);
			task.then(
				() => this.inFlight.delete(task),
				() => this.inFlight.delete(task)
			);
		}
		return claimed;
	}

	private async runJob(job: ClaimedJob): Promise<void> {
		const logger = this.options.logger.child({ jobId: job.id, assetId: job.assetId, kind: job.kind, attempt: job.attempt });
		const startedAt = Date.now();
		const workDir = await mkdtemp(join(this.tmpRoot, "huan-job-"));
		logger.info("開始處理工作");

		try {
			const handler: JobHandler | undefined = this.handlers[job.kind];
			if (!handler) throw new JobError(`未知的工作類型 ${job.kind}`, USER_MESSAGES.unexpected);
			await handler({
				db: this.options.db,
				storage: this.options.storage,
				binaries: this.binaries,
				env: this.options.env,
				logger,
				job,
				workDir
			});
			await this.options.queue.markSuccess(job.id);
			logger.info({ durationMs: Date.now() - startedAt }, "工作完成");
		} catch (error) {
			await this.handleFailure(job, logger, error);
		} finally {
			await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
				logger.warn({ err: describeError(error) }, "清除暫存目錄失敗");
			});
		}
	}

	private async handleFailure(job: ClaimedJob, logger: WorkerLogger, error: unknown): Promise<void> {
		const userMessage = toUserMessage(error, DEFAULT_USER_MESSAGE[job.kind] ?? USER_MESSAGES.unexpected);
		logger.error({ err: describeError(error), attempt: job.attempt, maxAttempts: job.maxAttempts }, "工作失敗");

		try {
			const outcome = await this.options.queue.markFailure(job, userMessage);
			if (outcome.retryScheduled) {
				logger.warn({ runAfter: outcome.runAfter?.toISOString() ?? null }, "已排入重試");
				return;
			}
			/** 只有真的不會再重試時才把素材標成失敗，否則使用者會在重試期間看到假的錯誤。 */
			if (job.assetId) await markAssetFailed(this.options.db, job.assetId, userMessage);
			logger.error("工作已達重試上限，素材標記為失敗");
		} catch (bookkeepingError) {
			logger.error({ err: describeError(bookkeepingError) }, "寫入失敗狀態時發生錯誤");
		}
	}

	private async sweepStaleJobs(): Promise<void> {
		const now = Date.now();
		if (now < this.nextStaleSweepAt) return;
		this.nextStaleSweepAt = now + this.staleSweepIntervalMs;

		const recovered = await this.options.queue.recoverStaleJobs();
		for (const job of recovered) {
			this.options.logger.warn({ jobId: job.id, kind: job.kind, assetId: job.assetId, attempt: job.attempt, outcome: job.outcome }, "回收卡住的工作");
			if (job.outcome === "failed" && job.assetId) {
				await markAssetFailed(this.options.db, job.assetId, DEFAULT_USER_MESSAGE[job.kind] ?? USER_MESSAGES.unexpected);
			}
		}
	}

	private async maybeCleanup(): Promise<void> {
		if (this.options.runCleanup === false) return;
		const now = Date.now();
		if (now < this.nextCleanupAt) return;
		this.nextCleanupAt = now + this.cleanupIntervalMs;

		try {
			await cleanupDistribution({
				db: this.options.db,
				storage: this.options.storage,
				logger: this.options.logger,
				retentionHours: this.options.env.DISTRIBUTION_RETENTION_HOURS
			});
		} catch (error) {
			this.options.logger.error({ err: describeError(error) }, "distribution 回收失敗");
		}
	}

	private async drain(): Promise<void> {
		while (this.inFlight.size > 0) {
			await Promise.allSettled([...this.inFlight]);
		}
	}

	private pause(ms: number): Promise<void> {
		return new Promise(resolve => {
			const timer = setTimeout(() => {
				this.wake = null;
				resolve();
			}, ms);
			this.wake = () => {
				clearTimeout(timer);
				this.wake = null;
				resolve();
			};
		});
	}
}
