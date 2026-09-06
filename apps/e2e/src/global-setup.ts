import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 端對端測試自己補上種子資料。
 *
 * Server 的整合測試會清空資料表，因此「先跑 pnpm test 再跑 pnpm test:e2e」
 * 會讓這裡什麼都找不到。與其在文件裡寫一句「記得先 seed」，不如讓這一步
 * 自己完成 —— 種子是冪等的，重複執行不會累積資料。
 */
async function run(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, [...args], { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
		child.once("error", reject);
		child.once("close", code => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} 以代碼 ${code} 結束`))));
	});
}

export default async function globalSetup(): Promise<void> {
	if (process.env.HUAN_E2E_SKIP_SEED === "true") return;
	await run("pnpm", ["--filter", "@huan/server", "exec", "tsx", "src/cli/seed.ts"]);
}
