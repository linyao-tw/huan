import { describeError } from "@/errors";
import { createLogger } from "@/logger";
import { JobQueue } from "@/queue";
import { WorkerRunner } from "@/runner";
import { ObjectStorage } from "@/storage";
import { loadWorkerEnv } from "@huan/config";
import { createDatabase } from "@huan/db";

async function main(): Promise<void> {
	const env = loadWorkerEnv();
	const logger = createLogger(env.LOG_LEVEL);

	/** 連線池要比併發數多一點：取件的交易與工作本身的查詢會同時佔用連線。 */
	const { db, close } = createDatabase({ url: env.DATABASE_URL, max: env.WORKER_CONCURRENCY + 2 });
	const storage = new ObjectStorage(env);
	const queue = new JobQueue(db);
	const runner = new WorkerRunner({ db, storage, queue, env, logger });

	let forced = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (forced) {
			logger.fatal({ signal }, "再次收到終止訊號，立即結束");
			process.exit(1);
		}
		forced = true;
		logger.info({ signal, inFlight: runner.inFlightCount }, "收到終止訊號，等待進行中的工作結束");
		runner.requestStop();
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("unhandledRejection", reason => {
		logger.error({ err: describeError(reason) }, "未處理的 promise rejection");
	});

	try {
		await runner.start();
	} finally {
		storage.destroy();
		await close();
		logger.info("已關閉資料庫連線池");
	}
}

await main();
