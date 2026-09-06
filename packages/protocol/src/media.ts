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
 *
 * ready → needs_reupload   （播放版本已被回收，且來源檔已刪除）
 * ```
 */
export const MediaStatusSchema = z.enum(["uploading", "uploaded", "processing", "ready", "failed", "needs_reupload"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/**
 * 每個素材會產生數種產物：
 * - `original`：使用者上傳的原始檔，轉檔成功後即刪除，不長期保存。
 * - `thumbnail`：素材庫縮圖，長期保留。
 * - `preview`：Admin 排版預覽用的小尺寸版本，長期保留。
 * - `playback`：實際派送到 Device 播放的版本；所有目標 Device 完成 ACK 並經過保留期後會被回收。
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
	sizeBytes: z.number().int().min(1).max(MEDIA_MAX_UPLOAD_BYTES)
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

export const MediaListQuerySchema = z.object({
	kind: MediaKindSchema.optional(),
	status: MediaStatusSchema.optional(),
	search: z.string().max(120).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});
export type MediaListQuery = z.infer<typeof MediaListQuerySchema>;
