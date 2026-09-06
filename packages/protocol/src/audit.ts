import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

/**
 * 稽核事件的完整清單。新增動作時一定要同時加進這裡，
 * 讓 Admin 的篩選器與文件不會和實際寫入的值脫節。
 */
export const AuditActionSchema = z.enum([
	"auth.login",
	"auth.login_failed",
	"auth.logout",
	"auth.totp_enabled",
	"auth.totp_disabled",
	"auth.password_changed",
	"auth.session_revoked",
	"user.created",
	"user.updated",
	"user.disabled",
	"user.password_reset",
	"device.paired",
	"device.unbound",
	"device.updated",
	"device.force_sync",
	"device.restart_player",
	"layout.created",
	"layout.updated",
	"layout.published",
	"layout.deleted",
	"schedule.created",
	"schedule.updated",
	"schedule.deleted",
	"media.uploaded",
	"media.updated",
	"media.deleted"
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogSchema = z.object({
	id: IdSchema,
	action: AuditActionSchema,
	actorUserId: IdSchema.nullable(),
	actorLabel: z.string().nullable(),
	actorDeviceId: IdSchema.nullable(),
	targetType: z.string().nullable(),
	targetId: z.string().nullable(),
	targetLabel: z.string().nullable(),
	ipAddress: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	createdAt: IsoDateTimeSchema
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditLogQuerySchema = z.object({
	action: AuditActionSchema.optional(),
	actorUserId: IdSchema.optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
