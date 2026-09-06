import { z } from "zod";
import { ColorSchema, ExternalUrlSchema, IdSchema, IsoDateTimeSchema } from "./common.js";

/**
 * 分割方向描述的是兩個子區塊「怎麼排」，不是分隔線的方向：
 * - `horizontal`：兩塊水平並排，`first` 在左（行內起點）、`second` 在右。
 * - `vertical`：兩塊垂直堆疊，`first` 在上、`second` 在下。
 */
export const SplitDirectionSchema = z.enum(["horizontal", "vertical"]);
export type SplitDirection = z.infer<typeof SplitDirectionSchema>;

/**
 * 分割比例的下限與上限。
 * 沒有這個限制就會出現 0.001 / 0.999 這種拖不回來的版面。
 */
export const MIN_SPLIT_RATIO = 0.05;
export const MAX_SPLIT_RATIO = 0.95;

export const SplitRatioSchema = z.number().min(MIN_SPLIT_RATIO).max(MAX_SPLIT_RATIO);

export const TextAlignSchema = z.enum(["start", "center", "end"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

export const VerticalAlignSchema = z.enum(["start", "center", "end"]);
export type VerticalAlign = z.infer<typeof VerticalAlignSchema>;

export const ObjectFitSchema = z.enum(["contain", "cover", "fill"]);
export type ObjectFit = z.infer<typeof ObjectFitSchema>;

export const TickerDirectionSchema = z.enum(["left", "right"]);
export type TickerDirection = z.infer<typeof TickerDirectionSchema>;

/** 字型family 固定為 sans-serif，HUAN 不提供字型上傳。 */
const TextStyleSchema = z.object({
	backgroundColor: ColorSchema.default("#00000000"),
	color: ColorSchema.default("#ffffff"),
	fontSize: z.number().min(8).max(400).default(48),
	fontWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]).default(500),
	padding: z.number().min(0).max(400).default(24)
});

export const TextContentSchema = TextStyleSchema.extend({
	type: z.literal("text"),
	text: z.string().max(4000).default(""),
	align: TextAlignSchema.default("center"),
	verticalAlign: VerticalAlignSchema.default("center")
});
export type TextContent = z.infer<typeof TextContentSchema>;

export const TickerContentSchema = TextStyleSchema.extend({
	type: z.literal("ticker"),
	text: z.string().max(4000).default(""),
	direction: TickerDirectionSchema.default("left"),
	/** 每秒移動的設計 px。 */
	speed: z.number().min(10).max(600).default(120),
	/** 兩次重複之間的間距（設計 px）。 */
	gap: z.number().min(0).max(2000).default(160)
});
export type TickerContent = z.infer<typeof TickerContentSchema>;

export const ImageContentSchema = z.object({
	type: z.literal("image"),
	assetId: IdSchema,
	fit: ObjectFitSchema.default("contain"),
	backgroundColor: ColorSchema.default("#00000000")
});
export type ImageContent = z.infer<typeof ImageContentSchema>;

export const VideoContentSchema = z.object({
	type: z.literal("video"),
	assetId: IdSchema,
	fit: ObjectFitSchema.default("contain"),
	loop: z.boolean().default(true),
	muted: z.boolean().default(true),
	/** 0–1。`muted` 為 true 時不生效，但仍會保存，讓使用者取消靜音後回到原本音量。 */
	volume: z.number().min(0).max(1).default(1),
	backgroundColor: ColorSchema.default("#000000")
});
export type VideoContent = z.infer<typeof VideoContentSchema>;

export const UrlContentSchema = z.object({
	type: z.literal("url"),
	url: ExternalUrlSchema
});
export type UrlContent = z.infer<typeof UrlContentSchema>;

export const HtmlContentSchema = z.object({
	type: z.literal("html"),
	assetId: IdSchema
});
export type HtmlContent = z.infer<typeof HtmlContentSchema>;

export const SlotContentSchema = z.discriminatedUnion("type", [TextContentSchema, TickerContentSchema, ImageContentSchema, VideoContentSchema, UrlContentSchema, HtmlContentSchema]);
export type SlotContent = z.infer<typeof SlotContentSchema>;

export const SlotContentTypeSchema = z.enum(["text", "ticker", "image", "video", "url", "html"]);
export type SlotContentType = z.infer<typeof SlotContentTypeSchema>;

export interface SlotNode {
	type: "slot";
	/** 穩定識別字，讓編輯器的選取狀態與拖放目標在重新排列後仍然對得上。 */
	id: string;
	content: SlotContent | null;
}

export interface SplitNode {
	type: "split";
	id: string;
	direction: SplitDirection;
	ratio: number;
	first: LayoutNode;
	second: LayoutNode;
}

export type LayoutNode = SlotNode | SplitNode;

const NodeIdSchema = z.string().min(1).max(64);

export const SlotNodeSchema: z.ZodType<SlotNode> = z.object({
	type: z.literal("slot"),
	id: NodeIdSchema,
	content: SlotContentSchema.nullable()
});

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
	z.union([
		SlotNodeSchema,
		z.object({
			type: z.literal("split"),
			id: NodeIdSchema,
			direction: SplitDirectionSchema,
			ratio: SplitRatioSchema,
			first: LayoutNodeSchema,
			second: LayoutNodeSchema
		})
	])
);

export const LAYOUT_MIN_CANVAS = 240;
export const LAYOUT_MAX_CANVAS = 8192;

export const CanvasSchema = z.object({
	width: z.number().int().min(LAYOUT_MIN_CANVAS).max(LAYOUT_MAX_CANVAS),
	height: z.number().int().min(LAYOUT_MIN_CANVAS).max(LAYOUT_MAX_CANVAS)
});
export type Canvas = z.infer<typeof CanvasSchema>;

export const LayoutBackgroundSchema = z.object({
	color: ColorSchema.default("#000000"),
	imageAssetId: IdSchema.nullable().default(null),
	imageFit: ObjectFitSchema.default("cover")
});
export type LayoutBackground = z.infer<typeof LayoutBackgroundSchema>;

/**
 * 一份完整、可獨立算繪的版面。Admin 預覽與 Device 播放器讀的是同一份文件，
 * 也共用 `@huan/layout-engine` 的幾何計算，因此兩邊的比例一定一致。
 */
export const LayoutDocumentSchema = z.object({
	canvas: CanvasSchema,
	background: LayoutBackgroundSchema,
	/** 區塊之間的間距，單位是設計畫布的 px，會跟著畫布一起等比縮放。 */
	gap: z.number().min(0).max(200).default(0),
	root: LayoutNodeSchema
});
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;

export const LayoutSummarySchema = z.object({
	id: IdSchema,
	name: z.string(),
	description: z.string().nullable(),
	canvas: CanvasSchema,
	publishedRevisionId: IdSchema.nullable(),
	publishedRevisionNumber: z.number().int().nullable(),
	draftUpdatedAt: IsoDateTimeSchema,
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type LayoutSummary = z.infer<typeof LayoutSummarySchema>;

export const LayoutRevisionSchema = z.object({
	id: IdSchema,
	layoutId: IdSchema,
	revisionNumber: z.number().int().min(1),
	document: LayoutDocumentSchema,
	note: z.string().nullable(),
	publishedBy: IdSchema.nullable(),
	publishedAt: IsoDateTimeSchema
});
export type LayoutRevision = z.infer<typeof LayoutRevisionSchema>;

export const LayoutDetailSchema = LayoutSummarySchema.extend({
	draft: LayoutDocumentSchema,
	revisions: z.array(LayoutRevisionSchema.omit({ document: true }))
});
export type LayoutDetail = z.infer<typeof LayoutDetailSchema>;

export const CreateLayoutRequestSchema = z.object({
	name: z.string().min(1, "請輸入版面名稱").max(120),
	description: z.string().max(500).nullable().default(null),
	canvas: CanvasSchema
});
export type CreateLayoutRequest = z.infer<typeof CreateLayoutRequestSchema>;

export const UpdateLayoutDraftRequestSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	description: z.string().max(500).nullable().optional(),
	draft: LayoutDocumentSchema.optional()
});
export type UpdateLayoutDraftRequest = z.infer<typeof UpdateLayoutDraftRequestSchema>;

export const PublishLayoutRequestSchema = z.object({
	note: z.string().max(280).nullable().default(null)
});
export type PublishLayoutRequest = z.infer<typeof PublishLayoutRequestSchema>;
