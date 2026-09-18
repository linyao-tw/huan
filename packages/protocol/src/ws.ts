import { z } from "zod";
import { IsoDateTimeSchema } from "./common.js";
import { DeviceCommandKindSchema, ReportedStateSchema } from "./device.js";

/**
 * WebSocket 只負責「有東西變了」與少數即時指令，不傳輸任何素材。
 * 真正的狀態一律回到 REST API 取得，REST 才是唯一的事實來源。
 */
export const ServerToDeviceMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		serverTime: IsoDateTimeSchema,
		protocolVersion: z.number().int(),
		desiredVersion: z.number().int().min(0)
	}),
	z.object({
		type: z.literal("desired_state_changed"),
		version: z.number().int().min(0)
	}),
	z.object({
		type: z.literal("command"),
		commandId: z.string(),
		command: DeviceCommandKindSchema
	}),
	z.object({ type: z.literal("pong"), serverTime: IsoDateTimeSchema })
]);
export type ServerToDeviceMessage = z.infer<typeof ServerToDeviceMessageSchema>;

export const DeviceToServerMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ping") }),
	z.object({
		type: z.literal("heartbeat"),
		reported: ReportedStateSchema
	}),
	z.object({
		type: z.literal("command_result"),
		commandId: z.string(),
		ok: z.boolean(),
		message: z.string().max(500).optional()
	})
]);
export type DeviceToServerMessage = z.infer<typeof DeviceToServerMessageSchema>;

/** Admin 後台的即時推播。裝置上下線與同步進度不需要重新整理頁面。 */
export const AdminEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("hello"), serverTime: IsoDateTimeSchema }),
	z.object({ type: z.literal("device_changed"), deviceId: z.string() }),
	/** `assetId` 為 null 代表變的是素材庫的結構（資料夾），不是某一筆素材。 */
	z.object({ type: z.literal("media_changed"), assetId: z.string().nullable() }),
	z.object({ type: z.literal("pong"), serverTime: IsoDateTimeSchema })
]);
export type AdminEvent = z.infer<typeof AdminEventSchema>;
