import type { AppContext } from "@/context";
import { ownedBy } from "@/lib/auth";
import type { DeviceRow } from "@/lib/device-auth";
import type { SocketHub } from "@/ws/hub";
import { devices, layouts, type Database } from "@huan/db";
import type { Device } from "@huan/protocol";
import { eq } from "drizzle-orm";

/**
 * 「上線」的判定。
 *
 * WebSocket 連著當然算上線，但 Server 重啟或 Device 走在只有 REST 的降級路徑時
 * 也不該被標成離線，所以再看最近一次 heartbeat：兩個心跳週期內有回報就算還活著。
 */
export function isDeviceOnline(hub: SocketHub, device: Pick<DeviceRow, "id" | "lastSeenAt">, heartbeatSeconds: number): boolean {
	if (hub.isDeviceOnline(device.id)) return true;
	if (!device.lastSeenAt) return false;
	return Date.now() - device.lastSeenAt.getTime() <= heartbeatSeconds * 2 * 1000;
}

export function serializeDevice(ctx: AppContext, row: DeviceRow, defaultLayoutName: string | null): Device {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		online: isDeviceOnline(ctx.hub, row, ctx.env.DEVICE_HEARTBEAT_SECONDS),
		defaultLayoutId: row.defaultLayoutId,
		defaultLayoutName,
		desiredVersion: row.desiredVersion,
		reported: row.reportedState ?? null,
		lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
		pairedAt: row.pairedAt?.toISOString() ?? null,
		pairedBy: row.pairedBy,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

/** 一律連同擁有者一起查。少了 `ownerId`，`:id` 就等於「輸入任何一台裝置的 id 都拿得到」。 */
export async function loadDeviceWithLayout(db: Database, deviceId: string, ownerId: string): Promise<{ device: DeviceRow; layoutName: string | null } | null> {
	const [row] = await db
		.select({ device: devices, layoutName: layouts.name })
		.from(devices)
		.leftJoin(layouts, eq(layouts.id, devices.defaultLayoutId))
		.where(ownedBy(devices, deviceId, ownerId))
		.limit(1);
	if (!row) return null;
	return { device: row.device, layoutName: row.layoutName ?? null };
}
