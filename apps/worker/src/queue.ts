import type { Database } from "@huan/db";
import { workerJobs } from "@huan/db";
import type { WorkerJobKind } from "@huan/protocol";
import { backoffBaseDelay, type BackoffOptions } from "@huan/shared";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/** 超過這個時間還停在 `running` 的工作，視為持有它的 Worker 已經死了。 */
export const DEFAULT_STALE_JOB_MS = 10 * 60_000;

export const STALE_RETRY_MESSAGE = "工作處理中斷，已重新排入佇列。";
export const STALE_EXHAUSTED_MESSAGE = "工作處理中斷且已達重試上限。";

export interface ClaimedJob {
	id: string;
	kind: WorkerJobKind;
	assetId: string | null;
	payload: Record<string, unknown>;
	attempt: number;
	maxAttempts: number;
}

export interface FailureOutcome {
	retryScheduled: boolean;
	runAfter: Date | null;
}

export interface RecoveredJob {
	id: string;
	kind: WorkerJobKind;
	assetId: string | null;
	attempt: number;
	maxAttempts: number;
	outcome: "requeued" | "failed";
}

export interface JobQueueOptions {
	/** 這個 process 的識別字。留給運維在資料庫裡看出是哪一台機器卡住了。 */
	lockedBy?: string;
	staleAfterMs?: number;
	backoff?: BackoffOptions;
}

type ClaimRow = {
	id: string;
	kind: WorkerJobKind;
	asset_id: string | null;
	payload: Record<string, unknown> | null;
	attempt: number;
	max_attempts: number;
};

type StaleRow = {
	id: string;
	kind: WorkerJobKind;
	asset_id: string | null;
	attempt: number;
	max_attempts: number;
};

export class JobQueue {
	readonly lockedBy: string;
	private readonly db: Database;
	private readonly staleAfterMs: number;
	private readonly backoff: BackoffOptions;

	constructor(db: Database, options: JobQueueOptions = {}) {
		this.db = db;
		this.lockedBy = options.lockedBy ?? `${hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;
		this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_JOB_MS;
		this.backoff = options.backoff ?? {};
	}

	/**
	 * 取出一筆待處理工作。
	 *
	 * `FOR UPDATE SKIP LOCKED` 是整個佇列不需要 Redis 的關鍵：同時輪詢的 Worker
	 * 不會互相等待，被別人鎖住的列直接跳過，因此併發取件既不重複也不阻塞。
	 * 取件與狀態變更在同一個交易裡完成，Worker 在中途被砍掉時交易會回滾，
	 * 工作留在 `pending` 而不是消失。
	 */
	async claim(): Promise<ClaimedJob | null> {
		const rows = await this.db.transaction(async tx =>
			tx.execute<ClaimRow>(sql`
				with claimed as (
					select id
					from worker_jobs
					where status = 'pending' and run_after <= now()
					order by run_after, created_at
					for update skip locked
					limit 1
				)
				update worker_jobs as j
				set status = 'running',
					started_at = now(),
					finished_at = null,
					locked_by = ${this.lockedBy},
					attempt = j.attempt + 1,
					updated_at = now()
				from claimed
				where j.id = claimed.id
				returning j.id, j.kind, j.asset_id, j.payload, j.attempt, j.max_attempts
			`)
		);

		const row = rows.at(0);
		if (!row) return null;
		return {
			id: row.id,
			kind: row.kind,
			assetId: row.asset_id,
			payload: row.payload ?? {},
			attempt: row.attempt,
			maxAttempts: row.max_attempts
		};
	}

	async markSuccess(jobId: string): Promise<void> {
		await this.db.update(workerJobs).set({ status: "success", finishedAt: new Date(), error: null, lockedBy: null, updatedAt: new Date() }).where(eq(workerJobs.id, jobId));
	}

	/**
	 * 記錄一次失敗。
	 *
	 * 還有重試額度就退回 `pending` 並往後排；額度用盡才寫成 `failed`。
	 * `message` 會被使用者看到，呼叫端必須傳已經過濾的文案。
	 */
	async markFailure(job: Pick<ClaimedJob, "id" | "attempt" | "maxAttempts">, message: string): Promise<FailureOutcome> {
		if (job.attempt < job.maxAttempts) {
			const delayMs = this.retryDelayMs(job.attempt);
			const rows = await this.db
				.update(workerJobs)
				.set({
					status: "pending",
					/** 用資料庫的 `now()` 而不是 Worker 的時鐘，多台 Worker 的時間偏差才不會影響排程。 */
					runAfter: sql`now() + make_interval(secs => ${delayMs / 1000})`,
					lockedBy: null,
					startedAt: null,
					finishedAt: null,
					error: message,
					updatedAt: new Date()
				})
				.where(eq(workerJobs.id, job.id))
				.returning({ runAfter: workerJobs.runAfter });
			return { retryScheduled: true, runAfter: rows.at(0)?.runAfter ?? null };
		}

		await this.db.update(workerJobs).set({ status: "failed", finishedAt: new Date(), lockedBy: null, error: message, updatedAt: new Date() }).where(eq(workerJobs.id, job.id));
		return { retryScheduled: false, runAfter: null };
	}

	/**
	 * 回收卡在 `running` 的工作。
	 *
	 * Worker 被 SIGKILL 或機器斷電時，資料列會永遠停在 `running`，沒有人會再碰它。
	 * 這裡以 `started_at` 判斷逾時；退避照樣套用，避免真正會拖垮 process 的工作
	 * 一被回收就立刻再打死一台 Worker。
	 */
	async recoverStaleJobs(): Promise<RecoveredJob[]> {
		const staleSeconds = this.staleAfterMs / 1000;
		return this.db.transaction(async tx => {
			const stale = await tx.execute<StaleRow>(sql`
				select id, kind, asset_id, attempt, max_attempts
				from worker_jobs
				where status = 'running' and started_at is not null and started_at < now() - make_interval(secs => ${staleSeconds})
				for update skip locked
			`);

			const recovered: RecoveredJob[] = [];
			for (const row of stale) {
				const requeue = row.attempt < row.max_attempts;
				if (requeue) {
					const delayMs = this.retryDelayMs(row.attempt);
					await tx
						.update(workerJobs)
						.set({
							status: "pending",
							runAfter: sql`now() + make_interval(secs => ${delayMs / 1000})`,
							lockedBy: null,
							startedAt: null,
							finishedAt: null,
							error: STALE_RETRY_MESSAGE,
							updatedAt: new Date()
						})
						.where(eq(workerJobs.id, row.id));
				} else {
					await tx.update(workerJobs).set({ status: "failed", finishedAt: new Date(), lockedBy: null, error: STALE_EXHAUSTED_MESSAGE, updatedAt: new Date() }).where(eq(workerJobs.id, row.id));
				}
				recovered.push({
					id: row.id,
					kind: row.kind,
					assetId: row.asset_id,
					attempt: row.attempt,
					maxAttempts: row.max_attempts,
					outcome: requeue ? "requeued" : "failed"
				});
			}
			return recovered;
		});
	}

	/**
	 * `attempt` 在取件時就 +1，所以第一次失敗時是 1；退避的指數要從 0 起算，
	 * 才會得到 base、2×base、4×base 的序列。
	 *
	 * 這裡刻意用不帶抖動的 `backoffBaseDelay`：工作是靠 `SKIP LOCKED` 逐一取件的，
	 * 本來就不會出現同時湧入的驚群，換來的是可預測、可斷言的重試時間。
	 */
	private retryDelayMs(attempt: number): number {
		return backoffBaseDelay(Math.max(0, attempt - 1), this.backoff);
	}
}
