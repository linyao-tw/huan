import { totpCredentials, users, type Database } from "@huan/db";
import type { User } from "@huan/protocol";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

export type UserRow = typeof users.$inferSelect;

export function serializeUser(row: UserRow, totpEnabled: boolean): User {
	return {
		id: row.id,
		email: row.email,
		username: row.username,
		displayName: row.displayName,
		role: row.role,
		status: row.status,
		totpEnabled,
		lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

/** 一次查出多個使用者的 2FA 狀態，避免使用者列表對每一列各發一次查詢。 */
export async function totpEnabledMap(db: Database, userIds: readonly string[]): Promise<Map<string, boolean>> {
	const map = new Map<string, boolean>();
	if (userIds.length === 0) return map;
	const rows = await db
		.select({ userId: totpCredentials.userId })
		.from(totpCredentials)
		.where(and(isNotNull(totpCredentials.confirmedAt), inArray(totpCredentials.userId, [...userIds])));
	for (const row of rows) map.set(row.userId, true);
	return map;
}

export async function isTotpEnabled(db: Database, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ userId: totpCredentials.userId })
		.from(totpCredentials)
		.where(and(eq(totpCredentials.userId, userId), isNotNull(totpCredentials.confirmedAt)))
		.limit(1);
	return row !== undefined;
}

export async function findUserById(db: Database, id: string): Promise<UserRow | null> {
	const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return row ?? null;
}

/** 登入識別字可以是 Email 或帳號，兩者都是唯一鍵，因此一次查詢就能涵蓋。 */
export async function findUserByIdentifier(db: Database, identifier: string): Promise<UserRow | null> {
	const normalized = identifier.trim().toLowerCase();
	const [row] = await db
		.select()
		.from(users)
		.where(sql`${users.email} = ${normalized} or ${users.username} = ${normalized}`)
		.limit(1);
	return row ?? null;
}
