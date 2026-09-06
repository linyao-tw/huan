import { JobError, USER_MESSAGES } from "@/errors";
import type { WorkerLogger } from "@/logger";
import type { ObjectStorage } from "@/storage";
import type { Database } from "@huan/db";
import { mediaAssets, mediaVariants } from "@huan/db";
import type { MediaKind, MediaProbe, MediaVariantRole } from "@huan/protocol";
import { and, eq } from "drizzle-orm";

export interface AssetRow {
	id: string;
	kind: MediaKind;
	name: string;
	originalFilename: string;
	contentType: string;
	status: string;
}

export interface VariantRow {
	id: string;
	role: MediaVariantRole;
	objectKey: string;
	contentType: string;
	sizeBytes: number;
	available: boolean;
}

export interface VariantInput {
	assetId: string;
	role: MediaVariantRole;
	objectKey: string;
	contentType: string;
	sizeBytes: number;
	sha256: string | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}

export async function loadAsset(db: Database, assetId: string): Promise<AssetRow> {
	const rows = await db
		.select({
			id: mediaAssets.id,
			kind: mediaAssets.kind,
			name: mediaAssets.name,
			originalFilename: mediaAssets.originalFilename,
			contentType: mediaAssets.contentType,
			status: mediaAssets.status
		})
		.from(mediaAssets)
		.where(eq(mediaAssets.id, assetId))
		.limit(1);

	const asset = rows.at(0);
	if (!asset) throw new JobError(`素材 ${assetId} 不存在`, USER_MESSAGES.missingOriginal);
	return asset;
}

/**
 * 取出還能使用的原始檔。
 *
 * `available = false` 代表原始檔已經在上一次成功處理後被刪掉了。
 * 這種情況不是暫時性錯誤，重試多少次都不會變好，所以直接給出「請重新上傳」。
 */
export async function requireOriginalVariant(db: Database, assetId: string): Promise<VariantRow> {
	const rows = await db
		.select({
			id: mediaVariants.id,
			role: mediaVariants.role,
			objectKey: mediaVariants.objectKey,
			contentType: mediaVariants.contentType,
			sizeBytes: mediaVariants.sizeBytes,
			available: mediaVariants.available
		})
		.from(mediaVariants)
		.where(and(eq(mediaVariants.assetId, assetId), eq(mediaVariants.role, "original")))
		.limit(1);

	const original = rows.at(0);
	if (!original || !original.available) throw new JobError(`素材 ${assetId} 沒有可用的原始檔`, USER_MESSAGES.missingOriginal);
	return original;
}

export async function markAssetProcessing(db: Database, assetId: string): Promise<void> {
	await db.update(mediaAssets).set({ status: "processing", errorMessage: null, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
}

export async function saveAssetProbe(db: Database, assetId: string, probe: MediaProbe): Promise<void> {
	await db.update(mediaAssets).set({ probe, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
}

export async function markAssetReady(db: Database, assetId: string): Promise<void> {
	await db.update(mediaAssets).set({ status: "ready", errorMessage: null, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
}

/** `message` 會直接顯示給使用者，呼叫端必須傳 `USER_MESSAGES` 裡的文案。 */
export async function markAssetFailed(db: Database, assetId: string, message: string): Promise<void> {
	await db.update(mediaAssets).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
}

/**
 * 寫入（或覆蓋）一個產物。
 *
 * 重試時會產生新的 UUID 物件鍵，舊物件若不順手刪掉就會變成沒有任何資料列指向的孤兒，
 * 因此這裡在覆蓋後把前一個物件一併回收；刪不掉只記錄日誌，不讓它擋住整個工作。
 */
export async function replaceVariant(db: Database, storage: ObjectStorage, logger: WorkerLogger, input: VariantInput): Promise<void> {
	const existing = await db
		.select({ objectKey: mediaVariants.objectKey })
		.from(mediaVariants)
		.where(and(eq(mediaVariants.assetId, input.assetId), eq(mediaVariants.role, input.role)))
		.limit(1);

	await db
		.insert(mediaVariants)
		.values({
			assetId: input.assetId,
			role: input.role,
			objectKey: input.objectKey,
			contentType: input.contentType,
			sizeBytes: input.sizeBytes,
			sha256: input.sha256,
			width: input.width,
			height: input.height,
			durationMs: input.durationMs,
			available: true,
			distributionSettledAt: null,
			removedAt: null
		})
		.onConflictDoUpdate({
			target: [mediaVariants.assetId, mediaVariants.role],
			set: {
				objectKey: input.objectKey,
				contentType: input.contentType,
				sizeBytes: input.sizeBytes,
				sha256: input.sha256,
				width: input.width,
				height: input.height,
				durationMs: input.durationMs,
				available: true,
				distributionSettledAt: null,
				removedAt: null,
				createdAt: new Date()
			}
		});

	const staleKey = existing.at(0)?.objectKey;
	if (staleKey && staleKey !== input.objectKey) {
		try {
			await storage.deleteObject(staleKey);
		} catch (error) {
			logger.warn({ objectKey: staleKey, err: error }, "無法刪除舊產物物件");
		}
	}
}

/**
 * 刪除原始檔。
 *
 * HUAN 刻意不長期保存原始母帶：RustFS 只是轉檔的暫存區，正式播放副本存在 Device。
 * 資料列保留下來（`available = false`）讓 UI 能誠實說明素材為什麼需要重新上傳。
 */
export async function retireOriginal(db: Database, storage: ObjectStorage, logger: WorkerLogger, assetId: string): Promise<void> {
	const rows = await db
		.select({ id: mediaVariants.id, objectKey: mediaVariants.objectKey })
		.from(mediaVariants)
		.where(and(eq(mediaVariants.assetId, assetId), eq(mediaVariants.role, "original")))
		.limit(1);

	const original = rows.at(0);
	if (!original) return;

	await storage.deleteObject(original.objectKey);
	await db.update(mediaVariants).set({ available: false, removedAt: new Date() }).where(eq(mediaVariants.id, original.id));
	logger.info({ objectKey: original.objectKey }, "已刪除原始檔");
}
