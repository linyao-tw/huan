import { loadEnv, loadEnvFile } from "@/env";
import { hashPassword } from "@/lib/password";
import { createDatabase, users } from "@huan/db";
import { EmailSchema, PasswordSchema, UsernameSchema } from "@huan/protocol";
import { eq, or } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

/**
 * 建立第一個最高管理員。
 *
 * 兩種用法：互動式（現場輸入，密碼不回顯）與非互動式（`--email` 等旗標搭配
 * `HUAN_ADMIN_PASSWORD` 環境變數，給 Docker 的初始化腳本用）。
 * 兩條路徑都不接受弱密碼，也永遠沒有預設密碼——出廠帳密是資安事故的標準開頭。
 */

function fail(message: string): never {
	console.error(`✗ ${message}`);
	process.exit(1);
}

/** 不回顯的密碼輸入。直接處理 raw mode，而不是去改 readline 的內部方法。 */
function readHiddenLine(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		if (!stdin.isTTY) {
			reject(new Error("目前的終端機不支援隱藏輸入，請改用 HUAN_ADMIN_PASSWORD 環境變數"));
			return;
		}

		process.stdout.write(prompt);
		const wasRaw = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		let value = "";
		const cleanup = (): void => {
			stdin.off("data", onData);
			stdin.setRawMode(wasRaw);
			stdin.pause();
		};
		const onData = (chunk: string): void => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n" || char === "\u0004") {
					cleanup();
					process.stdout.write("\n");
					resolve(value);
					return;
				}
				if (char === "\u0003") {
					cleanup();
					process.stdout.write("\n");
					reject(new Error("已取消"));
					return;
				}
				if (char === "\u007f" || char === "\b") {
					value = value.slice(0, -1);
					continue;
				}
				value += char;
			}
		};
		stdin.on("data", onData);
	});
}

const { values } = parseArgs({
	options: {
		email: { type: "string" },
		username: { type: "string" },
		"display-name": { type: "string" }
	},
	strict: true
});

loadEnvFile();
const env = loadEnv();

const nonInteractive = Boolean(values.email || values.username || values["display-name"] || process.env.HUAN_ADMIN_PASSWORD);

let email: string;
let username: string;
let displayName: string;
let password: string;

if (nonInteractive) {
	if (!values.email || !values.username) fail("非互動模式需要同時提供 --email 與 --username");
	const envPassword = process.env.HUAN_ADMIN_PASSWORD;
	if (!envPassword) fail("非互動模式需要以 HUAN_ADMIN_PASSWORD 環境變數提供密碼");
	email = values.email;
	username = values.username;
	displayName = values["display-name"] ?? values.username;
	password = envPassword;
} else {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		email = (await rl.question("Email：")).trim();
		username = (await rl.question("帳號：")).trim();
		displayName = (await rl.question("顯示名稱：")).trim();
	} finally {
		rl.close();
	}
	password = await readHiddenLine("密碼（不會顯示）：");
	const confirmation = await readHiddenLine("再次輸入密碼：");
	if (password !== confirmation) fail("兩次輸入的密碼不一致");
}

const emailResult = EmailSchema.safeParse(email);
if (!emailResult.success) fail(`Email 不合法：${emailResult.error.issues.map(issue => issue.message).join("、")}`);

const usernameResult = UsernameSchema.safeParse(username);
if (!usernameResult.success) fail(`帳號不合法：${usernameResult.error.issues.map(issue => issue.message).join("、")}`);

if (displayName.length === 0 || displayName.length > 64) fail("顯示名稱必須是 1 到 64 個字元");

const passwordResult = PasswordSchema.safeParse(password);
if (!passwordResult.success) fail(`密碼不符合要求：${passwordResult.error.issues.map(issue => issue.message).join("、")}`);

const handle = createDatabase({ url: env.DATABASE_URL, max: 1 });
try {
	const [existing] = await handle.db
		.select({ id: users.id, email: users.email, username: users.username })
		.from(users)
		.where(or(eq(users.email, emailResult.data), eq(users.username, usernameResult.data)))
		.limit(1);
	if (existing) fail(`已經有使用者使用這個 Email 或帳號（${existing.email} / ${existing.username}）`);

	const [created] = await handle.db
		.insert(users)
		.values({
			email: emailResult.data,
			username: usernameResult.data,
			displayName,
			role: "super_admin",
			status: "active",
			passwordHash: await hashPassword(passwordResult.data)
		})
		.returning({ id: users.id, username: users.username });
	if (!created) fail("建立使用者失敗");

	console.log(`✓ 已建立最高管理員 ${created.username}`);
	console.log("");
	console.log("接下來：");
	console.log(`  1. 啟動 Server：pnpm dev:server`);
	console.log(`  2. 打開 Admin：${env.PUBLIC_URL}`);
	console.log(`  3. 以剛才的 Email 或帳號登入，並在「安全設定」啟用兩階段驗證。`);
} finally {
	await handle.close();
}
