import type { AppContext } from "@/context";
import { distributionVariant, extensionForContentType, type MediaVariantRow } from "@/lib/media";
import type { ServerEnv } from "@huan/config";
import { devices, layoutRevisions, layouts, mediaAssets, mediaDeviceSync, mediaVariants, scheduleDevices, schedules, type Database } from "@huan/db";
import { collectAssetIds } from "@huan/layout-engine";
import { PROTOCOL_VERSION, type AssetManifestEntry, type DesiredState, type LayoutBundle, type ScheduleManifestEntry } from "@huan/protocol";
import { and, eq, inArray, notInArray } from "drizzle-orm";

/** desired state 中會影響「Device 該做什麼」的部分。`version` 與 `issuedAt` 刻意排除在外。 */
type DesiredStateCore = Omit<DesiredState, "version" | "issuedAt">;

export interface BumpResult {
	version: number;
	changed: boolean;
	notified: number;
}

function settingsFrom(env: ServerEnv): DesiredState["settings"] {
	return {
		heartbeatIntervalSeconds: env.DEVICE_HEARTBEAT_SECONDS,
		fallbackSyncIntervalSeconds: env.DEVICE_FALLBACK_SYNC_SECONDS,
		maxConcurrentDownloads: env.DEVICE_MAX_CONCURRENT_DOWNLOADS
	};
}

/**
 * 組出某台裝置的完整目標狀態。
 *
 * 只有「發布過」的版面修訂會進來：草稿永遠不會離開 Admin，所以草稿引用的素材
 * 也不會被派送出去。這是刻意的，編輯到一半的畫面不應該出現在店裡的螢幕上。
 *
 * 每一個查詢都以裝置擁有者為條件，是最後一道防線：派送是真的會讓別人的影片
 * 出現在現場螢幕上的那一步，不能只靠上游的路由每次都記得檢查。
 */
export async function buildDesiredState(ctx: AppContext, deviceId: string): Promise<DesiredStateCore | null> {
	const { db, env } = ctx;
	const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
	if (!device) return null;
	const ownerId = device.ownerId;

	const bundleByRevisionId = new Map<string, LayoutBundle>();

	const loadBundle = async (layoutId: string): Promise<LayoutBundle | null> => {
		const [row] = await db
			.select({ layout: layouts, revision: layoutRevisions })
			.from(layouts)
			.innerJoin(layoutRevisions, eq(layoutRevisions.id, layouts.publishedRevisionId))
			.where(and(eq(layouts.id, layoutId), eq(layouts.ownerId, ownerId)))
			.limit(1);
		if (!row) return null;
		const bundle: LayoutBundle = {
			layoutId: row.layout.id,
			revisionId: row.revision.id,
			revisionNumber: row.revision.revisionNumber,
			name: row.layout.name,
			document: row.revision.document
		};
		bundleByRevisionId.set(bundle.revisionId, bundle);
		return bundle;
	};

	const defaultLayout = device.defaultLayoutId ? await loadBundle(device.defaultLayoutId) : null;

	const scheduleRows = await db
		.select({ schedule: schedules })
		.from(scheduleDevices)
		.innerJoin(schedules, eq(schedules.id, scheduleDevices.scheduleId))
		.where(and(eq(scheduleDevices.deviceId, deviceId), eq(schedules.enabled, true), eq(schedules.ownerId, ownerId)));

	const scheduleEntries: ScheduleManifestEntry[] = [];
	for (const { schedule } of scheduleRows) {
		const bundle = await loadBundle(schedule.layoutId);
		/** 還沒發布過的版面沒有修訂可以指向，這筆排程對 Device 來說等於不存在。 */
		if (!bundle) continue;
		scheduleEntries.push({
			id: schedule.id,
			name: schedule.name,
			priority: schedule.priority,
			timezone: schedule.timezone,
			startDate: schedule.startDate,
			endDate: schedule.endDate,
			daysOfWeek: [...schedule.daysOfWeek].sort((a, b) => a - b),
			startTime: schedule.startTime,
			endTime: schedule.endTime,
			layoutRevisionId: bundle.revisionId,
			updatedAt: schedule.updatedAt.toISOString()
		});
	}

	const bundles = [...bundleByRevisionId.values()].sort((a, b) => (a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : 0));

	const requiredAssetIds = new Set<string>();
	for (const bundle of bundles) {
		for (const assetId of collectAssetIds(bundle.document)) requiredAssetIds.add(assetId);
	}
	/** 待命圖片不在任何版面裡，但它也得先下載下來，否則斷網時待命畫面就是一片黑。 */
	if (device.idleMode === "image" && device.idleImageAssetId) requiredAssetIds.add(device.idleImageAssetId);

	const assets = requiredAssetIds.size > 0 ? await buildAssetManifest(db, [...requiredAssetIds], ownerId) : [];

	return {
		deviceId: device.id,
		protocolVersion: PROTOCOL_VERSION,
		deviceName: device.name,
		defaultLayout,
		idle: { mode: device.idleMode, imageAssetId: device.idleMode === "image" ? device.idleImageAssetId : null },
		layouts: bundles,
		schedules: scheduleEntries.sort((a, b) => (a.id < b.id ? -1 : 1)),
		assets,
		settings: settingsFrom(env)
	};
}

/**
 * 把素材轉成可下載的檔案清單。
 *
 * 沒有可用產物（還在轉檔、轉檔失敗、或產物已經被回收）的素材會被略過：
 * `AssetManifestEntry` 需要 sha256 與物件才有意義，硬塞一筆假的只會讓 Device
 * 反覆下載一個不存在的檔案。素材本身的狀態由 Admin 呈現，不靠 desired state 傳達。
 *
 * 不屬於這位擁有者的素材同樣會被略過。版面文件是 JSONB，引用哪個素材沒有外鍵管得住，
 * 所以這裡必須自己確認一次。
 */
async function buildAssetManifest(db: Database, assetIds: readonly string[], ownerId: string): Promise<AssetManifestEntry[]> {
	const assetRows = await db
		.select()
		.from(mediaAssets)
		.where(and(inArray(mediaAssets.id, [...assetIds]), eq(mediaAssets.ownerId, ownerId)));
	if (assetRows.length === 0) return [];

	const variantRows = await db
		.select()
		.from(mediaVariants)
		.where(
			inArray(
				mediaVariants.assetId,
				assetRows.map(row => row.id)
			)
		);
	const variantsByAsset = new Map<string, MediaVariantRow[]>();
	for (const variant of variantRows) {
		const list = variantsByAsset.get(variant.assetId);
		if (list) list.push(variant);
		else variantsByAsset.set(variant.assetId, [variant]);
	}

	const entries: AssetManifestEntry[] = [];
	for (const asset of assetRows) {
		const variant = distributionVariant(asset.kind, variantsByAsset.get(asset.id) ?? []);
		if (!variant || !variant.available || !variant.sha256) continue;
		entries.push({
			assetId: asset.id,
			variantId: variant.id,
			kind: asset.kind,
			contentType: variant.contentType,
			filename: `${variant.id}${extensionForContentType(variant.contentType)}`,
			sha256: variant.sha256,
			sizeBytes: variant.sizeBytes,
			downloadPath: downloadPathFor(variant.id)
		});
	}
	return entries.sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
}

/** Device 拿這個路徑（相對於 API 前綴）換短時效簽章網址。簽章網址本身不進 desired state。 */
export function downloadPathFor(variantId: string): string {
	return `/device/assets/${variantId}/url`;
}

function coreOf(state: DesiredState): DesiredStateCore {
	const { version: _version, issuedAt: _issuedAt, ...core } = state;
	return core;
}

/**
 * 與鍵順序無關的 JSON 序列化。
 *
 * 存回 PostgreSQL 的 `jsonb` 會重新排列物件的鍵，直接 `JSON.stringify` 比對
 * 會讓「從資料庫讀回來的舊狀態」和「剛算出來的新狀態」永遠不相等，
 * 結果就是每次呼叫都 +1，`desiredVersion` 完全失去意義。
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/** 只比較「意圖」本身。`issuedAt` 每次都不同，拿它比對會讓每次呼叫都判定為有變更。 */
function fingerprint(core: DesiredStateCore): string {
	return stableStringify(core);
}

/**
 * 重算目標狀態，只有真的變了才 +1。
 *
 * `desiredVersion` 是 Device 判斷「我是不是落後了」的唯一依據。如果每次呼叫都
 * 遞增，一次無關的設定儲存就會讓整個賣場的螢幕同時重新拉狀態。
 *
 * `force` 用在使用者按下「強制同步」：狀態沒變也要通知，因為使用者想解決的
 * 通常正是「Device 以為自己是最新的但畫面不對」。
 */
export async function bumpDeviceDesiredState(ctx: AppContext, deviceId: string, options: { force?: boolean } = {}): Promise<BumpResult> {
	const { db, hub } = ctx;
	const core = await buildDesiredState(ctx, deviceId);
	if (!core) return { version: 0, changed: false, notified: 0 };

	const [device] = await db.select({ ownerId: devices.ownerId, desiredVersion: devices.desiredVersion, desiredState: devices.desiredState }).from(devices).where(eq(devices.id, deviceId)).limit(1);
	if (!device) return { version: 0, changed: false, notified: 0 };

	const previous = device.desiredState ? fingerprint(coreOf(device.desiredState)) : null;
	const changed = previous !== fingerprint(core);
	const version = changed ? device.desiredVersion + 1 : device.desiredVersion;

	if (changed) {
		const state: DesiredState = { ...core, version, issuedAt: new Date().toISOString() };
		await db.update(devices).set({ desiredState: state, desiredVersion: version, updatedAt: new Date() }).where(eq(devices.id, deviceId));
	}

	await syncDeviceAssetRows(db, deviceId, core.assets, version);

	const notified = changed || options.force ? hub.notifyDesiredStateChanged(deviceId, version) : 0;
	if (changed) hub.broadcastAdmin(device.ownerId, { type: "device_changed", deviceId });

	return { version, changed, notified };
}

/**
 * 讓 `media_device_sync` 跟著目標狀態走。
 *
 * 新需要的產物補一列 `pending`；不再需要的直接刪掉，否則 Worker 的回收判斷會
 * 永遠等一台已經不需要這個檔案的裝置回報。已經 `ready` 的列不動，重算目標狀態
 * 不應該讓 Device 重新下載一份它早就驗證過的檔案。
 */
async function syncDeviceAssetRows(db: Database, deviceId: string, assets: readonly AssetManifestEntry[], version: number): Promise<void> {
	const requiredVariantIds = assets.map(asset => asset.variantId);

	if (requiredVariantIds.length === 0) {
		await db.delete(mediaDeviceSync).where(eq(mediaDeviceSync.deviceId, deviceId));
		return;
	}

	await db.delete(mediaDeviceSync).where(and(eq(mediaDeviceSync.deviceId, deviceId), notInArray(mediaDeviceSync.variantId, requiredVariantIds)));

	await db
		.insert(mediaDeviceSync)
		.values(assets.map(asset => ({ deviceId, variantId: asset.variantId, assetId: asset.assetId, status: "pending" as const, desiredVersion: version })))
		.onConflictDoNothing({ target: [mediaDeviceSync.deviceId, mediaDeviceSync.variantId] });
}

/** 一個版面被發布時，哪些裝置會受影響：把它當預設版面的，以及被排程指到的。 */
export async function deviceIdsAffectedByLayout(db: Database, layoutId: string, ownerId: string): Promise<string[]> {
	const byDefault = await db
		.select({ id: devices.id })
		.from(devices)
		.where(and(eq(devices.defaultLayoutId, layoutId), eq(devices.ownerId, ownerId)));
	const bySchedule = await db
		.select({ id: scheduleDevices.deviceId })
		.from(scheduleDevices)
		.innerJoin(schedules, eq(schedules.id, scheduleDevices.scheduleId))
		.where(and(eq(schedules.layoutId, layoutId), eq(schedules.ownerId, ownerId)));
	return [...new Set([...byDefault.map(row => row.id), ...bySchedule.map(row => row.id)])];
}

export async function deviceIdsOfSchedule(db: Database, scheduleId: string): Promise<string[]> {
	const rows = await db.select({ id: scheduleDevices.deviceId }).from(scheduleDevices).where(eq(scheduleDevices.scheduleId, scheduleId));
	return rows.map(row => row.id);
}

export async function bumpDevices(ctx: AppContext, deviceIds: readonly string[]): Promise<void> {
	for (const deviceId of new Set(deviceIds)) {
		await bumpDeviceDesiredState(ctx, deviceId);
	}
}
