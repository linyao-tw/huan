import type { AppContext } from "@/context";
import { isDeviceOnline } from "@/lib/devices";
import { devices, mediaAssets, workerJobs } from "@huan/db";
import { WorkerJobKindSchema, WorkerJobStatusSchema, type WorkerJobKind, type WorkerJobStatus } from "@huan/protocol";
import { metrics } from "@opentelemetry/api";
import { and, count, eq, lte, min, sql } from "drizzle-orm";

export interface DeviceSnapshotRow {
	id: string;
	name: string;
	status: "active" | "revoked";
	online: boolean;
	desiredVersion: number;
	reportedVersion: number | null;
	storageError: string | null;
	lastSeenAt: Date | null;
}

export interface DeviceSummary {
	byStatus: { online: number; offline: number; revoked: number };
	perDevice: { id: string; name: string; online: number; versionLag: number; storageError: number; lastSeenAgeSeconds: number | null }[];
}

/**
 * 把裝置清單整理成要送出的數字。
 *
 * 版本落差以「目標版本 - 回報版本」計算，還沒回報過的裝置算落後整個目標版本：
 * 一台從沒同步成功的裝置，比落後一版的更需要被看到。撤銷的裝置不列進逐台明細，
 * 它們不會再連線，放進去只會讓「離線」的面板永遠是紅的。
 */
export function summarizeDevices(rows: readonly DeviceSnapshotRow[], now: Date): DeviceSummary {
	const byStatus = { online: 0, offline: 0, revoked: 0 };
	const perDevice: DeviceSummary["perDevice"] = [];
	for (const row of rows) {
		if (row.status === "revoked") {
			byStatus.revoked += 1;
			continue;
		}
		if (row.online) byStatus.online += 1;
		else byStatus.offline += 1;
		perDevice.push({
			id: row.id,
			name: row.name,
			online: row.online ? 1 : 0,
			versionLag: Math.max(0, row.desiredVersion - (row.reportedVersion ?? 0)),
			storageError: row.storageError ? 1 : 0,
			lastSeenAgeSeconds: row.lastSeenAt ? Math.max(0, Math.round((now.getTime() - row.lastSeenAt.getTime()) / 1000)) : null
		});
	}
	return { byStatus, perDevice };
}

/**
 * 每種工作 × 每種狀態都給一個數字，沒有的補 0。
 *
 * 只回報查得到的組合的話，佇列清空時 pending 那條線是「沒有資料」而不是 0，
 * 圖上分不出是佇列空了還是指標斷了。
 */
export function countJobs(rows: { kind: WorkerJobKind; status: WorkerJobStatus; value: number }[]): { kind: WorkerJobKind; status: WorkerJobStatus; value: number }[] {
	const found = new Map(rows.map(row => [`${row.kind}:${row.status}`, row.value]));
	return WorkerJobKindSchema.options.flatMap(kind => WorkerJobStatusSchema.options.map(status => ({ kind, status, value: found.get(`${kind}:${status}`) ?? 0 })));
}

/**
 * HUAN 自己的業務指標：裝置、素材與轉檔佇列。
 *
 * 用 observable gauge 在每次匯出時現查資料庫，而不是在各個路由裡加減計數器：計數器
 * 只要有一條路徑忘了更新就永遠對不上，而這些數字的事實來源本來就是資料表。三個查詢
 * 都是整張小表的 group by，每 30 秒一次的成本可以忽略。
 *
 * 沒有啟用 OpenTelemetry 時拿到的是 no-op meter，callback 永遠不會被呼叫。
 */
export function registerBusinessMetrics(ctx: AppContext): void {
	const meter = metrics.getMeter("huan-server");

	const deviceCount = meter.createObservableGauge("huan.devices", { description: "裝置數量，依連線狀態分組", unit: "{device}" });
	const deviceOnline = meter.createObservableGauge("huan.device.online", { description: "每台裝置是否在線（1 在線、0 離線）" });
	const deviceLag = meter.createObservableGauge("huan.device.version_lag", { description: "每台裝置落後目標狀態幾個版本", unit: "{version}" });
	const deviceStorageError = meter.createObservableGauge("huan.device.storage_error", { description: "每台裝置是否回報儲存錯誤（1 有、0 沒有）" });
	const deviceLastSeen = meter.createObservableGauge("huan.device.last_seen_age", { description: "距離每台裝置最後一次回報過了多久", unit: "s" });
	const assetCount = meter.createObservableGauge("huan.media.assets", { description: "素材數量，依種類與狀態分組", unit: "{asset}" });
	const jobCount = meter.createObservableGauge("huan.worker.jobs", { description: "轉檔工作數量，依種類與狀態分組", unit: "{job}" });
	const oldestPending = meter.createObservableGauge("huan.worker.queue.oldest_pending_age", { description: "最久還沒被處理的工作已經等了多久；佇列卡住時它會一直長大", unit: "s" });

	meter.addBatchObservableCallback(
		async result => {
			const { db, env, hub } = ctx;
			const now = new Date();

			const deviceRows = await db
				.select({
					id: devices.id,
					name: devices.name,
					status: devices.status,
					lastSeenAt: devices.lastSeenAt,
					desiredVersion: devices.desiredVersion,
					reportedVersion: sql<number | null>`(${devices.reportedState}->>'desiredVersion')::int`,
					storageError: sql<string | null>`${devices.reportedState}->>'storageError'`
				})
				.from(devices);
			const summary = summarizeDevices(
				deviceRows.map(row => ({ ...row, online: isDeviceOnline(hub, row, env.DEVICE_HEARTBEAT_SECONDS) })),
				now
			);
			for (const [status, value] of Object.entries(summary.byStatus)) result.observe(deviceCount, value, { status });
			for (const device of summary.perDevice) {
				const attributes = { "device.id": device.id, "device.name": device.name };
				result.observe(deviceOnline, device.online, attributes);
				result.observe(deviceLag, device.versionLag, attributes);
				result.observe(deviceStorageError, device.storageError, attributes);
				if (device.lastSeenAgeSeconds !== null) result.observe(deviceLastSeen, device.lastSeenAgeSeconds, attributes);
			}

			const assetRows = await db.select({ kind: mediaAssets.kind, status: mediaAssets.status, value: count() }).from(mediaAssets).groupBy(mediaAssets.kind, mediaAssets.status);
			for (const row of assetRows) result.observe(assetCount, Number(row.value), { kind: row.kind, status: row.status });

			const jobRows = await db.select({ kind: workerJobs.kind, status: workerJobs.status, value: count() }).from(workerJobs).groupBy(workerJobs.kind, workerJobs.status);
			for (const row of countJobs(jobRows.map(row => ({ ...row, value: Number(row.value) })))) result.observe(jobCount, row.value, { kind: row.kind, status: row.status });

			/** 只看已經到了執行時間的工作：排在退避期的重試本來就該等，不算卡住。 */
			const [oldest] = await db
				.select({ value: min(workerJobs.runAfter) })
				.from(workerJobs)
				.where(and(eq(workerJobs.status, "pending"), lte(workerJobs.runAfter, now)));
			result.observe(oldestPending, oldest?.value ? Math.max(0, Math.round((now.getTime() - oldest.value.getTime()) / 1000)) : 0);
		},
		[deviceCount, deviceOnline, deviceLag, deviceStorageError, deviceLastSeen, assetCount, jobCount, oldestPending]
	);
}
