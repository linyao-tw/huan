import type { AssetManifestEntry, DeviceDownloadUrlResponse } from "@huan/protocol";
import { backoffDelay, type BackoffOptions } from "@huan/shared";
import { sha256File } from "@huan/shared/node";
import { createHash } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { DeviceApiError, type DeviceApiClient } from "./api-client.js";
import { describeError, silentLogger, type Logger } from "./logger.js";
import { atomicWriteFile, isNotFound, mediaFileName, partFileName, partMetaFileName, readJsonFile, type DeviceStorage } from "./storage.js";
import { isNonEmptyString, isRecord, jsonValidator, systemClock, systemSleep, type Clock, type FetchLike, type Sleep } from "./types.js";

export const DOWNLOAD_BACKOFF: Required<BackoffOptions> = { baseMs: 1_000, maxMs: 30_000, jitterRatio: 0.25 };

/** 簽章網址快到期就先換一張，免得大檔案下載到一半才被踢掉。 */
const URL_EXPIRY_MARGIN_MS = 30_000;

const READ_CHUNK_BYTES = 1 << 20;

export interface DownloadProgress {
	variantId: string;
	assetId: string;
	receivedBytes: number;
	totalBytes: number;
}

export interface AssetDownloadFailure {
	variantId: string;
	assetId: string;
	attempts: number;
	reason: string;
}

export interface DownloadOutcome {
	/** 已在本機且雜湊正確的 variantId。 */
	ready: string[];
	failed: AssetDownloadFailure[];
	bytesDownloaded: number;
	/** 憑證被撤銷時提早中止，上層要走解除綁定而不是重試。 */
	credentialRevoked: boolean;
}

export interface DownloadRunOptions {
	entries: readonly AssetManifestEntry[];
	maxConcurrent?: number;
	/** 每個檔案通過雜湊驗證後呼叫。ACK 就掛在這裡，因此雜湊不符時絕不可能被呼叫到。 */
	onVerified?: (entry: AssetManifestEntry) => Promise<void> | void;
	onProgress?: (progress: DownloadProgress) => void;
	signal?: AbortSignal;
}

export interface DownloadQueueOptions {
	storage: DeviceStorage;
	api: DeviceApiClient;
	fetch?: FetchLike;
	logger?: Logger;
	clock?: Clock;
	sleep?: Sleep;
	random?: () => number;
	maxAttempts?: number;
	maxConcurrent?: number;
}

interface PartMeta {
	sha256: string;
	sizeBytes: number;
	acceptsRanges: boolean;
}

const partMetaValidator = jsonValidator<PartMeta>(value => {
	if (!isRecord(value)) return null;
	const { sha256, sizeBytes, acceptsRanges } = value;
	if (!isNonEmptyString(sha256)) return null;
	if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
	if (typeof acceptsRanges !== "boolean") return null;
	return { sha256, sizeBytes, acceptsRanges };
});

class ChecksumMismatchError extends Error {
	constructor(expected: string, actual: string) {
		super(`雜湊不符：期望 ${expected.slice(0, 12)}…，實際 ${actual.slice(0, 12)}…`);
		this.name = "ChecksumMismatchError";
	}
}

class SignedUrlExpiredError extends Error {
	constructor(status: number) {
		super(`簽章網址已失效（HTTP ${status}）`);
		this.name = "SignedUrlExpiredError";
	}
}

class TransferError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TransferError";
	}
}

/**
 * 有上限的下載佇列。
 *
 * 設計重點：
 * - 同時最多 `maxConcurrent` 個檔案。一次抓 50 支影片會把家用網路與磁碟 I/O 一起壓垮。
 * - 邊寫檔邊算 SHA-256，比對通過才 `rename` 成正式檔名。雜湊不符就刪暫存檔重試，**永遠不 ACK**。
 * - 已經在本機且索引記載雜湊正確的檔案直接跳過，重開機不會重抓一遍整個賣場的素材。
 * - 簽章網址過期只換網址、不算失敗，一支大影片不會因為 URL 到期就讓整次同步破功。
 */
export class DownloadQueue {
	private readonly storage: DeviceStorage;
	private readonly api: DeviceApiClient;
	private readonly fetchImpl: FetchLike;
	private readonly logger: Logger;
	private readonly clock: Clock;
	private readonly sleep: Sleep;
	private readonly random: () => number;
	private readonly maxAttempts: number;
	private readonly defaultConcurrency: number;
	/** GC 必須看得到這些檔名，否則會把正在寫的暫存檔刪掉。 */
	private readonly inFlight = new Set<string>();

	constructor(options: DownloadQueueOptions) {
		this.storage = options.storage;
		this.api = options.api;
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.logger = options.logger ?? silentLogger;
		this.clock = options.clock ?? systemClock;
		this.sleep = options.sleep ?? systemSleep;
		this.random = options.random ?? Math.random;
		this.maxAttempts = options.maxAttempts ?? 5;
		this.defaultConcurrency = options.maxConcurrent ?? 3;
	}

	/** 正在下載的檔名（含 `.part` 與最終檔名），供垃圾回收避開。 */
	inFlightFileNames(): ReadonlySet<string> {
		return new Set(this.inFlight);
	}

	async run(options: DownloadRunOptions): Promise<DownloadOutcome> {
		const unique = dedupeEntries(options.entries);
		const outcome: DownloadOutcome = { ready: [], failed: [], bytesDownloaded: 0, credentialRevoked: false };
		if (unique.length === 0) return outcome;

		const queue = [...unique];
		const concurrency = Math.max(1, Math.min(options.maxConcurrent ?? this.defaultConcurrency, unique.length));

		const worker = async (): Promise<void> => {
			for (;;) {
				const entry = queue.shift();
				if (!entry) return;
				if (options.signal?.aborted || outcome.credentialRevoked) return;
				const result = await this.ensureAsset(entry, options);
				if (result.ok) {
					outcome.ready.push(entry.variantId);
					outcome.bytesDownloaded += result.bytesDownloaded;
					try {
						await options.onVerified?.(entry);
					} catch (error) {
						this.logger.warn("素材驗證後的回呼失敗", { variantId: entry.variantId, error: describeError(error) });
					}
				} else {
					if (result.credentialRevoked) outcome.credentialRevoked = true;
					outcome.failed.push({ variantId: entry.variantId, assetId: entry.assetId, attempts: result.attempts, reason: result.reason });
				}
			}
		};

		await Promise.all(Array.from({ length: concurrency }, () => worker()));
		return outcome;
	}

	private async ensureAsset(
		entry: AssetManifestEntry,
		run: DownloadRunOptions
	): Promise<{ ok: true; bytesDownloaded: number } | { ok: false; attempts: number; reason: string; credentialRevoked: boolean }> {
		const fileName = mediaFileName(entry);
		if (await this.isAlreadyValid(entry, fileName)) {
			return { ok: true, bytesDownloaded: 0 };
		}

		this.inFlight.add(fileName);
		this.inFlight.add(partFileName(entry.variantId));
		this.inFlight.add(partMetaFileName(entry.variantId));
		try {
			let attempt = 0;
			let urlRefreshes = 0;
			let signed: DeviceDownloadUrlResponse | null = null;
			let lastReason = "未知錯誤";

			while (attempt < this.maxAttempts) {
				if (run.signal?.aborted) return { ok: false, attempts: attempt, reason: "同步已取消", credentialRevoked: false };
				try {
					if (!signed || this.isExpiring(signed)) signed = await this.api.getDownloadUrl(entry.downloadPath);
					const bytesDownloaded = await this.downloadOnce(entry, signed, fileName, run);
					return { ok: true, bytesDownloaded };
				} catch (error) {
					lastReason = describeError(error);
					if (error instanceof DeviceApiError && error.credentialRevoked) {
						return { ok: false, attempts: attempt + 1, reason: lastReason, credentialRevoked: true };
					}
					const expired = error instanceof SignedUrlExpiredError;
					signed = null;
					if (expired && urlRefreshes < this.maxAttempts) {
						// 簽章網址到期是可預期的正常事件，不佔用重試預算也不需要退避 —— 換一張立刻續傳。
						urlRefreshes += 1;
						this.logger.debug("簽章網址已失效，重新索取", { variantId: entry.variantId });
						continue;
					}
					attempt += 1;
					if (attempt >= this.maxAttempts) break;
					this.logger.warn("素材下載失敗，稍後重試", { variantId: entry.variantId, attempt, error: lastReason });
					await this.sleep(backoffDelay(attempt - 1, DOWNLOAD_BACKOFF, this.random));
				}
			}
			return { ok: false, attempts: attempt, reason: lastReason, credentialRevoked: false };
		} finally {
			this.inFlight.delete(fileName);
			this.inFlight.delete(partFileName(entry.variantId));
			this.inFlight.delete(partMetaFileName(entry.variantId));
		}
	}

	/**
	 * 已經在本機的檔案要不要重算雜湊。
	 *
	 * 索引命中且檔案大小相符就直接信任：一台看板可能存著好幾十 GB 的影片，
	 * 每次開機都全部重算雜湊會讓開機時間變成好幾分鐘。索引沒有紀錄時才做一次完整驗證，
	 * 驗過就記進索引 —— 「驗一次，之後相信索引」。
	 */
	private async isAlreadyValid(entry: AssetManifestEntry, fileName: string): Promise<boolean> {
		const size = await this.storage.mediaFileSize(fileName);
		if (size === null) return false;

		const index = await this.storage.readMediaIndex();
		const record = index.entries[entry.variantId];
		if (record && record.sha256 === entry.sha256 && record.fileName === fileName && record.sizeBytes === size) return true;

		const digest = await sha256File(this.storage.mediaPath(fileName)).catch(() => null);
		if (digest !== entry.sha256) {
			this.logger.warn("本機播放檔雜湊不符，刪除後重新下載", { variantId: entry.variantId });
			await this.storage.removeMediaFile(fileName);
			await this.storage.updateMediaIndex(current => {
				delete current.entries[entry.variantId];
			});
			return false;
		}
		await this.recordVerified(entry, fileName, size);
		return true;
	}

	private isExpiring(signed: DeviceDownloadUrlResponse): boolean {
		const expiresAt = Date.parse(signed.expiresAt);
		if (Number.isNaN(expiresAt)) return false;
		return expiresAt - this.clock.now().getTime() <= URL_EXPIRY_MARGIN_MS;
	}

	private async downloadOnce(entry: AssetManifestEntry, signed: DeviceDownloadUrlResponse, fileName: string, run: DownloadRunOptions): Promise<number> {
		const partPath = this.storage.mediaPath(partFileName(entry.variantId));
		const metaPath = this.storage.mediaPath(partMetaFileName(entry.variantId));
		const finalPath = this.storage.mediaPath(fileName);

		let meta = await readJsonFile(metaPath, partMetaValidator, this.logger);
		if (meta && meta.sha256 !== entry.sha256) {
			// 同一個 variant 的內容換了（例如重新轉檔），舊的續傳資料完全沒有價值。
			await rm(partPath, { force: true });
			await rm(metaPath, { force: true });
			meta = null;
		}

		let offset = 0;
		if (meta?.acceptsRanges) {
			const partSize = await this.storage.mediaFileSize(partFileName(entry.variantId));
			if (partSize !== null && partSize > 0 && partSize < entry.sizeBytes) offset = partSize;
			else if (partSize !== null && partSize >= entry.sizeBytes) await rm(partPath, { force: true });
		} else if (meta) {
			await rm(partPath, { force: true });
		}

		const headers: Record<string, string> = {};
		if (offset > 0) headers.range = `bytes=${offset}-`;

		let response: Response;
		try {
			response = await this.fetchImpl(signed.url, { headers, signal: run.signal });
		} catch (error) {
			throw new TransferError(`下載連線失敗：${describeError(error)}`);
		}

		if (response.status === 403 || response.status === 410) throw new SignedUrlExpiredError(response.status);
		if (response.status === 416) {
			// 續傳位移超出範圍：本機的 `.part` 已經不能用了，砍掉重來。
			await rm(partPath, { force: true });
			await rm(metaPath, { force: true });
			throw new TransferError("續傳範圍無效，已捨棄暫存檔");
		}
		if (!response.ok) throw new TransferError(`下載回應 HTTP ${response.status}`);

		// 伺服器沒回 206 就代表這次是完整內容，之前的 `.part` 必須整個作廢。
		const resumed = offset > 0 && response.status === 206;
		if (offset > 0 && !resumed) offset = 0;

		const acceptsRanges = (response.headers.get("accept-ranges") ?? "").toLowerCase().includes("bytes");
		await atomicWriteFile(metaPath, `${JSON.stringify({ sha256: entry.sha256, sizeBytes: entry.sizeBytes, acceptsRanges } satisfies PartMeta)}\n`);

		const hash = createHash("sha256");
		if (resumed) await hashFilePrefix(hash, partPath, offset);
		else await rm(partPath, { force: true });

		let received = offset;
		const handle = await open(partPath, resumed ? "a" : "w");
		try {
			const body = response.body;
			if (body) {
				const reader = body.getReader();
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					const bytes = chunk.value;
					hash.update(bytes);
					await handle.write(bytes);
					received += bytes.byteLength;
					run.onProgress?.({ variantId: entry.variantId, assetId: entry.assetId, receivedBytes: received, totalBytes: entry.sizeBytes });
				}
			}
			await handle.sync();
		} finally {
			await handle.close();
		}

		const digest = hash.digest("hex");
		if (digest !== entry.sha256) {
			// 雜湊不符可能是傳輸損毀，也可能是續傳前綴壞掉。兩種情況都只能整支丟掉重來，
			// 而且絕對不能 ACK —— 伺服器一旦以為這台裝置已經有正本，就可能回收來源檔。
			await rm(partPath, { force: true });
			await rm(metaPath, { force: true });
			throw new ChecksumMismatchError(entry.sha256, digest);
		}

		await rename(partPath, finalPath);
		await rm(metaPath, { force: true });
		await this.recordVerified(entry, fileName, received);
		this.logger.info("素材已驗證完成", { variantId: entry.variantId, bytes: received });
		return received - offset;
	}

	private async recordVerified(entry: AssetManifestEntry, fileName: string, sizeBytes: number): Promise<void> {
		const verifiedAt = this.clock.now().toISOString();
		await this.storage.updateMediaIndex(index => {
			index.entries[entry.variantId] = { variantId: entry.variantId, assetId: entry.assetId, fileName, sha256: entry.sha256, sizeBytes, verifiedAt };
		});
	}
}

function dedupeEntries(entries: readonly AssetManifestEntry[]): AssetManifestEntry[] {
	const seen = new Map<string, AssetManifestEntry>();
	for (const entry of entries) {
		if (!seen.has(entry.variantId)) seen.set(entry.variantId, entry);
	}
	return [...seen.values()];
}

/**
 * 把既有的 `.part` 前綴讀進雜湊。
 *
 * 續傳無法沿用上次的 Hash 物件（它不能序列化），但重讀本機檔案遠比重下載整支影片便宜。
 */
async function hashFilePrefix(hash: ReturnType<typeof createHash>, filePath: string, bytes: number): Promise<void> {
	if (bytes <= 0) return;
	let handle;
	try {
		handle = await open(filePath, "r");
	} catch (error) {
		if (isNotFound(error)) return;
		throw error;
	}
	try {
		const buffer = new Uint8Array(READ_CHUNK_BYTES);
		let position = 0;
		while (position < bytes) {
			const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes - position), position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
	} finally {
		await handle.close();
	}
}
