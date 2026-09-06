import { JobQueue } from "@/queue";
import type { TestHarness } from "@/test-support";
import { announceSkip, createHarness } from "@/test-support";
import { workerJobs } from "@huan/db";
import { sleep } from "@huan/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const FAILURE_MESSAGE = "影片轉檔失敗，來源檔案可能損毀或格式不支援。";

let harness: TestHarness | null = null;
let createdJobs: string[] = [];

beforeAll(async () => {
	const result = await createHarness();
	if (!result.ok) {
		announceSkip(`跳過佇列測試：${result.reason}`);
		return;
	}
	harness = result.harness;
});

/** `worker_jobs` 是共用的表，每個測試結束就把自己造出來的資料列清乾淨。 */
afterEach(async () => {
	if (!harness || createdJobs.length === 0) return;
	for (const jobId of createdJobs) await harness.db.execute(sql`delete from worker_jobs where id = ${jobId}`);
	createdJobs = [];
});

afterAll(async () => {
	if (harness) await harness.cleanup();
});

async function insertJob(active: TestHarness, options: { runAfter: Date; maxAttempts?: number; attempt?: number }): Promise<string> {
	const rows = await active.db
		.insert(workerJobs)
		.values({ kind: "cleanup_distribution", runAfter: options.runAfter, maxAttempts: options.maxAttempts ?? 3, attempt: options.attempt ?? 0 })
		.returning({ id: workerJobs.id });
	const id = rows[0].id;
	createdJobs.push(id);
	return id;
}

interface JobSnapshot {
	status: string;
	attempt: number;
	error: string | null;
	runAfter: Date;
	lockedBy: string | null;
}

/** drizzle 的 raw `execute` 不會把 timestamptz 轉成 Date，所以這裡自己轉。 */
async function jobRow(active: TestHarness, jobId: string): Promise<JobSnapshot> {
	const rows = await active.db.execute<{ status: string; attempt: number; error: string | null; run_after: string; locked_by: string | null }>(
		sql`select status, attempt, error, run_after, locked_by from worker_jobs where id = ${jobId}`
	);
	const row = rows[0];
	return { status: row.status, attempt: row.attempt, error: row.error, runAfter: new Date(row.run_after), lockedBy: row.locked_by };
}

async function databaseNow(active: TestHarness): Promise<Date> {
	const rows = await active.db.execute<{ ts: string }>(sql`select now() as ts`);
	return new Date(rows[0].ts);
}

describe("PostgreSQL 工作佇列", () => {
	it("兩個同時取件的 Worker 不會拿到同一筆工作", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		await insertJob(active, { runAfter: new Date(Date.now() - 20_000) });
		await insertJob(active, { runAfter: new Date(Date.now() - 19_000) });

		const queueA = new JobQueue(active.db, { lockedBy: "worker-a" });
		const queueB = new JobQueue(active.db, { lockedBy: "worker-b" });
		const [claimedA, claimedB] = await Promise.all([queueA.claim(), queueB.claim()]);

		expect(claimedA).not.toBeNull();
		expect(claimedB).not.toBeNull();
		expect(claimedA?.id).not.toBe(claimedB?.id);
		/** 取件時就把 attempt +1，重試次數才不會因為 Worker 中途死掉而漏算。 */
		expect(claimedA?.attempt).toBe(1);
		expect(claimedB?.attempt).toBe(1);
	});

	it("被別的交易鎖住的工作會被跳過，而不是等待", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const locked = await insertJob(active, { runAfter: new Date(Date.now() - 40_000) });
		const free = await insertJob(active, { runAfter: new Date(Date.now() - 39_000) });
		const queue = new JobQueue(active.db, { lockedBy: "worker-skip" });

		const claimedIds: string[] = [];
		await active.sql.begin(async tx => {
			await tx`select id from worker_jobs where id = ${locked} for update`;
			/** 交易還開著；沒有 SKIP LOCKED 的話下面這段會卡住直到鎖等待逾時。 */
			for (;;) {
				const claimed = await queue.claim();
				if (!claimed) break;
				claimedIds.push(claimed.id);
			}
		});

		expect(claimedIds).toContain(free);
		expect(claimedIds).not.toContain(locked);
		expect((await jobRow(active, locked)).status).toBe("pending");
	});

	it("失敗會以指數退避重試，用完額度才變成 failed", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const jobId = await insertJob(active, { runAfter: new Date(Date.now() - 60_000), maxAttempts: 3 });
		const queue = new JobQueue(active.db, { lockedBy: "worker-retry", backoff: { baseMs: 100 } });

		const beforeFirst = await databaseNow(active);
		const firstOutcome = await queue.markFailure({ id: jobId, attempt: 1, maxAttempts: 3 }, FAILURE_MESSAGE);
		expect(firstOutcome.retryScheduled).toBe(true);
		const afterFirst = await jobRow(active, jobId);
		expect(afterFirst.status).toBe("pending");
		expect(afterFirst.lockedBy).toBeNull();
		const firstGap = afterFirst.runAfter.getTime() - beforeFirst.getTime();
		expect(firstGap).toBeGreaterThan(50);
		expect(firstGap).toBeLessThan(600);

		const beforeSecond = await databaseNow(active);
		await queue.markFailure({ id: jobId, attempt: 2, maxAttempts: 3 }, FAILURE_MESSAGE);
		const afterSecond = await jobRow(active, jobId);
		expect(afterSecond.status).toBe("pending");
		const secondGap = afterSecond.runAfter.getTime() - beforeSecond.getTime();
		/** 指數退避：第二次的等待時間必須比第一次長。 */
		expect(secondGap).toBeGreaterThan(firstGap);

		const finalOutcome = await queue.markFailure({ id: jobId, attempt: 3, maxAttempts: 3 }, FAILURE_MESSAGE);
		expect(finalOutcome.retryScheduled).toBe(false);

		const finished = await jobRow(active, jobId);
		expect(finished.status).toBe("failed");
		expect(finished.error).toBe(FAILURE_MESSAGE);
		expect(finished.error).not.toMatch(/\//);
	});

	it("重試排程過期後工作可以再次被取件", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		/** attempt 從 1 起算，代表這筆工作已經被取件並失敗過一次。 */
		const jobId = await insertJob(active, { runAfter: new Date(Date.now() + 60_000), maxAttempts: 3, attempt: 1 });
		const queue = new JobQueue(active.db, { lockedBy: "worker-delay", backoff: { baseMs: 100 } });

		/** run_after 還沒到，佇列不該把它交出來。 */
		const early = await active.db.execute<{ count: string }>(sql`select count(*) as count from worker_jobs where id = ${jobId} and run_after <= now()`);
		expect(early[0].count).toBe("0");

		await queue.markFailure({ id: jobId, attempt: 1, maxAttempts: 3 }, FAILURE_MESSAGE);
		await sleep(250);
		const claimed = await queue.claim();
		expect(claimed?.id).toBe(jobId);
		expect(claimed?.attempt).toBe(2);
	});

	it("卡在 running 的工作會被回收", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const retryable = await insertJob(active, { runAfter: new Date(Date.now() - 80_000), maxAttempts: 3 });
		const exhausted = await insertJob(active, { runAfter: new Date(Date.now() - 79_000), maxAttempts: 1 });
		const queue = new JobQueue(active.db, { lockedBy: "worker-dead", staleAfterMs: 60_000, backoff: { baseMs: 10 } });

		/** 模擬 Worker 被 SIGKILL：資料列停在 running，沒有人會再回來收尾。 */
		await active.db.execute(sql`
			update worker_jobs
			set status = 'running', attempt = 1, locked_by = 'worker-dead', started_at = now() - interval '1 hour'
			where id in (${retryable}, ${exhausted})
		`);

		const recovered = await queue.recoverStaleJobs();
		const byId = new Map(recovered.map(job => [job.id, job]));
		expect(byId.get(retryable)?.outcome).toBe("requeued");
		expect(byId.get(exhausted)?.outcome).toBe("failed");

		const requeued = await jobRow(active, retryable);
		expect(requeued.status).toBe("pending");
		expect(requeued.lockedBy).toBeNull();
		expect((await jobRow(active, exhausted)).status).toBe("failed");
	});
});
