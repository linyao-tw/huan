import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, Sha256Schema } from "./common.js";

/** HUAN 只接收這三種需要上傳檔案的素材。文字與網址直接寫在版面設定裡，不佔用素材庫。 */
export const MediaKindSchema = z.enum(["video", "image", "html"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/**
 * 素材狀態機。
 *
 * ```text
 * uploading → uploaded → processing → ready
 *                            ↓
 *                          failed
 * ```
 *
 * `needs_reupload` 是舊資料才會有的狀態：播放產物曾經在所有裝置 ACK 後被回收。
 * 現在 playback 與 preview 長期留在 RustFS，不會再有新的素材落到這個狀態。
 */
export const MediaStatusSchema = z.enum(["uploading", "uploaded", "processing", "ready", "failed", "needs_reupload"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/**
 * 每個素材會產生數種產物：
 * - `original`：使用者上傳的原始檔，轉檔成功後即刪除，不長期保存。
 * - `thumbnail`：素材庫縮圖，長期保留。
 * - `preview`：Admin 排版預覽用的小尺寸版本，長期保留。
 * - `playback`：實際派送到 Device 播放的版本，長期保留。
 */
export const MediaVariantRoleSchema = z.enum(["original", "thumbnail", "preview", "playback"]);
export type MediaVariantRole = z.infer<typeof MediaVariantRoleSchema>;

export const MediaProbeSchema = z.object({
	durationMs: z.number().int().min(0).nullable(),
	width: z.number().int().min(0).nullable(),
	height: z.number().int().min(0).nullable(),
	videoCodec: z.string().nullable(),
	audioCodec: z.string().nullable(),
	frameRate: z.number().min(0).nullable(),
	hasAlpha: z.boolean().nullable()
});
export type MediaProbe = z.infer<typeof MediaProbeSchema>;

export const MediaVariantSchema = z.object({
	id: IdSchema,
	assetId: IdSchema,
	role: MediaVariantRoleSchema,
	contentType: z.string(),
	sizeBytes: z.number().int().min(0),
	sha256: Sha256Schema.nullable(),
	width: z.number().int().min(0).nullable(),
	height: z.number().int().min(0).nullable(),
	durationMs: z.number().int().min(0).nullable(),
	/** `false` 代表物件已從 RustFS 回收；資料列保留下來，讓 UI 能解釋素材為什麼需要重新上傳。 */
	available: z.boolean(),
	createdAt: IsoDateTimeSchema
});
export type MediaVariant = z.infer<typeof MediaVariantSchema>;

export const MediaUsageSchema = z.object({
	layouts: z.array(z.object({ id: IdSchema, name: z.string(), published: z.boolean() })),
	schedules: z.array(z.object({ id: IdSchema, name: z.string() })),
	devices: z.array(z.object({ id: IdSchema, name: z.string() }))
});
export type MediaUsage = z.infer<typeof MediaUsageSchema>;

export const MediaAssetSchema = z.object({
	id: IdSchema,
	kind: MediaKindSchema,
	name: z.string(),
	/** `null` 代表放在素材庫的最上層，不屬於任何資料夾。 */
	folderId: IdSchema.nullable(),
	originalFilename: z.string(),
	status: MediaStatusSchema,
	/** 面向使用者的失敗說明。Worker 的完整指令與檔案路徑只留在伺服器日誌。 */
	errorMessage: z.string().nullable(),
	probe: MediaProbeSchema.nullable(),
	variants: z.array(MediaVariantSchema),
	thumbnailUrl: z.string().nullable(),
	previewUrl: z.string().nullable(),
	createdBy: IdSchema.nullable(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const MEDIA_MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export const MEDIA_ACCEPTED_CONTENT_TYPES: Record<MediaKind, readonly string[]> = {
	video: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/mpeg", "video/x-msvideo"],
	image: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
	html: ["text/html"]
} as const;

/** 上傳第一步：向 Server 換取直傳 RustFS 的授權。原始檔不經過 Fastify。 */
export const CreateUploadRequestSchema = z.object({
	kind: MediaKindSchema,
	name: z.string().min(1, "請輸入素材名稱").max(120),
	filename: z.string().min(1).max(255),
	contentType: z.string().min(1).max(160),
	sizeBytes: z.number().int().min(1).max(MEDIA_MAX_UPLOAD_BYTES),
	/** 要傳進哪個資料夾。`null` 是素材庫最上層。 */
	folderId: IdSchema.nullable().default(null)
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

export const CreateUploadResponseSchema = z.object({
	assetId: IdSchema,
	uploadUrl: z.string(),
	/** 瀏覽器直傳時必須原封不動送出的標頭，例如 `Content-Type`。 */
	headers: z.record(z.string(), z.string()),
	expiresAt: IsoDateTimeSchema
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

/** 上傳第二步：瀏覽器完成 PUT 後通知 Server，Server 驗證物件存在並排入轉檔工作。 */
export const CompleteUploadRequestSchema = z.object({
	assetId: IdSchema
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

export const UpdateMediaRequestSchema = z.object({
	name: z.string().min(1).max(120)
});
export type UpdateMediaRequest = z.infer<typeof UpdateMediaRequestSchema>;

/**
 * 「最上層」在查詢字串裡的寫法。
 *
 * 不能用空字串或省略參數表示：那兩者都已經是「不限資料夾」的意思，而瀏覽資料夾時
 * 需要能明確要求「只要沒有資料夾的素材」。
 */
export const MEDIA_ROOT_FOLDER = "root";

export const MediaFolderFilterSchema = z.union([z.literal(MEDIA_ROOT_FOLDER), IdSchema]);

export const MediaListQuerySchema = z.object({
	kind: MediaKindSchema.optional(),
	status: MediaStatusSchema.optional(),
	search: z.string().max(120).optional(),
	/** 省略代表不分資料夾（搜尋整個素材庫），`root` 代表只要最上層。 */
	folderId: MediaFolderFilterSchema.optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});
export type MediaListQuery = z.infer<typeof MediaListQuerySchema>;

/* ── 資料夾 ───────────────────────────────────────────────────────────── */

/**
 * 巢狀深度上限。
 *
 * 限制的理由不是資料庫，是麵包屑：再深下去，使用者在畫面上就看不出自己在哪裡，
 * 而「把資料夾拖進自己的子資料夾」這種操作也會越來越難解釋。
 */
export const MEDIA_FOLDER_MAX_DEPTH = 8;

export const MediaFolderNameSchema = z.string().trim().min(1, "請輸入資料夾名稱").max(80);

export const MediaFolderSchema = z.object({
	id: IdSchema,
	name: z.string(),
	parentId: IdSchema.nullable(),
	/** 直接放在這個資料夾裡的素材數，不含子資料夾。刪除前的檢查與列表上的數字都看它。 */
	assetCount: z.number().int().min(0),
	childCount: z.number().int().min(0),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type MediaFolder = z.infer<typeof MediaFolderSchema>;

export const CreateMediaFolderRequestSchema = z.object({
	name: MediaFolderNameSchema,
	parentId: IdSchema.nullable().default(null)
});
export type CreateMediaFolderRequest = z.infer<typeof CreateMediaFolderRequestSchema>;

export const UpdateMediaFolderRequestSchema = z
	.object({
		name: MediaFolderNameSchema.optional(),
		/** 給 `null` 就是搬到最上層；省略代表不動它的位置。 */
		parentId: IdSchema.nullable().optional()
	})
	.refine(value => Object.keys(value).length > 0, "至少要修改一個欄位");
export type UpdateMediaFolderRequest = z.infer<typeof UpdateMediaFolderRequestSchema>;

/** 一次搬移多個素材。搬一個只是長度為 1 的特例，不另外開端點。 */
export const MoveMediaRequestSchema = z.object({
	assetIds: z.array(IdSchema).min(1).max(200),
	folderId: IdSchema.nullable()
});
export type MoveMediaRequest = z.infer<typeof MoveMediaRequestSchema>;
