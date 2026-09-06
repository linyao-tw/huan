import { DesiredStateSchema, ReportedStateSchema, type AssetManifestEntry, type DesiredState, type ReportedState } from "@huan/protocol";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describeError, silentLogger, type Logger } from "./logger.js";
import { isNonEmptyString, isRecord, jsonValidator, type JsonValidator } from "./types.js";

export interface AtomicWriteOptions {
	/** 檔案權限。憑證檔傳 `0o600`。 */
	mode?: number;
	/**
	 * 測試用的注入點：在 `rename` 之前介入，模擬「暫存檔已經寫完但還沒換上」的斷電時刻。
	 * production 路徑永遠不會傳這個欄位。
	 */
	beforeRename?: () => Promise<void> | void;
}

/**
 * 原子寫入：先寫 `<file>.tmp`、`fsync`，再 `rename` 覆蓋目標。
 *
 * `fsync` 不能省。少了它，`rename` 可能先在 metadata 層生效而資料還在 page cache 裡，
 * 突然斷電就會留下一個長度正確、內容全是 0 的 manifest —— 那比檔案不存在還糟，
 * 因為讀取端會以為自己拿到了一份有效的狀態。
 */
export async function atomicWriteFile(filePath: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
	const directory = dirname(filePath);
	const tempPath = `${filePath}.tmp`;
	await mkdir(directory, { recursive: true });
	const handle = await open(tempPath, "w", options.mode);
	try {
		await handle.writeFile(data);
		await handle.sync();
	} finally {
		await handle.close();
	}
	if (options.beforeRename) await options.beforeRename();
	await rename(tempPath, filePath);
	await syncDirectory(directory);
}

/**
 * 目錄本身也要 fsync，否則新的 dentry 可能還沒落地。
 * Windows 不允許對目錄開檔，失敗時忽略即可 —— 那個平台的 rename 本來就是原子的。
 */
async function syncDirectory(directory: string): Promise<void> {
	let handle;
	try {
		handle = await open(directory, "r");
	} catch {
		return;
	}
	try {
		await handle.sync();
	} catch {
		// 某些檔案系統對目錄 fsync 回 EINVAL；資料本身已經 fsync 過，這裡不必升級成錯誤。
	} finally {
		await handle.close();
	}
}

/**
 * 讀取並驗證一個 JSON 狀態檔。
 *
 * 檔案不存在、內容截斷、結構不符都回 `null`，而不是丟例外：
 * 播放器不能因為一個壞掉的狀態檔就開不起來，那台看板會整晚黑著。
 */
export async function readJsonFile<T>(filePath: string, validator: JsonValidator<T>, logger: Logger = silentLogger): Promise<T | null> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		if (isNotFound(error)) return null;
		logger.warn("讀取本機狀態檔失敗", { file: filePath, error: describeError(error) });
		return null;
	}
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch (error) {
		logger.warn("本機狀態檔不是有效的 JSON，已當作不存在處理", { file: filePath, error: describeError(error) });
		return null;
	}
	const parsed = validator.safeParse(payload);
	if (!parsed.success) {
		logger.warn("本機狀態檔結構不符，已當作不存在處理", { file: filePath });
		return null;
	}
	return parsed.data;
}

export function isNotFound(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

/* ── 本機狀態結構 ─────────────────────────────────────────────────────── */

export interface DeviceIdentity {
	deviceId: string;
	deviceName: string;
	serverUrl: string;
	/**
	 * 憑證本體交給 `CredentialStore`（Electron 用 OS 金鑰鏈，模擬裝置用 0600 檔案）。
	 * 這裡只留一個參考名稱，確保一般狀態檔裡永遠不會出現密文。
	 */
	credentialRef: string;
	pairedAt: string;
}

export interface ActivationRecord {
	version: number;
	activatedAt: string;
	layoutRevisionIds: string[];
}

export interface MediaIndexEntry {
	variantId: string;
	assetId: string;
	fileName: string;
	sha256: string;
	sizeBytes: number;
	verifiedAt: string;
}

export interface MediaIndex {
	entries: Record<string, MediaIndexEntry>;
}

export type UnbindReason = "local" | "remote";

export interface UnbindRecord {
	/** 本機已解除綁定，但還沒成功通知伺服器。 */
	revokePending: boolean;
	requestedAt: string;
	reason: UnbindReason;
}

export interface MediaFileInfo {
	fileName: string;
	path: string;
	sizeBytes: number;
	modifiedAtMs: number;
}

/* ── 驗證器 ───────────────────────────────────────────────────────────── */

const identityValidator = jsonValidator<DeviceIdentity>(value => {
	if (!isRecord(value)) return null;
	const { deviceId, deviceName, serverUrl, credentialRef, pairedAt } = value;
	if (!isNonEmptyString(deviceId) || !isNonEmptyString(deviceName) || !isNonEmptyString(serverUrl) || !isNonEmptyString(credentialRef) || !isNonEmptyString(pairedAt)) return null;
	return { deviceId, deviceName, serverUrl, credentialRef, pairedAt };
});

const activationValidator = jsonValidator<ActivationRecord>(value => {
	if (!isRecord(value)) return null;
	const { version, activatedAt, layoutRevisionIds } = value;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
	if (!isNonEmptyString(activatedAt)) return null;
	if (!Array.isArray(layoutRevisionIds) || !layoutRevisionIds.every(isNonEmptyString)) return null;
	return { version, activatedAt, layoutRevisionIds };
});

const mediaIndexValidator = jsonValidator<MediaIndex>(value => {
	if (!isRecord(value)) return null;
	const { entries } = value;
	if (!isRecord(entries)) return null;
	const result: Record<string, MediaIndexEntry> = {};
	for (const [key, candidate] of Object.entries(entries)) {
		if (!isRecord(candidate)) return null;
		const { variantId, assetId, fileName, sha256, sizeBytes, verifiedAt } = candidate;
		if (!isNonEmptyString(variantId) || !isNonEmptyString(assetId) || !isNonEmptyString(fileName) || !isNonEmptyString(sha256) || !isNonEmptyString(verifiedAt)) return null;
		if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
		result[key] = { variantId, assetId, fileName, sha256, sizeBytes, verifiedAt };
	}
	return { entries: result };
});

const unbindValidator = jsonValidator<UnbindRecord>(value => {
	if (!isRecord(value)) return null;
	const { revokePending, requestedAt, reason } = value;
	if (typeof revokePending !== "boolean") return null;
	if (!isNonEmptyString(requestedAt)) return null;
	if (reason !== "local" && reason !== "remote") return null;
	return { revokePending, requestedAt, reason };
});

/* ── 媒體檔名 ─────────────────────────────────────────────────────────── */

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
	"image/gif": ".gif",
	"image/avif": ".avif",
	"text/html": ".html"
};

export function mediaExtension(entry: Pick<AssetManifestEntry, "filename" | "contentType" | "kind">): string {
	const contentType = entry.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	const fromContentType = CONTENT_TYPE_EXTENSIONS[contentType];
	if (fromContentType) return fromContentType;
	const match = /\.([a-zA-Z0-9]{1,8})$/.exec(entry.filename);
	if (match?.[1]) return `.${match[1].toLowerCase()}`;
	if (entry.kind === "video") return ".mp4";
	if (entry.kind === "image") return ".jpg";
	return ".html";
}

/**
 * 播放檔一律以 `<variantId><副檔名>` 落地。
 *
 * 絕不使用伺服器給的 `filename`：那是使用者上傳時打的字，可能含有 `../`、
 * 空白或跟其他素材撞名。variantId 是 UUID，天生唯一且不可能跳出 media 目錄。
 */
export function mediaFileName(entry: Pick<AssetManifestEntry, "variantId" | "filename" | "contentType" | "kind">): string {
	return `${entry.variantId}${mediaExtension(entry)}`;
}

export function partFileName(variantId: string): string {
	return `${variantId}.part`;
}

export function partMetaFileName(variantId: string): string {
	return `${variantId}.part.json`;
}

/* ── DeviceStorage ────────────────────────────────────────────────────── */

export interface DeviceStorageOptions {
	appDataDir: string;
	logger?: Logger;
}

/**
 * 裝置本機狀態的唯一入口。
 *
 * 目錄配置：
 * ```text
 * config/     identity.json
 * state/      desired.json、reported.json、activation.json、media-index.json、unbind.json
 * media/      <variantId>.<ext>、下載中的 <variantId>.part
 * manifests/  active.json、pending.json
 * logs/
 * ```
 */
export class DeviceStorage {
	readonly appDataDir: string;
	readonly configDir: string;
	readonly stateDir: string;
	readonly mediaDir: string;
	readonly manifestsDir: string;
	readonly logsDir: string;

	private readonly logger: Logger;
	/** 多個下載同時完成時會一起改索引，用一條 promise 鏈把寫入序列化，避免互相覆蓋。 */
	private indexWriteChain: Promise<void> = Promise.resolve();

	constructor(options: DeviceStorageOptions) {
		this.appDataDir = options.appDataDir;
		this.configDir = join(options.appDataDir, "config");
		this.stateDir = join(options.appDataDir, "state");
		this.mediaDir = join(options.appDataDir, "media");
		this.manifestsDir = join(options.appDataDir, "manifests");
		this.logsDir = join(options.appDataDir, "logs");
		this.logger = options.logger ?? silentLogger;
	}

	async init(): Promise<void> {
		for (const directory of [this.configDir, this.stateDir, this.mediaDir, this.manifestsDir, this.logsDir]) {
			await mkdir(directory, { recursive: true });
		}
	}

	get identityPath(): string {
		return join(this.configDir, "identity.json");
	}

	get desiredStatePath(): string {
		return join(this.stateDir, "desired.json");
	}

	get reportedStatePath(): string {
		return join(this.stateDir, "reported.json");
	}

	get activationPath(): string {
		return join(this.stateDir, "activation.json");
	}

	get mediaIndexPath(): string {
		return join(this.stateDir, "media-index.json");
	}

	get unbindPath(): string {
		return join(this.stateDir, "unbind.json");
	}

	get activeManifestPath(): string {
		return join(this.manifestsDir, "active.json");
	}

	get pendingManifestPath(): string {
		return join(this.manifestsDir, "pending.json");
	}

	mediaPath(fileName: string): string {
		return join(this.mediaDir, fileName);
	}

	/* 身分 */

	readIdentity(): Promise<DeviceIdentity | null> {
		return readJsonFile(this.identityPath, identityValidator, this.logger);
	}

	writeIdentity(identity: DeviceIdentity): Promise<void> {
		return this.writeJson(this.identityPath, identity);
	}

	clearIdentity(): Promise<void> {
		return rm(this.identityPath, { force: true });
	}

	/* Desired state 與 manifest */

	readDesiredState(): Promise<DesiredState | null> {
		return readJsonFile(this.desiredStatePath, DesiredStateSchema, this.logger);
	}

	writeDesiredState(state: DesiredState): Promise<void> {
		return this.writeJson(this.desiredStatePath, state);
	}

	clearDesiredState(): Promise<void> {
		return rm(this.desiredStatePath, { force: true });
	}

	readActiveManifest(): Promise<DesiredState | null> {
		return readJsonFile(this.activeManifestPath, DesiredStateSchema, this.logger);
	}

	writeActiveManifest(state: DesiredState): Promise<void> {
		return this.writeJson(this.activeManifestPath, state);
	}

	clearActiveManifest(): Promise<void> {
		return rm(this.activeManifestPath, { force: true });
	}

	readPendingManifest(): Promise<DesiredState | null> {
		return readJsonFile(this.pendingManifestPath, DesiredStateSchema, this.logger);
	}

	writePendingManifest(state: DesiredState): Promise<void> {
		return this.writeJson(this.pendingManifestPath, state);
	}

	clearPendingManifest(): Promise<void> {
		return rm(this.pendingManifestPath, { force: true });
	}

	readActivation(): Promise<ActivationRecord | null> {
		return readJsonFile(this.activationPath, activationValidator, this.logger);
	}

	writeActivation(record: ActivationRecord): Promise<void> {
		return this.writeJson(this.activationPath, record);
	}

	clearActivation(): Promise<void> {
		return rm(this.activationPath, { force: true });
	}

	/* Reported state */

	readReportedState(): Promise<ReportedState | null> {
		return readJsonFile(this.reportedStatePath, ReportedStateSchema, this.logger);
	}

	writeReportedState(state: ReportedState): Promise<void> {
		return this.writeJson(this.reportedStatePath, state);
	}

	clearReportedState(): Promise<void> {
		return rm(this.reportedStatePath, { force: true });
	}

	/* 解除綁定 */

	readUnbind(): Promise<UnbindRecord | null> {
		return readJsonFile(this.unbindPath, unbindValidator, this.logger);
	}

	writeUnbind(record: UnbindRecord): Promise<void> {
		return this.writeJson(this.unbindPath, record);
	}

	clearUnbind(): Promise<void> {
		return rm(this.unbindPath, { force: true });
	}

	/* 媒體索引 */

	async readMediaIndex(): Promise<MediaIndex> {
		return (await readJsonFile(this.mediaIndexPath, mediaIndexValidator, this.logger)) ?? { entries: {} };
	}

	/**
	 * 以序列化的方式修改媒體索引。
	 * 下載佇列同時跑好幾個檔案，若各自 read-modify-write 就會互相蓋掉對方剛驗證好的紀錄。
	 */
	updateMediaIndex(mutate: (index: MediaIndex) => void): Promise<void> {
		const next = this.indexWriteChain.then(async () => {
			const index = await this.readMediaIndex();
			mutate(index);
			await this.writeJson(this.mediaIndexPath, index);
		});
		// 一次失敗不能讓整條鏈永遠處於 rejected 狀態，否則之後每個檔案都寫不進索引。
		this.indexWriteChain = next.catch(error => {
			this.logger.warn("寫入媒體索引失敗", { error: describeError(error) });
		});
		return next;
	}

	async clearMediaIndex(): Promise<void> {
		await this.updateMediaIndex(index => {
			index.entries = {};
		});
	}

	/* 媒體檔案 */

	async listMediaFiles(): Promise<MediaFileInfo[]> {
		let names: string[];
		try {
			names = await readdir(this.mediaDir);
		} catch (error) {
			if (isNotFound(error)) return [];
			throw error;
		}
		const files: MediaFileInfo[] = [];
		for (const fileName of names) {
			const path = this.mediaPath(fileName);
			try {
				const info = await stat(path);
				if (!info.isFile()) continue;
				files.push({ fileName, path, sizeBytes: info.size, modifiedAtMs: info.mtimeMs });
			} catch (error) {
				if (!isNotFound(error)) this.logger.warn("讀取媒體檔資訊失敗", { file: fileName, error: describeError(error) });
			}
		}
		return files;
	}

	async mediaFileSize(fileName: string): Promise<number | null> {
		try {
			const info = await stat(this.mediaPath(fileName));
			return info.isFile() ? info.size : null;
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
	}

	async removeMediaFile(fileName: string): Promise<void> {
		await rm(this.mediaPath(fileName), { force: true });
	}

	/** 用在解除綁定：本機不再是任何帳戶的裝置，留著的播放檔沒有任何意義。 */
	async wipeMedia(): Promise<void> {
		for (const file of await this.listMediaFiles()) {
			await rm(file.path, { force: true });
		}
		await this.clearMediaIndex();
	}

	private writeJson(filePath: string, value: unknown): Promise<void> {
		return atomicWriteFile(filePath, `${JSON.stringify(value, null, "\t")}\n`);
	}
}
