import { auditLogs, type Database } from "@huan/db";
import type { AuditAction, AuditLog } from "@huan/protocol";

export interface AuditEntry {
	action: AuditAction;
	actorUserId?: string | null;
	actorLabel?: string | null;
	actorDeviceId?: string | null;
	targetType?: string | null;
	targetId?: string | null;
	targetLabel?: string | null;
	ipAddress?: string | null;
	/**
	 * 只放「解釋這次操作」需要的欄位。
	 * 密碼、TOTP 密鑰、復原碼、session token、裝置憑證與簽章網址一律不得出現在這裡。
	 */
	metadata?: Record<string, unknown> | null;
}

export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
	await db.insert(auditLogs).values({
		action: entry.action,
		actorUserId: entry.actorUserId ?? null,
		actorLabel: entry.actorLabel ?? null,
		actorDeviceId: entry.actorDeviceId ?? null,
		targetType: entry.targetType ?? null,
		targetId: entry.targetId ?? null,
		targetLabel: entry.targetLabel ?? null,
		ipAddress: entry.ipAddress ?? null,
		metadata: entry.metadata ?? null
	});
}

export function serializeAuditLog(row: typeof auditLogs.$inferSelect): AuditLog {
	return {
		id: row.id,
		action: row.action,
		actorUserId: row.actorUserId,
		actorLabel: row.actorLabel,
		actorDeviceId: row.actorDeviceId,
		targetType: row.targetType,
		targetId: row.targetId,
		targetLabel: row.targetLabel,
		ipAddress: row.ipAddress,
		metadata: row.metadata ?? null,
		createdAt: row.createdAt.toISOString()
	};
}
