import { buildServer } from "@/app";
import { loadEnv, loadEnvFile } from "@/env";
import { registerBusinessMetrics } from "@/lib/metrics";
import { EnvValidationError } from "@huan/config";

async function main(): Promise<void> {
	loadEnvFile();

	let env;
	try {
		env = loadEnv();
	} catch (error) {
		if (error instanceof EnvValidationError) {
			console.error(error.message);
			process.exit(1);
		}
		throw error;
	}

	const app = await buildServer({ env });
	registerBusinessMetrics(app.ctx);

	/**
	 * 先停止接受新請求，再關閉連線池。
	 * 反過來的話正在處理中的請求會拿到一個已經關掉的連線，
	 * 使用者看到的不是「服務重啟中」而是一個莫名其妙的 500。
	 */
	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		app.log.info({ signal }, "收到終止訊號，開始關閉");
		try {
			await app.close();
			process.exit(0);
		} catch (error) {
			app.log.error({ err: error }, "關閉過程發生錯誤");
			process.exit(1);
		}
	};
	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));

	await app.listen({ host: env.HOST, port: env.PORT });
}

await main();
