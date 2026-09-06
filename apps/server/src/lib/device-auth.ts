import { deviceCredentials, devices, type Database } from "@huan/db";
import { hashToken } from "@huan/shared/node";
import { and, eq, isNull } from "drizzle-orm";

export type DeviceRow = typeof devices.$inferSelect;

export interface DeviceActor {
	device: DeviceRow;
	credentialId: string;
}

/** `Authorization: Bearer <deviceId>.<secret>`；WebSocket 帶不了 header 時走 `?token=`。 */
export function parseDeviceToken(token: string): { deviceId: string; secret: string } | null {
	const separator = token.indexOf(".");
	if (separator <= 0) return null;
	const deviceId = token.slice(0, separator);
	const secret = token.slice(separator + 1);
	if (deviceId.length === 0 || secret.length === 0) return null;
	return { deviceId, secret };
}

export function extractBearerToken(header: string | string[] | undefined): string | null {
	const value = Array.isArray(header) ? header[0] : header;
	if (!value) return null;
	const match = /^Bearer\s+(.+)$/i.exec(value.trim());
	return match?.[1] ?? null;
}

/**
 * 以裝置憑證換回裝置。
 *
 * 查詢的鍵是 secret 的 SHA-256，不是 `deviceId`：資料庫裡沒有明文憑證，
 * 而 `deviceId` 只用來確認這組 secret 真的屬於它自稱的那台裝置。
 */
export async function authenticateDeviceToken(db: Database, token: string): Promise<DeviceActor | null> {
	const parsed = parseDeviceToken(token);
	if (!parsed) return null;

	const [row] = await db
		.select({ credential: deviceCredentials, device: devices })
		.from(deviceCredentials)
		.innerJoin(devices, eq(devices.id, deviceCredentials.deviceId))
		.where(and(eq(deviceCredentials.secretHash, hashToken(parsed.secret)), isNull(deviceCredentials.revokedAt)))
		.limit(1);
	if (!row) return null;
	if (row.credential.deviceId !== parsed.deviceId) return null;
	if (row.device.status !== "active") return null;

	const now = new Date();
	await db.update(deviceCredentials).set({ lastUsedAt: now }).where(eq(deviceCredentials.id, row.credential.id));
	await db.update(devices).set({ lastSeenAt: now, updatedAt: now }).where(eq(devices.id, row.device.id));

	return { device: { ...row.device, lastSeenAt: now }, credentialId: row.credential.id };
}
