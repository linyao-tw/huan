import { formatBytes } from "@huan/shared";
import { statfs } from "node:fs/promises";
import { describeError, silentLogger, type Logger } from "./logger.js";
import type { DeviceStorage } from "./storage.js";
import { systemClock, type Clock } from "./types.js";

export interface DiskUsage {
	freeBytes: number | null;
	totalBytes: number | null;
}

export type DiskUsageReader = (path: string) => Promise<DiskUsage>;

/** 量不到就回 `null`，不要猜。上層看到 `null` 會選擇「照常下載」而不是誤判成磁碟已滿。 */
export function createStatfsDiskUsageReader(logger: Logger = silentLogger): DiskUsageReader {
	return async path => {
		try {
			const stats = await statfs(path);
			return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
		} catch (error) {
			logger.debug("無法取得磁碟用量", { error: describeError(error) });
			return { freeBytes: null, totalBytes: null };
		}
	};
}

export interface CollectGarbageOptions {
	/** 絕對不能刪的檔名：使用中版面、下一個排程版面、待啟用版本與正在下載的暫存檔。 */
	protect: ReadonlySet<string>;
	/** 保留期。剛寫好的檔案先留著，避免刪掉另一條同步流程正要用的東西。 */
	retentionMs?: number;
	now?: Date;
}

export interface CollectGarbageResult {
	removed: string[];
	freedBytes: number;
}

export interface EnsureSpaceOptions {
	requiredBytes: number;
	protect: ReadonlySet<string>;
}

export interface EnsureSpaceResult {
	ok: boolean;
	freeBytes: number | null;
	/** 空間真的不夠時的繁體中文說明，會原封不動出現在 Admin 的裝置頁。 */
	error: string | null;
	collected: CollectGarbageResult | null;
}

export interface StorageManagerOptions {
	storage: DeviceStorage;
	logger?: Logger;
	clock?: Clock;
	diskUsage?: DiskUsageReader;
	/** 下載完之後仍要保留的空間。塞到一個位元組不剩會讓整台機器（包含日誌）一起失能。 */
	minFreeBytes?: number;
	retentionMs?: number;
}

export const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_RETENTION_MS = 10 * 60 * 1000;

/**
 * 磁碟守門員。
 *
 * 三條規則：先看空間再開始下載；不夠就先回收沒人引用的檔案；還是不夠就往上回報
 * `storageError`，而不是一直重試把磁碟磨到掛。
 */
export class StorageManager {
	private readonly storage: DeviceStorage;
	private readonly logger: Logger;
	private readonly clock: Clock;
	private readonly diskUsage: DiskUsageReader;
	private readonly minFreeBytes: number;
	private readonly retentionMs: number;

	constructor(options: StorageManagerOptions) {
		this.storage = options.storage;
		this.logger = options.logger ?? silentLogger;
		this.clock = options.clock ?? systemClock;
		this.diskUsage = options.diskUsage ?? createStatfsDiskUsageReader(this.logger);
		this.minFreeBytes = options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
		this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
	}

	usage(): Promise<DiskUsage> {
		return this.diskUsage(this.storage.mediaDir);
	}

	async collectGarbage(options: CollectGarbageOptions): Promise<CollectGarbageResult> {
		const retentionMs = options.retentionMs ?? this.retentionMs;
		const nowMs = (options.now ?? this.clock.now()).getTime();
		const files = await this.storage.listMediaFiles();
		const result: CollectGarbageResult = { removed: [], freedBytes: 0 };

		for (const file of files) {
			if (options.protect.has(file.fileName)) continue;
			// 保留期存在的理由：另一條同步流程可能剛把檔案寫好、還沒寫進 manifest。
			// 立刻刪掉會造成「下載完又被自己刪掉」的無窮迴圈。
			// 夾到 0 是為了時鐘倒退（NTP 校時）的情況：那時檔案的「年齡」會是負數，
			// 不夾住的話這個檔案就永遠不會被回收。
			if (Math.max(0, nowMs - file.modifiedAtMs) < retentionMs) continue;
			try {
				await this.storage.removeMediaFile(file.fileName);
				result.removed.push(file.fileName);
				result.freedBytes += file.sizeBytes;
			} catch (error) {
				this.logger.warn("回收媒體檔失敗", { file: file.fileName, error: describeError(error) });
			}
		}

		if (result.removed.length > 0) {
			const removed = new Set(result.removed);
			await this.storage.updateMediaIndex(index => {
				for (const [variantId, entry] of Object.entries(index.entries)) {
					if (removed.has(entry.fileName)) delete index.entries[variantId];
				}
			});
			this.logger.info("已回收不再引用的媒體檔", { count: result.removed.length, bytes: result.freedBytes });
		}
		return result;
	}

	async ensureSpace(options: EnsureSpaceOptions): Promise<EnsureSpaceResult> {
		const needed = options.requiredBytes + this.minFreeBytes;
		const first = await this.usage();
		if (first.freeBytes === null) {
			// 量不到就不擋。寧可讓下載自己因為 ENOSPC 失敗，也不要因為讀不到 statfs 就永遠不更新內容。
			return { ok: true, freeBytes: null, error: null, collected: null };
		}
		if (first.freeBytes >= needed) return { ok: true, freeBytes: first.freeBytes, error: null, collected: null };

		const collected = await this.collectGarbage({ protect: options.protect });
		let usage = await this.usage();
		if (usage.freeBytes !== null && usage.freeBytes >= needed) return { ok: true, freeBytes: usage.freeBytes, error: null, collected };

		// 還是不夠就放棄保留期再掃一次。保留期是為了防競態，而 protect 已經涵蓋所有還會用到的檔案，
		// 在磁碟壓力下多留十分鐘沒有意義。
		const aggressive = await this.collectGarbage({ protect: options.protect, retentionMs: 0 });
		collected.removed.push(...aggressive.removed);
		collected.freedBytes += aggressive.freedBytes;
		usage = await this.usage();
		if (usage.freeBytes !== null && usage.freeBytes >= needed) return { ok: true, freeBytes: usage.freeBytes, error: null, collected };

		const error = `磁碟空間不足：需要 ${formatBytes(needed)}，目前僅剩 ${formatBytes(usage.freeBytes)}`;
		this.logger.error("磁碟空間不足，暫停下載", { requiredBytes: needed, freeBytes: usage.freeBytes });
		return { ok: false, freeBytes: usage.freeBytes, error, collected };
	}
}
