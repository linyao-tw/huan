import { describeError } from "@/errors";
import type { WorkerLogger } from "@/logger";
import type { ObjectStorage } from "@/storage";
import type { Database } from "@huan/db";
import { sql } from "drizzle-orm";

/** 一輪最多回收這麼多筆，避免單次掃描把連線佔住太久。 */
const DEFAULT_BATCH_LIMIT = 200;

export interface CleanupOptions {
	db: Database;
	storage: ObjectStorage;
	logger: WorkerLogger;
	retentionHours: number;
	limit?: number;
}

export interface CleanupResult {
	reclaimed: number;
	needsReupload: number;
	skipped: number;
}

type ReclaimableRow = {
	id: string;
	asset_id: string;
	object_key: string;
};

/**
 * 回收已經送達所有裝置的播放產物。
 *
 * 三個條件缺一不可：
 * 1. `distribution_settled_at` 有值——那是 Server 判定「所有目標裝置都 ACK 完成」的時刻。
 * 2. 保留期已過——這段緩衝是用來吸收 ACK 與重試之間的競態，第一台下載成功就刪除會害到還在重試的裝置。
 * 3. 沒有任何 `media_device_sync` 還不是 `ready`——`pending` 代表裝置還在下載，`failed` 代表它等著重試，
 *    兩種情況刪掉物件都會讓那台裝置永遠拿不到內容。
 */
export async function cleanupDistribution(options: CleanupOptions): Promise<CleanupResult> {
	const { db, storage, logger, retentionHours } = options;
	const limit = options.limit ?? DEFAULT_BATCH_LIMIT;

	const candidates = await db.execute<ReclaimableRow>(sql`
		select v.id, v.asset_id, v.object_key
		from media_variants v
		where v.role = 'playback'
			and v.available = true
			and v.distribution_settled_at is not null
			and v.distribution_settled_at < now() - make_interval(hours => ${retentionHours})
			and not exists (
				select 1 from media_device_sync s
				where s.variant_id = v.id and s.status <> 'ready'
			)
		order by v.distribution_settled_at
		limit ${limit}
	`);

	let reclaimed = 0;
	let skipped = 0;
	const touchedAssets = new Set<string>();

	for (const row of candidates) {
		try {
			await storage.deleteObject(row.object_key);
		} catch (error) {
			/** 物件還在就不要把資料列標成已回收，否則檔案會變成沒人管的孤兒。下一輪再試。 */
			skipped += 1;
			logger.warn({ variantId: row.id, objectKey: row.object_key, err: describeError(error) }, "回收播放產物失敗，稍後重試");
			continue;
		}

		await db.execute(sql`
			update media_variants
			set available = false, removed_at = now()
			where id = ${row.id} and available = true
		`);
		reclaimed += 1;
		touchedAssets.add(row.asset_id);
		logger.info({ variantId: row.id, assetId: row.asset_id, objectKey: row.object_key }, "已回收播放產物");
	}

	let needsReupload = 0;
	for (const assetId of touchedAssets) {
		/**
		 * 原始檔早在轉檔成功時就刪掉了，播放產物又被回收，伺服器手上就真的什麼都沒有。
		 * 這是 HUAN 明確的產品取捨，狀態要誠實反映出來，不能假裝檔案還在。
		 */
		const updated = await db.execute<{ id: string }>(sql`
			update media_assets a
			set status = 'needs_reupload', updated_at = now()
			where a.id = ${assetId}
				and a.status = 'ready'
				and not exists (
					select 1 from media_variants v
					where v.asset_id = a.id and v.available = true and v.role in ('playback', 'original')
				)
			returning a.id
		`);
		if (updated.length > 0) {
			needsReupload += 1;
			logger.info({ assetId }, "素材已無可用檔案，標記為需要重新上傳");
		}
	}

	if (reclaimed > 0 || skipped > 0) logger.info({ reclaimed, skipped, needsReupload }, "distribution 回收完成");
	return { reclaimed, needsReupload, skipped };
}
