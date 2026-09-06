import { authChallenges, type Database } from "@huan/db";
import { generateOpaqueToken, hashToken } from "@huan/shared/node";
import { and, eq, gt, isNull } from "drizzle-orm";

/**
 * 通過密碼但還沒完成 2FA 的中繼憑證有效期。
 *
 * 五分鐘足夠打開驗證器抄下六位數，又短到即使 token 外流也幾乎沒有利用空間。
 */
export const CHALLENGE_TTL_SECONDS = 300;

export interface IssuedChallenge {
	token: string;
	expiresAt: Date;
}

export async function createAuthChallenge(db: Database, userId: string, origin: { ipAddress: string | null; userAgent: string | null }): Promise<IssuedChallenge> {
	const token = generateOpaqueToken(32);
	const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
	await db.insert(authChallenges).values({
		userId,
		tokenHash: hashToken(token),
		expiresAt,
		ipAddress: origin.ipAddress,
		userAgent: origin.userAgent
	});
	return { token, expiresAt };
}

export type AuthChallengeRow = typeof authChallenges.$inferSelect;

export async function findUsableChallenge(db: Database, token: string): Promise<AuthChallengeRow | null> {
	const [row] = await db
		.select()
		.from(authChallenges)
		.where(and(eq(authChallenges.tokenHash, hashToken(token)), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, new Date())))
		.limit(1);
	return row ?? null;
}

/**
 * 標記 challenge 已使用，並回報這次是不是「第一個」用掉它的請求。
 *
 * 以條件更新而不是先讀再寫來達成單次使用，兩個同時到達的請求只會有一個
 * 拿到資料列，另一個看到 0 筆更新就知道自己輸了。
 */
export async function consumeChallenge(db: Database, challengeId: string): Promise<boolean> {
	const updated = await db
		.update(authChallenges)
		.set({ consumedAt: new Date() })
		.where(and(eq(authChallenges.id, challengeId), isNull(authChallenges.consumedAt)))
		.returning({ id: authChallenges.id });
	return updated.length > 0;
}
