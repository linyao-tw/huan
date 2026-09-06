import type { StorageService } from "@/lib/storage";
import { devices, layoutRevisions, layouts, mediaAssets, mediaDeviceSync, mediaVariants, schedules, type Database } from "@huan/db";
import { collectAssetIds } from "@huan/layout-engine";
import type { MediaAsset, MediaKind, MediaUsage, MediaVariant, MediaVariantRole } from "@huan/protocol";
import { eq, inArray } from "drizzle-orm";

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MediaVariantRow = typeof mediaVariants.$inferSelect;

/**
 * 由 content type 決定副檔名，而不是使用者送來的檔名。
 *
 * 物件鍵一律由 UUID 組成；副檔名只是給人和工具看的線索，讓它跟著我們驗證過的
 * content type 走，就不可能出現 `evil.html` 被當成影片存進去這種事。
 */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/x-matroska": ".mkv",
	"video/webm": ".webm",
	"video/mpeg": ".mpeg",
	"video/x-msvideo": ".avi",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/gif": ".gif",
	"text/html": ".html"
};

export function extensionForContentType(contentType: string): string {
	return EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? ".bin";
}

export function uploadObjectKey(assetId: string, variantId: string, contentType: string): string {
	return `uploads/${assetId}/${variantId}${extensionForContentType(contentType)}`;
}

export function serializeVariant(row: MediaVariantRow): MediaVariant {
	return {
		id: row.id,
		assetId: row.assetId,
		role: row.role,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		sha256: row.sha256,
		width: row.width,
		height: row.height,
		durationMs: row.durationMs,
		available: row.available,
		createdAt: row.createdAt.toISOString()
	};
}

function pickVariant(variants: readonly MediaVariantRow[], role: MediaVariantRole): MediaVariantRow | undefined {
	return variants.find(variant => variant.role === role && variant.available);
}

/**
 * 縮圖與預覽網址是讀取當下才簽的短時效網址。
 *
 * 簽章網址不寫進資料庫也不寫進 desired state：它會過期，存起來只會讓
 * 快取住的舊資料指向一個已經失效的位址。
 */
export async function serializeMediaAsset(asset: MediaAssetRow, variants: readonly MediaVariantRow[], storage: StorageService, signedUrlTtlSeconds: number): Promise<MediaAsset> {
	const thumbnail = pickVariant(variants, "thumbnail");
	const preview = pickVariant(variants, "preview");
	const [thumbnailUrl, previewUrl] = await Promise.all([
		thumbnail ? storage.presignGet(thumbnail.objectKey, signedUrlTtlSeconds) : Promise.resolve(null),
		preview ? storage.presignGet(preview.objectKey, signedUrlTtlSeconds) : Promise.resolve(null)
	]);

	return {
		id: asset.id,
		kind: asset.kind,
		name: asset.name,
		originalFilename: asset.originalFilename,
		status: asset.status,
		errorMessage: asset.errorMessage,
		probe: asset.probe ?? null,
		variants: variants.map(serializeVariant),
		thumbnailUrl,
		previewUrl,
		createdBy: asset.createdBy,
		createdAt: asset.createdAt.toISOString(),
		updatedAt: asset.updatedAt.toISOString()
	};
}

export async function loadVariants(db: Database, assetIds: readonly string[]): Promise<Map<string, MediaVariantRow[]>> {
	const map = new Map<string, MediaVariantRow[]>();
	if (assetIds.length === 0) return map;
	const rows = await db
		.select()
		.from(mediaVariants)
		.where(inArray(mediaVariants.assetId, [...assetIds]));
	for (const row of rows) {
		const list = map.get(row.assetId);
		if (list) list.push(row);
		else map.set(row.assetId, [row]);
	}
	return map;
}

/**
 * 派送給 Device 的產物。
 *
 * 影片與圖片送 `playback`（轉檔後的正式播放版本）。HTML 沒有轉檔的概念，
 * Worker 產出的是整理過的 `preview`，所以 HTML 在沒有 `playback` 時退回 `preview`。
 */
export function distributionVariant(kind: MediaKind, variants: readonly MediaVariantRow[]): MediaVariantRow | null {
	const playback = variants.find(variant => variant.role === "playback");
	if (playback) return playback;
	if (kind === "html") return variants.find(variant => variant.role === "preview") ?? null;
	return null;
}

/**
 * 誰正在使用這個素材。
 *
 * 版面文件是 JSONB，沒辦法用索引查「引用了哪個素材」，所以直接把版面全部讀出來
 * 在記憶體裡比對。版面的數量是「使用者手工排出來的畫面」等級，不是資料流等級。
 */
export async function computeMediaUsage(db: Database, assetId: string): Promise<MediaUsage> {
	const layoutRows = await db.select({ id: layouts.id, name: layouts.name, draft: layouts.draft, publishedRevisionId: layouts.publishedRevisionId }).from(layouts);

	const publishedRevisionIds = layoutRows.map(row => row.publishedRevisionId).filter((value): value is string => value !== null);
	const revisionRows =
		publishedRevisionIds.length > 0
			? await db
					.select({ id: layoutRevisions.id, layoutId: layoutRevisions.layoutId, document: layoutRevisions.document })
					.from(layoutRevisions)
					.where(inArray(layoutRevisions.id, publishedRevisionIds))
			: [];
	const documentByRevisionId = new Map(revisionRows.map(row => [row.id, row.document]));

	const usedLayouts: MediaUsage["layouts"] = [];
	const publishedLayoutIds: string[] = [];
	for (const layout of layoutRows) {
		const inDraft = collectAssetIds(layout.draft).includes(assetId);
		const publishedDocument = layout.publishedRevisionId ? documentByRevisionId.get(layout.publishedRevisionId) : undefined;
		const inPublished = publishedDocument ? collectAssetIds(publishedDocument).includes(assetId) : false;
		if (!inDraft && !inPublished) continue;
		usedLayouts.push({ id: layout.id, name: layout.name, published: inPublished });
		if (inPublished) publishedLayoutIds.push(layout.id);
	}

	const usedSchedules = publishedLayoutIds.length > 0 ? await db.select({ id: schedules.id, name: schedules.name }).from(schedules).where(inArray(schedules.layoutId, publishedLayoutIds)) : [];

	const deviceMap = new Map<string, { id: string; name: string }>();
	if (publishedLayoutIds.length > 0) {
		const byDefaultLayout = await db.select({ id: devices.id, name: devices.name }).from(devices).where(inArray(devices.defaultLayoutId, publishedLayoutIds));
		for (const device of byDefaultLayout) deviceMap.set(device.id, device);
	}

	const bySync = await db.select({ id: devices.id, name: devices.name }).from(mediaDeviceSync).innerJoin(devices, eq(devices.id, mediaDeviceSync.deviceId)).where(eq(mediaDeviceSync.assetId, assetId));
	for (const device of bySync) deviceMap.set(device.id, device);

	return { layouts: usedLayouts, schedules: usedSchedules, devices: [...deviceMap.values()] };
}

export function usageIsEmpty(usage: MediaUsage): boolean {
	return usage.layouts.length === 0 && usage.schedules.length === 0 && usage.devices.length === 0;
}
