import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, Sha256Schema } from "./common.js";
import { LayoutDocumentSchema } from "./layout.js";
import { ScheduleManifestEntrySchema } from "./schedule.js";

export const DevicePlatformSchema = z.enum(["linux", "win32", "darwin", "unknown"]);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

export const DeviceArchSchema = z.enum(["x64", "arm64", "arm", "unknown"]);
export type DeviceArch = z.infer<typeof DeviceArchSchema>;

export const DeviceStatusSchema = z.enum(["active", "revoked"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

/**
 * 沒有排程命中、也沒有預設版面時，螢幕上要出現什麼。
 *
 * - `brand`：HUAN 的待命畫面，看得出這台機器是活的、只是沒有內容。
 * - `black`：全黑。現場的看板多半要這個，待命畫面本身也是一種內容。
 * - `image`：指定一張圖片素材（例如公司 logo 牆）。
 */
export const DeviceIdleModeSchema = z.enum(["brand", "black", "image"]);
export type DeviceIdleMode = z.infer<typeof DeviceIdleModeSchema>;

export const DeviceIdleSchema = z.object({
	mode: DeviceIdleModeSchema,
	/** 只有 `mode` 是 `image` 時才有值。這張圖會跟著素材清單一起派送，離線時照樣顯示得出來。 */
	imageAssetId: IdSchema.nullable()
});
export type DeviceIdle = z.infer<typeof DeviceIdleSchema>;

/** 配對碼是 `XXXX-XXXX`，字母表刻意排除 0/O/1/I，避免現場抄錯。 */
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PairingCodeSchema = z
	.string()
	.trim()
	.toUpperCase()
	.transform(value => value.replace(/[^0-9A-Z]/g, ""))
	.pipe(z.string().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/, "配對碼格式不正確"));

export const DisplayInfoSchema = z.object({
	id: z.string(),
	label: z.string(),
	width: z.number().int().min(1),
	height: z.number().int().min(1),
	scaleFactor: z.number().min(0.1).max(8),
	orientation: z.enum(["landscape", "portrait"]),
	primary: z.boolean()
});
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>;

/**
 * Device 定期回報的實際狀態。
 * 取不到的欄位一律回報 `null`，不以假數值填補（例如 Windows 沒有 CPU 溫度）。
 */
export const ReportedStateSchema = z.object({
	desiredVersion: z.number().int().min(0).nullable(),
	appVersion: z.string(),
	protocolVersion: z.number().int(),
	platform: DevicePlatformSchema,
	arch: DeviceArchSchema,
	osVersion: z.string().nullable(),
	displays: z.array(DisplayInfoSchema),
	currentLayoutRevisionId: IdSchema.nullable(),
	currentScheduleId: IdSchema.nullable(),
	readyAssetIds: z.array(IdSchema),
	pendingAssetIds: z.array(IdSchema),
	diskFreeBytes: z.number().int().min(0).nullable(),
	diskTotalBytes: z.number().int().min(0).nullable(),
	temperatureCelsius: z.number().nullable(),
	uptimeSeconds: z.number().int().min(0).nullable(),
	lastSyncAt: IsoDateTimeSchema.nullable(),
	/** 空間不足或寫入失敗時填入，Admin 的裝置頁會直接顯示。 */
	storageError: z.string().nullable()
});
export type ReportedState = z.infer<typeof ReportedStateSchema>;

export const DeviceSchema = z.object({
	id: IdSchema,
	name: z.string(),
	status: DeviceStatusSchema,
	online: z.boolean(),
	defaultLayoutId: IdSchema.nullable(),
	defaultLayoutName: z.string().nullable(),
	idle: DeviceIdleSchema,
	idleImageName: z.string().nullable(),
	desiredVersion: z.number().int().min(0),
	reported: ReportedStateSchema.nullable(),
	lastSeenAt: IsoDateTimeSchema.nullable(),
	pairedAt: IsoDateTimeSchema.nullable(),
	pairedBy: IdSchema.nullable(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type Device = z.infer<typeof DeviceSchema>;

export const UpdateDeviceRequestSchema = z
	.object({
		name: z.string().min(1).max(120).optional(),
		defaultLayoutId: IdSchema.nullable().optional(),
		idleMode: DeviceIdleModeSchema.optional(),
		/** 給 `null` 就是移除待命圖片。換成非 `image` 的模式時 Server 會自己清掉它。 */
		idleImageAssetId: IdSchema.nullable().optional()
	})
	.refine(value => Object.keys(value).length > 0, "至少要修改一個欄位");
export type UpdateDeviceRequest = z.infer<typeof UpdateDeviceRequestSchema>;

/* ── 配對 ─────────────────────────────────────────────────────────────── */

/** Device 端第一步：取得配對碼。此端點不需要驗證，但受速率限制保護。 */
export const StartPairingRequestSchema = z.object({
	deviceName: z.string().min(1).max(120),
	platform: DevicePlatformSchema,
	arch: DeviceArchSchema,
	appVersion: z.string().max(32),
	protocolVersion: z.number().int()
});
export type StartPairingRequest = z.infer<typeof StartPairingRequestSchema>;

export const StartPairingResponseSchema = z.object({
	code: z.string(),
	/** 只有持有這個 token 的 Device 能領取配對結果，避免有人猜到配對碼就搶走憑證。 */
	pairingToken: z.string(),
	expiresAt: IsoDateTimeSchema,
	pairingUrl: z.string()
});
export type StartPairingResponse = z.infer<typeof StartPairingResponseSchema>;

export const PairingStatusResponseSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("pending"), expiresAt: IsoDateTimeSchema }),
	z.object({ status: z.literal("expired") }),
	z.object({
		status: z.literal("paired"),
		deviceId: IdSchema,
		deviceName: z.string(),
		/** 一次性回傳的裝置憑證。Server 只保存雜湊，之後不可能再取得原值。 */
		credential: z.string()
	})
]);
export type PairingStatusResponse = z.infer<typeof PairingStatusResponseSchema>;

/** Admin 端：用配對碼查詢待配對的裝置資訊，讓使用者在綁定前先確認是哪一台。 */
export const PairingLookupResponseSchema = z.object({
	code: z.string(),
	deviceName: z.string(),
	platform: DevicePlatformSchema,
	arch: DeviceArchSchema,
	appVersion: z.string(),
	expiresAt: IsoDateTimeSchema
});
export type PairingLookupResponse = z.infer<typeof PairingLookupResponseSchema>;

export const ConfirmPairingRequestSchema = z.object({
	code: PairingCodeSchema,
	deviceName: z.string().min(1).max(120),
	defaultLayoutId: IdSchema.nullable().default(null)
});
export type ConfirmPairingRequest = z.infer<typeof ConfirmPairingRequestSchema>;

/* ── Desired state ────────────────────────────────────────────────────── */

/**
 * 要下載到 Device 的單一檔案。
 * `downloadPath` 是相對於 API 前綴的資源路徑，Device 用它換取短時效簽章網址；
 * 簽章網址本身不寫進 desired state，因為 desired state 會被快取在本機。
 */
export const AssetManifestEntrySchema = z.object({
	assetId: IdSchema,
	variantId: IdSchema,
	kind: z.enum(["video", "image", "html"]),
	contentType: z.string(),
	filename: z.string(),
	sha256: Sha256Schema,
	sizeBytes: z.number().int().min(0),
	downloadPath: z.string()
});
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const LayoutBundleSchema = z.object({
	layoutId: IdSchema,
	revisionId: IdSchema,
	revisionNumber: z.number().int(),
	name: z.string(),
	document: LayoutDocumentSchema
});
export type LayoutBundle = z.infer<typeof LayoutBundleSchema>;

/**
 * Server 對某台 Device 的完整意圖。Device 只要拿到這份文件就能離線運作：
 * 版面內容、排程規則與所有需要的檔案清單都在裡面。
 */
export const DesiredStateSchema = z.object({
	deviceId: IdSchema,
	version: z.number().int().min(0),
	protocolVersion: z.number().int(),
	issuedAt: IsoDateTimeSchema,
	deviceName: z.string(),
	/** 沒有任何排程命中的時段所播放的版面。為 `null` 時 Device 顯示待命畫面。 */
	defaultLayout: LayoutBundleSchema.nullable(),
	/** 連版面都沒有時的待命畫面設定。`image` 指到的素材一定也在 `assets` 裡。 */
	idle: DeviceIdleSchema,
	layouts: z.array(LayoutBundleSchema),
	schedules: z.array(ScheduleManifestEntrySchema),
	assets: z.array(AssetManifestEntrySchema),
	settings: z.object({
		heartbeatIntervalSeconds: z.number().int().min(10).max(600),
		fallbackSyncIntervalSeconds: z.number().int().min(30).max(3600),
		maxConcurrentDownloads: z.number().int().min(1).max(8)
	})
});
export type DesiredState = z.infer<typeof DesiredStateSchema>;

export const DesiredStateVersionSchema = z.object({
	version: z.number().int().min(0)
});
export type DesiredStateVersion = z.infer<typeof DesiredStateVersionSchema>;

/** Device 完成某個檔案的下載與雜湊驗證後回報。 */
export const AssetAckRequestSchema = z.object({
	assetId: IdSchema,
	variantId: IdSchema,
	sha256: Sha256Schema,
	sizeBytes: z.number().int().min(0)
});
export type AssetAckRequest = z.infer<typeof AssetAckRequestSchema>;

export const HeartbeatRequestSchema = z.object({
	reported: ReportedStateSchema
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
	desiredVersion: z.number().int().min(0),
	serverTime: IsoDateTimeSchema
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const DeviceDownloadUrlResponseSchema = z.object({
	url: z.string(),
	expiresAt: IsoDateTimeSchema,
	sha256: Sha256Schema,
	sizeBytes: z.number().int().min(0)
});
export type DeviceDownloadUrlResponse = z.infer<typeof DeviceDownloadUrlResponseSchema>;

/* ── 指令 ─────────────────────────────────────────────────────────────── */

export const DeviceCommandKindSchema = z.enum(["force_sync", "restart_player", "unbind"]);
export type DeviceCommandKind = z.infer<typeof DeviceCommandKindSchema>;
