import type { ServerEnv } from "@huan/config";
import { loginAttempts, type Database } from "@huan/db";
import { and, count, eq, gte } from "drizzle-orm";

export interface LoginAttemptContext {
	identifier: string;
	ipAddress: string | null;
}

export function normalizeIdentifier(identifier: string): string {
	return identifier.trim().toLowerCase().slice(0, 254);
}

export async function recordLoginAttempt(db: Database, context: LoginAttemptContext, successful: boolean): Promise<void> {
	await db.insert(loginAttempts).values({
		identifier: normalizeIdentifier(context.identifier),
		ipAddress: context.ipAddress,
		successful
	});
}

/**
 * 判斷這次登入是否應該被擋下。
 *
 * 帳號與來源 IP 分開計數，兩者任一超過門檻就擋：只看帳號擋不住有人拿同一個
 * IP 掃過整份使用者名單，只看 IP 又會讓辦公室共用出口的同事互相拖累。
 * 紀錄寫在資料庫而不是記憶體，Server 重啟不會把攻擊者的計數歸零。
 */
export async function isLoginThrottled(db: Database, env: ServerEnv, context: LoginAttemptContext): Promise<boolean> {
	const since = new Date(Date.now() - env.LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000);
	const identifier = normalizeIdentifier(context.identifier);

	const [byIdentifier] = await db
		.select({ value: count() })
		.from(loginAttempts)
		.where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.successful, false), gte(loginAttempts.createdAt, since)));
	if (Number(byIdentifier?.value ?? 0) >= env.LOGIN_RATE_LIMIT_MAX) return true;

	if (context.ipAddress) {
		const [byIp] = await db
			.select({ value: count() })
			.from(loginAttempts)
			.where(and(eq(loginAttempts.ipAddress, context.ipAddress), eq(loginAttempts.successful, false), gte(loginAttempts.createdAt, since)));
		if (Number(byIp?.value ?? 0) >= env.LOGIN_RATE_LIMIT_MAX) return true;
	}

	return false;
}

/**
 * 登入成功後清掉「這個識別字」的失敗紀錄，讓使用者不會因為稍早打錯幾次而被自己鎖住。
 *
 * 刻意不一併清掉 IP 的計數：否則手上有一組有效帳密的攻擊者只要每隔幾次就登入
 * 自己的帳號，就能把整個 IP 的節流歸零，繼續對別人的帳號猜密碼。
 */
export async function clearFailedAttempts(db: Database, context: LoginAttemptContext): Promise<void> {
	const identifier = normalizeIdentifier(context.identifier);
	await db.delete(loginAttempts).where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.successful, false)));
}
