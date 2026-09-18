import {
	HtmlContentSchema,
	ImageContentSchema,
	PlaylistContentSchema,
	TextContentSchema,
	TickerContentSchema,
	UrlContentSchema,
	VideoContentSchema,
	type MediaAsset,
	type MediaKind,
	type PlaylistItem,
	type SlotContent,
	type SlotContentType
} from "@huan/protocol";

export const CONTENT_TYPE_LABELS: Record<SlotContentType, string> = {
	text: "文字",
	ticker: "跑馬燈",
	image: "圖片",
	video: "影片",
	playlist: "媒體輪播",
	url: "網頁（URL）",
	html: "HTML 素材"
};

export const CONTENT_TYPES: SlotContentType[] = ["text", "ticker", "image", "video", "playlist", "url", "html"];

/** 需要素材的內容類型；選這些之前必須先指定素材，否則文件會處於不合法狀態。 */
export const ASSET_CONTENT_KIND: Partial<Record<SlotContentType, MediaKind>> = { image: "image", video: "video", html: "html" };

/** 新增網頁區塊時的預設網址。ExternalUrlSchema 不接受空字串，因此必須是一個合法且無害的位址。 */
export const PLACEHOLDER_URL = "https://example.com";

export function createTextContent(): SlotContent {
	return TextContentSchema.parse({ type: "text", text: "在這裡輸入文字" });
}

export function createTickerContent(): SlotContent {
	return TickerContentSchema.parse({ type: "ticker", text: "跑馬燈訊息" });
}

export function createUrlContent(url: string = PLACEHOLDER_URL): SlotContent {
	return UrlContentSchema.parse({ type: "url", url });
}

export function createAssetContent(type: "image" | "video" | "html", assetId: string): SlotContent {
	if (type === "image") return ImageContentSchema.parse({ type: "image", assetId });
	if (type === "video") return VideoContentSchema.parse({ type: "video", assetId });
	return HtmlContentSchema.parse({ type: "html", assetId });
}

/** 只有圖片與影片能放進輪播，用素材種類決定該建哪一種項目。 */
export function playlistItemForAsset(asset: Pick<MediaAsset, "id" | "kind">): PlaylistItem | null {
	if (asset.kind !== "image" && asset.kind !== "video") return null;
	return { assetId: asset.id, kind: asset.kind };
}

/** 用一批素材開一個新的輪播；停留秒數整份共用，後續增刪在內容表單裡進行。 */
export function createPlaylistContent(assets: readonly Pick<MediaAsset, "id" | "kind">[]): SlotContent | null {
	const items = assets.map(playlistItemForAsset).filter((item): item is PlaylistItem => item !== null);
	if (items.length === 0) return null;
	return PlaylistContentSchema.parse({ type: "playlist", items });
}

/** 從素材庫拖進區塊時，用素材本身的種類決定內容型別。 */
export function contentForAsset(asset: Pick<MediaAsset, "id" | "kind">): SlotContent {
	if (asset.kind === "image") return createAssetContent("image", asset.id);
	if (asset.kind === "video") return createAssetContent("video", asset.id);
	return createAssetContent("html", asset.id);
}

export function describeContent(content: SlotContent | null, assetNames: Map<string, string>): string {
	if (!content) return "空白區塊";
	switch (content.type) {
		case "text":
			return content.text.trim().length > 0 ? `文字：${content.text.slice(0, 24)}` : "文字（尚未輸入）";
		case "ticker":
			return content.text.trim().length > 0 ? `跑馬燈：${content.text.slice(0, 24)}` : "跑馬燈（尚未輸入）";
		case "url":
			return `網頁：${content.url}`;
		case "playlist":
			return `媒體輪播：${content.items.length} 則`;
		default:
			return `${CONTENT_TYPE_LABELS[content.type]}：${assetNames.get(content.assetId) ?? "素材已不存在"}`;
	}
}

export const DRAG_MEDIA_TYPE = "application/x-huan-media";
export const DRAG_SLOT_TYPE = "application/x-huan-slot";
