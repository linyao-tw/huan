import {
	ASSET_CONTENT_KIND,
	CONTENT_TYPES,
	CONTENT_TYPE_LABELS,
	createAssetContent,
	createPlaylistContent,
	createTextContent,
	createTickerContent,
	createUrlContent,
	describeContent
} from "@/features/layouts/editor/content";
import { ContentForm } from "@/features/layouts/editor/ContentForm";
import "@/features/layouts/layouts.css";
import { AssetPicker } from "@/features/media/AssetPicker";
import { ColorControl } from "@/shared/components/ColorControl";
import { formatDateTime } from "@/shared/utils/format";
import { computeLayoutGeometry, findParentSplit } from "@huan/layout-engine";
import {
	LAYOUT_MAX_CANVAS,
	LAYOUT_MIN_CANVAS,
	MAX_SPLIT_RATIO,
	MIN_SPLIT_RATIO,
	type LayoutDetail,
	type LayoutDocument,
	type MediaAsset,
	type ObjectFit,
	type SlotContent,
	type SlotContentType,
	type SplitDirection
} from "@huan/protocol";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	EmptyState,
	NumberField,
	SectionHeading,
	SegmentedControl,
	SegmentedControlItem,
	Select,
	Separator,
	Tabs,
	TextField,
	TextView
} from "@linyao.tw/ui";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/csr/ArrowsVertical";
import { EraserIcon } from "@phosphor-icons/react/dist/csr/Eraser";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useMemo, useState } from "react";

const FIT_OPTIONS: { value: ObjectFit; label: string }[] = [
	{ value: "cover", label: "填滿裁切" },
	{ value: "contain", label: "完整顯示" },
	{ value: "fill", label: "拉伸變形" }
];

/** 版面層級的欄位與發布紀錄。放在檢視器裡，畫布那一欄才能整片留給畫布。 */
export interface LayoutMeta {
	name: string;
	description: string;
	onNameChange: (value: string) => void;
	onDescriptionChange: (value: string) => void;
	publishedRevisionId: string | null;
	revisions: LayoutDetail["revisions"];
}

export interface InspectorProps {
	document: LayoutDocument;
	assets: MediaAsset[];
	selectedNodeId: string | null;
	meta: LayoutMeta;
	onSplit: (direction: SplitDirection) => void;
	onRemoveSlot: () => void;
	onClearSlot: () => void;
	onContentChange: (content: SlotContent | null) => void;
	onRatioChange: (splitId: string, ratio: number) => void;
	onDirectionChange: (splitId: string, direction: SplitDirection) => void;
	onDocumentChange: (updater: (current: LayoutDocument) => LayoutDocument) => void;
}

export function Inspector({
	document: layoutDocument,
	assets,
	selectedNodeId,
	meta,
	onSplit,
	onRemoveSlot,
	onClearSlot,
	onContentChange,
	onRatioChange,
	onDirectionChange,
	onDocumentChange
}: InspectorProps) {
	/** 已選型別但還沒挑素材時的暫存。綁在節點上，換區塊時就自然失效。 */
	const [pending, setPending] = useState<{ nodeId: string; type: SlotContentType } | null>(null);
	/** 同時間只會開一個素材選擇器，用一個欄位表示比三個布林值好讀。 */
	const [picker, setPicker] = useState<"content" | "playlist" | "background" | null>(null);

	const geometry = useMemo(() => computeLayoutGeometry(layoutDocument), [layoutDocument]);
	const assetNames = useMemo(() => new Map(assets.map(asset => [asset.id, asset.name])), [assets]);
	const imageAssets = useMemo(() => assets.filter(asset => asset.kind === "image"), [assets]);
	const playableAssets = useMemo(() => assets.filter(asset => asset.kind === "image" || asset.kind === "video"), [assets]);
	const backgroundAsset = useMemo(() => assets.find(asset => asset.id === layoutDocument.background.imageAssetId) ?? null, [assets, layoutDocument.background.imageAssetId]);

	const selectedSlot = geometry.slots.find(slot => slot.nodeId === selectedNodeId) ?? null;
	const parent = selectedNodeId ? findParentSplit(layoutDocument.root, selectedNodeId) : null;

	const activeType: SlotContentType | null = selectedSlot?.content?.type ?? (pending?.nodeId === selectedNodeId ? pending.type : null);
	const requiredKind = activeType ? ASSET_CONTENT_KIND[activeType] : undefined;
	const kindAssets = requiredKind ? assets.filter(asset => asset.kind === requiredKind) : assets;

	const applyType = (type: SlotContentType): void => {
		if (!selectedNodeId) return;
		if (type === "text") {
			setPending(null);
			onContentChange(createTextContent());
			return;
		}
		if (type === "ticker") {
			setPending(null);
			onContentChange(createTickerContent());
			return;
		}
		if (type === "url") {
			setPending(null);
			onContentChange(createUrlContent());
			return;
		}
		// 需要素材的型別（含輪播）在挑到素材之前不寫進文件，避免產生不合法的內容。
		setPending({ nodeId: selectedNodeId, type });
		onContentChange(null);
	};

	return (
		<div className="huan-editor__pane huan-editor__pane--inspect">
			<Tabs.Root defaultValue="region">
				<Tabs.List>
					<Tabs.Tab value="region">區塊</Tabs.Tab>
					<Tabs.Tab value="layout">版面</Tabs.Tab>
					<Tabs.Tab value="publish">發布</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="region">
					<div className="huan-stack">
						{!selectedSlot ? (
							<EmptyState title="還沒選到區塊" description="在畫布上點一下任何一塊，就可以在這裡編輯它的內容。" />
						) : (
							<>
								<SectionHeading level={3} size="sm" description={`在畫布上佔 ${Math.round(selectedSlot.width)} × ${Math.round(selectedSlot.height)}`}>
									{describeContent(selectedSlot.content, assetNames)}
								</SectionHeading>

								<div className="huan-stack huan-stack--sm">
									<span className="huan-muted">分割與刪除</span>
									<div className="huan-row huan-row--tight">
										<Button size="sm" variant="secondary" startIcon={<ArrowsHorizontalIcon weight="bold" />} onClick={() => onSplit("horizontal")}>
											水平分割
										</Button>
										<Button size="sm" variant="secondary" startIcon={<ArrowsVerticalIcon weight="bold" />} onClick={() => onSplit("vertical")}>
											垂直分割
										</Button>
									</div>
									<div className="huan-row huan-row--tight">
										<Button size="sm" variant="quiet" startIcon={<EraserIcon weight="bold" />} onClick={onClearSlot} disabled={selectedSlot.content === null}>
											清空內容
										</Button>
										<Button size="sm" variant="danger" startIcon={<TrashIcon weight="bold" />} onClick={onRemoveSlot} disabled={parent === null}>
											刪除分割
										</Button>
									</div>
									{parent === null ? <p className="huan-caption">整個版面只有這一塊，沒辦法刪除；清空內容就會回到空白。</p> : null}
								</div>

								{parent ? (
									<>
										<Separator spacing="sm" />
										<div className="huan-stack huan-stack--sm">
											<span className="huan-muted">跟隔壁的比例</span>
											<NumberField
												label={parent.parent.direction === "horizontal" ? "左邊那塊占的寬度（%）" : "上面那塊占的高度（%）"}
												min={Math.round(MIN_SPLIT_RATIO * 100)}
												max={Math.round(MAX_SPLIT_RATIO * 100)}
												step={1}
												largeStep={5}
												value={Math.round(parent.parent.ratio * 100)}
												onValueChange={value => {
													if (value === null) return;
													onRatioChange(parent.parent.id, value / 100);
												}}
												description="也可以直接拖曳畫布上的分隔線。"
											/>
											<SegmentedControl aria-label="排列方向" size="sm" value={parent.parent.direction} onValueChange={value => value && onDirectionChange(parent.parent.id, value as SplitDirection)}>
												<SegmentedControlItem value="horizontal">左右並排</SegmentedControlItem>
												<SegmentedControlItem value="vertical">上下堆疊</SegmentedControlItem>
											</SegmentedControl>
										</div>
									</>
								) : null}

								<Separator spacing="sm" />

								<Select
									label="內容類型"
									placeholder="選擇要放什麼"
									value={activeType}
									onValueChange={value => value && applyType(value)}
									options={CONTENT_TYPES.map(type => ({ value: type, label: CONTENT_TYPE_LABELS[type] }))}
								/>

								{selectedSlot.content ? (
									<ContentForm key={selectedSlot.nodeId} content={selectedSlot.content} assets={kindAssets} onChange={onContentChange} />
								) : activeType === "playlist" ? (
									playableAssets.length === 0 ? (
										<Alert status="info">
											<AlertTitle>沒有可用的素材</AlertTitle>
											<AlertDescription>素材庫裡還沒有處理完成的圖片或影片。請先去素材庫上傳。</AlertDescription>
										</Alert>
									) : (
										<Button variant="secondary" startIcon={<ImagesSquareIcon weight="bold" />} onClick={() => setPicker("playlist")}>
											挑素材開始編排
										</Button>
									)
								) : activeType && requiredKind ? (
									kindAssets.length === 0 ? (
										<Alert status="info">
											<AlertTitle>沒有可用的素材</AlertTitle>
											<AlertDescription>素材庫裡還沒有處理完成的{CONTENT_TYPE_LABELS[activeType]}。請先去素材庫上傳。</AlertDescription>
										</Alert>
									) : (
										<Button variant="secondary" startIcon={<ImagesSquareIcon weight="bold" />} onClick={() => setPicker("content")}>
											選擇{CONTENT_TYPE_LABELS[activeType]}
										</Button>
									)
								) : null}
							</>
						)}
					</div>
				</Tabs.Panel>

				<Tabs.Panel value="layout">
					<div className="huan-stack">
						<SectionHeading level={3} size="sm" description="這些設定影響整個版面，發布後會同步到所有裝置。">
							版面設定
						</SectionHeading>

						<TextField label="版面名稱" size="sm" value={meta.name} onChange={event => meta.onNameChange(event.target.value)} />
						<TextView label="說明" size="sm" rows={2} value={meta.description} onChange={event => meta.onDescriptionChange(event.target.value)} description="選填，方便日後認出這是哪一個畫面。" />

						<Separator spacing="sm" />

						<div className="huan-field-pair">
							<NumberField
								label="畫布寬（px）"
								min={LAYOUT_MIN_CANVAS}
								max={LAYOUT_MAX_CANVAS}
								step={2}
								value={layoutDocument.canvas.width}
								onValueChange={value => {
									if (value === null) return;
									onDocumentChange(current => ({ ...current, canvas: { ...current.canvas, width: Math.round(value) } }));
								}}
							/>
							<NumberField
								label="畫布高（px）"
								min={LAYOUT_MIN_CANVAS}
								max={LAYOUT_MAX_CANVAS}
								step={2}
								value={layoutDocument.canvas.height}
								onValueChange={value => {
									if (value === null) return;
									onDocumentChange(current => ({ ...current, canvas: { ...current.canvas, height: Math.round(value) } }));
								}}
							/>
						</div>

						<NumberField
							label="區塊之間的間隔（px）"
							min={0}
							max={200}
							step={2}
							value={layoutDocument.gap}
							onValueChange={value => {
								if (value === null) return;
								onDocumentChange(current => ({ ...current, gap: value }));
							}}
							description="間隔從區塊本身扣掉，版面最外圈不會多出留白。"
						/>

						<ColorControl
							label="版面背景色"
							value={layoutDocument.background.color}
							onChange={value => onDocumentChange(current => ({ ...current, background: { ...current.background, color: value } }))}
							description="畫布長寬比跟螢幕不一樣時，四周補上的就是這個顏色。"
						/>

						<div className="huan-stack huan-stack--sm">
							<span className="huan-muted">背景圖片</span>
							<div className="huan-asset-field">
								<span className="huan-asset-field__thumb">
									{backgroundAsset?.thumbnailUrl ? <img src={backgroundAsset.thumbnailUrl} alt="" loading="lazy" /> : <ImagesSquareIcon weight="bold" aria-hidden="true" />}
								</span>
								<span className="huan-asset-field__text huan-truncate">{layoutDocument.background.imageAssetId === null ? "不使用背景圖片" : (backgroundAsset?.name ?? "素材已不存在")}</span>
								<Button size="sm" variant="secondary" disabled={imageAssets.length === 0} onClick={() => setPicker("background")}>
									{layoutDocument.background.imageAssetId === null ? "選一張" : "換一張"}
								</Button>
							</div>
							{imageAssets.length === 0 ? <span className="huan-caption">素材庫裡還沒有處理完成的圖片。</span> : null}
						</div>

						{layoutDocument.background.imageAssetId ? (
							<>
								<Select
									label="背景圖片縮放"
									value={layoutDocument.background.imageFit}
									onValueChange={value => value && onDocumentChange(current => ({ ...current, background: { ...current.background, imageFit: value } }))}
									options={FIT_OPTIONS}
								/>
								<Button size="sm" variant="quiet" onClick={() => onDocumentChange(current => ({ ...current, background: { ...current.background, imageAssetId: null } }))}>
									移除背景圖片
								</Button>
							</>
						) : null}
					</div>
				</Tabs.Panel>

				<Tabs.Panel value="publish">
					<div className="huan-stack">
						<SectionHeading level={3} size="sm" description="裝置只會播已發布的版本，草稿改再多都不會影響現場。">
							發布紀錄
						</SectionHeading>

						{meta.revisions.length === 0 ? (
							<p className="huan-muted">還沒有發布過。按右上角的「發布」就會送到裝置上。</p>
						) : (
							<ul className="huan-revision-list">
								{meta.revisions.map(revision => (
									<li key={revision.id} className="huan-revision">
										<span className="huan-row huan-row--tight">
											<Badge variant={revision.id === meta.publishedRevisionId ? "success" : "neutral"} size="sm">
												第 {revision.revisionNumber} 版
											</Badge>
											<span className="huan-caption">{revision.note ?? "（沒有備註）"}</span>
										</span>
										<span className="huan-caption huan-numeric">{formatDateTime(revision.publishedAt)}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</Tabs.Panel>
			</Tabs.Root>

			<AssetPicker
				open={picker === "content"}
				onOpenChange={open => setPicker(open ? "content" : null)}
				title={activeType ? `選擇${CONTENT_TYPE_LABELS[activeType]}` : "選擇素材"}
				kinds={requiredKind ? [requiredKind] : ["image", "video", "html"]}
				onConfirm={picked => {
					const asset = picked[0];
					if (!asset || !activeType) return;
					onContentChange(createAssetContent(activeType as "image" | "video" | "html", asset.id));
					setPending(null);
				}}
			/>

			<AssetPicker
				open={picker === "playlist"}
				onOpenChange={open => setPicker(open ? "playlist" : null)}
				title="挑輪播要播的素材"
				description="可以一次勾很多個，也可以把整個資料夾一次加進來。順序之後還能調整。"
				kinds={["image", "video"]}
				multiple
				confirmLabel="建立輪播"
				onConfirm={picked => {
					const content = createPlaylistContent(picked);
					if (!content) return;
					onContentChange(content);
					setPending(null);
				}}
			/>

			<AssetPicker
				open={picker === "background"}
				onOpenChange={open => setPicker(open ? "background" : null)}
				title="版面背景圖片"
				kinds={["image"]}
				initialSelectedIds={layoutDocument.background.imageAssetId ? [layoutDocument.background.imageAssetId] : []}
				onConfirm={picked => {
					const asset = picked[0];
					if (!asset) return;
					onDocumentChange(current => ({ ...current, background: { ...current.background, imageAssetId: asset.id } }));
				}}
			/>
		</div>
	);
}
