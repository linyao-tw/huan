import type { AssetManifestEntry, DesiredState } from "@huan/protocol";
import { DeviceApiError, type DeviceApiClient } from "./api-client.js";
import type { AssetDownloadFailure, DownloadProgress, DownloadQueue } from "./downloader.js";
import { TypedEmitter } from "./events.js";
import { describeError, silentLogger, type Logger } from "./logger.js";
import type { LayoutScheduler } from "./scheduler.js";
import type { StorageManager } from "./storage-manager.js";
import { mediaFileName, type ActivationRecord, type DeviceStorage } from "./storage.js";
import { systemClock, type Clock } from "./types.js";

export interface ReconcileResult {
	desiredVersion: number;
	activatedVersion: number | null;
	/** 這一輪是否真的把新版本切上去。 */
	activated: boolean;
	changed: boolean;
	readyVariantIds: string[];
	failed: AssetDownloadFailure[];
	storageError: string | null;
	credentialRevoked: boolean;
}

export interface AssetSummary {
	readyAssetIds: string[];
	pendingAssetIds: string[];
	readyCount: number;
	totalCount: number;
}

export interface ReconcilerEvents extends Record<string, unknown> {
	activated: { version: number; manifest: DesiredState };
	blocked: { version: number; failed: AssetDownloadFailure[]; storageError: string | null };
	progress: DownloadProgress;
	asset_ready: { assetId: string; variantId: string };
	storage_error: { message: string | null };
}

export interface ReconcilerOptions {
	storage: DeviceStorage;
	api: DeviceApiClient;
	downloader: DownloadQueue;
	storageManager: StorageManager;
	scheduler: LayoutScheduler;
	clock?: Clock;
	logger?: Logger;
}

/**
 * Desired / reported 調和迴圈 —— 整個裝置引擎的核心狀態機。
 *
 * 流程刻意是「先全部備妥，再原子性切換」：
 * 取得 desired state → 版本沒變就什麼都不做 → 下載並驗證每一個素材 →
 * 全部就緒才寫入 `manifests/active.json` 並切換播放器 → 之後才回收舊檔案。
 *
 * 只要有任何一個素材失敗，舊版本就繼續播，而且不會有任何舊檔案被刪掉。
 * 這是 HUAN 的產品承諾：新內容沒準備好，畫面上就繼續是能播的舊內容。
 */
export class Reconciler {
	readonly events: TypedEmitter<ReconcilerEvents>;

	private readonly storage: DeviceStorage;
	private readonly api: DeviceApiClient;
	private readonly downloader: DownloadQueue;
	private readonly storageManager: StorageManager;
	private readonly scheduler: LayoutScheduler;
	private readonly clock: Clock;
	private readonly logger: Logger;

	private active: DesiredState | null = null;
	private activation: ActivationRecord | null = null;
	private latestDesired: DesiredState | null = null;
	private storageError: string | null = null;
	/** 已 ACK 過的 `<version>:<variantId>`，避免每輪同步都重複打同一個端點。 */
	private readonly acked = new Set<string>();

	constructor(options: ReconcilerOptions) {
		this.storage = options.storage;
		this.api = options.api;
		this.downloader = options.downloader;
		this.storageManager = options.storageManager;
		this.scheduler = options.scheduler;
		this.clock = options.clock ?? systemClock;
		this.logger = options.logger ?? silentLogger;
		this.events = new TypedEmitter<ReconcilerEvents>(this.logger);
	}

	/** 從磁碟接續上次的狀態。離線開機時這是唯一的資料來源。 */
	async load(): Promise<void> {
		this.active = await this.storage.readActiveManifest();
		this.activation = await this.storage.readActivation();
		this.latestDesired = (await this.storage.readDesiredState()) ?? this.active;
		this.scheduler.setManifest(this.active);
	}

	get activeManifest(): DesiredState | null {
		return this.active;
	}

	get activationVersion(): number | null {
		return this.activation?.version ?? null;
	}

	get latestDesiredVersion(): number | null {
		return this.latestDesired?.version ?? null;
	}

	get lastStorageError(): string | null {
		return this.storageError;
	}

	async sync(options: { force?: boolean } = {}): Promise<ReconcileResult> {
		const desired = await this.api.getDesiredState();
		await this.storage.writeDesiredState(desired);
		this.latestDesired = desired;

		const alreadyActive = this.activation?.version === desired.version && this.active !== null;
		if (alreadyActive && !options.force && (await this.everyAssetPresent(desired))) {
			return this.result(desired, { activated: false, changed: false, ready: desired.assets.map(entry => entry.variantId), failed: [], credentialRevoked: false });
		}

		this.logger.info("開始調和新的 desired state", { from: this.activation?.version ?? null, to: desired.version });
		await this.storage.writePendingManifest(desired);

		const protect = await this.protectedFileNames(desired);
		const missingBytes = await this.missingBytes(desired);
		const space = await this.storageManager.ensureSpace({ requiredBytes: missingBytes, protect });
		if (!space.ok) {
			this.setStorageError(space.error);
			this.events.emit("blocked", { version: desired.version, failed: [], storageError: space.error });
			return this.result(desired, { activated: false, changed: false, ready: [], failed: [], credentialRevoked: false });
		}
		this.setStorageError(null);

		const outcome = await this.downloader.run({
			entries: desired.assets,
			maxConcurrent: desired.settings.maxConcurrentDownloads,
			onProgress: progress => this.events.emit("progress", progress),
			onVerified: entry => this.ackAsset(desired.version, entry)
		});

		if (outcome.credentialRevoked) {
			return this.result(desired, { activated: false, changed: false, ready: outcome.ready, failed: outcome.failed, credentialRevoked: true });
		}

		if (outcome.failed.length > 0) {
			// 這裡刻意什麼都不動：active manifest 不換、舊檔案不刪。畫面上繼續是能播的舊版本。
			this.logger.warn("部分素材尚未就緒，維持既有版本繼續播放", { version: desired.version, failed: outcome.failed.length });
			this.events.emit("blocked", { version: desired.version, failed: outcome.failed, storageError: this.storageError });
			return this.result(desired, { activated: false, changed: false, ready: outcome.ready, failed: outcome.failed, credentialRevoked: false });
		}

		await this.activate(desired);
		return this.result(desired, { activated: true, changed: true, ready: outcome.ready, failed: [], credentialRevoked: false });
	}

	/**
	 * 原子性啟用。
	 *
	 * 先寫 manifest 再寫 activation 紀錄：若在兩者之間斷電，下次開機看到的是
	 * 「manifest 已是新版但 activation 還是舊版」，於是重跑一次同步就補上了。
	 * 反過來寫的話會出現 activation 宣稱某個版本已啟用、但 manifest 根本不是那個版本的狀態。
	 */
	private async activate(desired: DesiredState): Promise<void> {
		const layoutRevisionIds = desired.layouts.map(layout => layout.revisionId);
		await this.storage.writeActiveManifest(desired);
		await this.storage.writeActivation({ version: desired.version, activatedAt: this.clock.now().toISOString(), layoutRevisionIds });
		await this.storage.clearPendingManifest();

		this.active = desired;
		this.activation = { version: desired.version, activatedAt: this.clock.now().toISOString(), layoutRevisionIds };
		this.scheduler.setManifest(desired);
		this.logger.info("已啟用新版本", { version: desired.version });
		this.events.emit("activated", { version: desired.version, manifest: desired });

		// 啟用之後才回收：在此之前舊版本的檔案還在播。
		await this.collectGarbage();
	}

	async collectGarbage(): Promise<void> {
		const protect = await this.protectedFileNames(null);
		await this.storageManager.collectGarbage({ protect });
	}

	/**
	 * 絕對不能刪的檔名。
	 *
	 * 使用中的 manifest 已經涵蓋所有排程會用到的版面（desired state 一次就把裝置未來
	 * 需要的版面全部帶下來），所以「下一個排程的素材」自然在保護名單裡；
	 * 另外再加上待啟用版本與正在寫入的暫存檔。
	 */
	private async protectedFileNames(candidate: DesiredState | null): Promise<Set<string>> {
		const protect = new Set<string>(this.downloader.inFlightFileNames());
		const pending = candidate ?? (await this.storage.readPendingManifest());
		for (const manifest of [this.active, pending]) {
			if (!manifest) continue;
			for (const entry of manifest.assets) protect.add(mediaFileName(entry));
		}
		return protect;
	}

	private async missingBytes(desired: DesiredState): Promise<number> {
		const index = await this.storage.readMediaIndex();
		let total = 0;
		for (const entry of desired.assets) {
			const record = index.entries[entry.variantId];
			if (record?.sha256 === entry.sha256) continue;
			total += entry.sizeBytes;
		}
		return total;
	}

	/**
	 * 版本沒變時的低成本自我修復檢查。
	 *
	 * 只比對索引與檔案大小、不重算雜湊，因此便宜到每次同步都能跑。
	 * 有人手動刪掉 media 目錄裡的檔案時，這個檢查會讓下一輪同步把它補回來。
	 */
	private async everyAssetPresent(desired: DesiredState): Promise<boolean> {
		const index = await this.storage.readMediaIndex();
		for (const entry of desired.assets) {
			const record = index.entries[entry.variantId];
			if (!record || record.sha256 !== entry.sha256) return false;
			const size = await this.storage.mediaFileSize(record.fileName);
			if (size === null || size !== record.sizeBytes) return false;
		}
		return true;
	}

	private async ackAsset(version: number, entry: AssetManifestEntry): Promise<void> {
		this.events.emit("asset_ready", { assetId: entry.assetId, variantId: entry.variantId });
		const key = `${version}:${entry.variantId}`;
		if (this.acked.has(key)) return;
		try {
			await this.api.ackAsset({ assetId: entry.assetId, variantId: entry.variantId, sha256: entry.sha256, sizeBytes: entry.sizeBytes });
			this.acked.add(key);
		} catch (error) {
			// ACK 失敗不影響本機播放，下一輪同步會再送一次。伺服器端只是晚一點知道而已。
			if (error instanceof DeviceApiError && error.credentialRevoked) throw error;
			this.logger.warn("回報素材 ACK 失敗，下次同步再試", { variantId: entry.variantId, error: describeError(error) });
		}
	}

	/** 給 heartbeat 用的素材統計。以最新的 desired state 為準，因為那才是伺服器想知道的進度。 */
	async assetSummary(): Promise<AssetSummary> {
		const manifest = this.latestDesired ?? this.active;
		if (!manifest) return { readyAssetIds: [], pendingAssetIds: [], readyCount: 0, totalCount: 0 };
		const index = await this.storage.readMediaIndex();
		const byAsset = new Map<string, boolean>();
		let readyCount = 0;
		for (const entry of manifest.assets) {
			const ready = index.entries[entry.variantId]?.sha256 === entry.sha256;
			if (ready) readyCount += 1;
			byAsset.set(entry.assetId, (byAsset.get(entry.assetId) ?? true) && ready);
		}
		const readyAssetIds: string[] = [];
		const pendingAssetIds: string[] = [];
		for (const [assetId, ready] of byAsset) {
			if (ready) readyAssetIds.push(assetId);
			else pendingAssetIds.push(assetId);
		}
		return { readyAssetIds, pendingAssetIds, readyCount, totalCount: manifest.assets.length };
	}

	private setStorageError(message: string | null): void {
		if (this.storageError === message) return;
		this.storageError = message;
		this.events.emit("storage_error", { message });
	}

	private result(desired: DesiredState, parts: { activated: boolean; changed: boolean; ready: string[]; failed: AssetDownloadFailure[]; credentialRevoked: boolean }): ReconcileResult {
		return {
			desiredVersion: desired.version,
			activatedVersion: this.activation?.version ?? null,
			activated: parts.activated,
			changed: parts.changed,
			readyVariantIds: parts.ready,
			failed: parts.failed,
			storageError: this.storageError,
			credentialRevoked: parts.credentialRevoked
		};
	}
}
