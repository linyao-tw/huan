import { hash, verify, type Options } from "@node-rs/argon2";

/**
 * `Algorithm.Argon2id` 的值。
 *
 * `@node-rs/argon2` 把 `Algorithm` 宣告成 ambient const enum，在
 * `verbatimModuleSyntax` 底下不能直接引用列舉成員，因此以數值表達並用
 * 套件自己的型別鎖住——填錯數字會在編譯期就被擋下來。
 */
const ARGON2ID: NonNullable<Options["algorithm"]> = 2;

/**
 * OWASP 對 Argon2id 的建議組合之一（19 MiB、2 次迭代、單執行緒）。
 *
 * 參數會寫進 PHC 字串裡，因此日後調高成本不需要遷移既有雜湊，
 * 舊密碼仍然驗得過，只是成本維持在當初的設定。
 */
const OPTIONS: Options = {
	algorithm: ARGON2ID,
	memoryCost: 19_456,
	timeCost: 2,
	parallelism: 1
};

export function hashPassword(plain: string): Promise<string> {
	return hash(plain, OPTIONS);
}

/**
 * 給「帳號不存在」分支用的假雜湊，只算一次。
 *
 * 登入時若帳號存在就跑 Argon2id、不存在就直接回 false，兩條路徑的耗時差了一個
 * 雜湊（數十毫秒對次毫秒），一次計時就能判斷某個 Email 是否註冊。讓不存在的分支
 * 也對這把固定雜湊驗一次，把時間拉平。字串內容不重要，反正永遠不會相符。
 */
let dummyHashPromise: Promise<string> | null = null;

export async function verifyPasswordDummy(plain: string): Promise<false> {
	dummyHashPromise ??= hashPassword("this-is-never-a-real-password");
	await verifyPassword(await dummyHashPromise, plain);
	return false;
}

/** 雜湊字串損毀時回傳 `false` 而不是拋出，避免一列壞資料讓整個登入端點回 500。 */
export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
	try {
		return await verify(passwordHash, plain, OPTIONS);
	} catch {
		return false;
	}
}
