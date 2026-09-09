import {
	ASSET_CONTENT_KIND,
	CONTENT_TYPES,
	CONTENT_TYPE_LABELS,
	createAssetContent,
	createTextContent,
	createTickerContent,
	createUrlContent,
	describeContent
} from "@/features/layouts/editor/content";
import { ContentForm } from "@/features/layouts/editor/ContentForm";
import "@/features/layouts/layouts.css";
import { ColorControl } from "@/shared/components/ColorControl";
import { computeLayoutGeometry, findParentSplit } from "@huan/layout-engine";
import {
	LAYOUT_MAX_CANVAS,
	LAYOUT_MIN_CANVAS,
	MAX_SPLIT_RATIO,
	MIN_SPLIT_RATIO,
	type LayoutDocument,
	type MediaAsset,
	type ObjectFit,
	type SlotContent,
	type SlotContentType,
	type SplitDirection
} from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, EmptyState, NumberField, SectionHeading, SegmentedControl, SegmentedControlItem, Select, Separator, Tabs } from "@linyao.tw/ui";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/csr/ArrowsVertical";
import { EraserIcon } from "@phosphor-icons/react/dist/csr/Eraser";
import { SwapIcon } from "@phosphor-icons/react/dist/csr/Swap";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useMemo, useState } from "react";

const FIT_OPTIONS: { value: ObjectFit; label: string }[] = [
	{ value: "cover", label: "填滿裁切" },
	{ value: "contain", label: "完整顯示" },
	{ value: "fill", label: "拉伸變形" }
];

export interface InspectorProps {
	document: LayoutDocument;
	assets: MediaAsset[];
	selectedNodeId: string | null;
	onSplit: (direction: SplitDirection) => void;
	onRemoveSlot: () => void;
	onClearSlot: () => void;
	onSwapWith: (targetSlotId: string) => void;
	onContentChange: (content: SlotContent | null) => void;
	onRatioChange: (splitId: string, ratio: number) => void;
	onDirectionChange: (splitId: string, direction: SplitDirection) => void;
	onDocumentChange: (updater: (current: LayoutDocument) => LayoutDocument) => void;
}

export function Inspector({
	document: layoutDocument,
	assets,
	selectedNodeId,
	onSplit,
	onRemoveSlot,
	onClearSlot,
	onSwapWith,
	onContentChange,
	onRatioChange,
	onDirectionChange,
	onDocumentChange
}: InspectorProps) {
	/** 已選型別但還沒挑素材時的暫存。綁在節點上，換區塊時就自然失效。 */
	const [pending, setPending] = useState<{ nodeId: string; type: SlotContentType } | null>(null);
	const [swapTarget, setSwapTarget] = useState<string | null>(null);

	const geometry = useMemo(() => computeLayoutGeometry(layoutDocument), [layoutDocument]);
	const assetNames = useMemo(() => new Map(assets.map(asset => [asset.id, asset.name])), [assets]);
	const imageAssets = useMemo(() => assets.filter(asset => asset.kind === "image"), [assets]);

	const selectedSlot = geometry.slots.find(slot => slot.nodeId === selectedNodeId) ?? null;
	const parent = selectedNodeId ? findParentSplit(layoutDocument.root, selectedNodeId) : null;
	const otherSlots = geometry.slots.filter(slot => slot.nodeId !== selectedNodeId);
	// 換了選取區塊之後，上一次挑的交換目標可能已經不存在，也不該沿用。
	const validSwapTarget = otherSlots.some(slot => slot.nodeId === swapTarget) ? swapTarget : null;

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
		// 需要素材的型別在挑到素材之前不寫進文件，避免產生沒有 assetId 的不合法內容。
		setPending({ nodeId: selectedNodeId, type });
		onContentChange(null);
	};

	return (
		<div className="huan-editor__pane">
			<Tabs.Root defaultValue="region">
				<Tabs.List>
					<Tabs.Tab value="region">區塊</Tabs.Tab>
					<Tabs.Tab value="layout">版面</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="region">
					<div className="huan-stack">
						{!selectedSlot ? (
							<EmptyState title="尚未選取區塊" description="在畫布上點一下任何區塊，或用 Tab 移動焦點，就可以在這裡編輯它的內容。" />
						) : (
							<>
								<SectionHeading level={3} size="sm" description={`${Math.round(selectedSlot.width)} × ${Math.round(selectedSlot.height)} 設計 px`}>
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
									{parent === null ? <p className="huan-caption">這是版面唯一的區塊，無法刪除；清空內容即可回到空白狀態。</p> : null}
								</div>

								{parent ? (
									<>
										<Separator spacing="sm" />
										<div className="huan-stack huan-stack--sm">
											<span className="huan-muted">與相鄰區塊的比例</span>
											<NumberField
												label="這一組分割的第一塊占比（%）"
												min={Math.round(MIN_SPLIT_RATIO * 100)}
												max={Math.round(MAX_SPLIT_RATIO * 100)}
												step={1}
												largeStep={5}
												value={Math.round(parent.parent.ratio * 100)}
												onValueChange={value => {
													if (value === null) return;
													onRatioChange(parent.parent.id, value / 100);
												}}
												description="也可以直接拖曳畫布上的分隔線，或用方向鍵調整（按住 Shift 一次 5%）。"
											/>
											<SegmentedControl aria-label="分割方向" size="sm" value={parent.parent.direction} onValueChange={value => value && onDirectionChange(parent.parent.id, value as SplitDirection)}>
												<SegmentedControlItem value="horizontal">左右並排</SegmentedControlItem>
												<SegmentedControlItem value="vertical">上下堆疊</SegmentedControlItem>
											</SegmentedControl>
										</div>
									</>
								) : null}

								{otherSlots.length > 0 ? (
									<>
										<Separator spacing="sm" />
										<div className="huan-stack huan-stack--sm">
											<span className="huan-muted">交換內容</span>
											<Select
												label="與哪一個區塊交換"
												placeholder="選擇目標區塊"
												value={validSwapTarget}
												onValueChange={value => setSwapTarget(value)}
												options={otherSlots.map(slot => ({ value: slot.nodeId, label: describeContent(slot.content, assetNames) }))}
											/>
											<Button
												size="sm"
												variant="secondary"
												startIcon={<SwapIcon weight="bold" />}
												disabled={validSwapTarget === null}
												onClick={() => {
													if (validSwapTarget) onSwapWith(validSwapTarget);
												}}
											>
												交換兩個區塊的內容
											</Button>
											<p className="huan-caption">在畫布上把一個區塊拖到另一個區塊也會交換內容，這裡是鍵盤操作的等價做法。</p>
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
								) : activeType && requiredKind ? (
									kindAssets.length === 0 ? (
										<Alert status="info">
											<AlertTitle>沒有可用的素材</AlertTitle>
											<AlertDescription>素材庫裡還沒有轉檔完成的{CONTENT_TYPE_LABELS[activeType]}。請先到素材庫上傳。</AlertDescription>
										</Alert>
									) : (
										<Select
											label={`選擇${CONTENT_TYPE_LABELS[activeType]}`}
											placeholder="挑一個素材"
											value={null}
											onValueChange={value => {
												if (!value) return;
												onContentChange(createAssetContent(activeType as "image" | "video" | "html", value));
												setPending(null);
											}}
											options={kindAssets.map(asset => ({ value: asset.id, label: asset.name }))}
										/>
									)
								) : null}
							</>
						)}
					</div>
				</Tabs.Panel>

				<Tabs.Panel value="layout">
					<div className="huan-stack">
						<SectionHeading level={3} size="sm" description="這些設定會影響整份版面，發布後同步到所有裝置。">
							版面設定
						</SectionHeading>

						<div className="huan-row">
							<NumberField
								className="huan-grow"
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
								className="huan-grow"
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
							label="區塊間距（設計 px）"
							min={0}
							max={200}
							step={2}
							value={layoutDocument.gap}
							onValueChange={value => {
								if (value === null) return;
								onDocumentChange(current => ({ ...current, gap: value }));
							}}
							description="間距是從可用空間裡扣掉的，因此區塊外緣永遠貼齊畫布邊界。"
						/>

						<ColorControl
							label="版面背景色"
							value={layoutDocument.background.color}
							onChange={value => onDocumentChange(current => ({ ...current, background: { ...current.background, color: value } }))}
							description="畫布長寬比與螢幕不同時，四周留白也會是這個顏色。"
						/>

						<Select
							label="背景圖片"
							placeholder="不使用背景圖片"
							value={layoutDocument.background.imageAssetId}
							onValueChange={value => onDocumentChange(current => ({ ...current, background: { ...current.background, imageAssetId: value } }))}
							options={imageAssets.map(asset => ({ value: asset.id, label: asset.name }))}
							description={imageAssets.length === 0 ? "素材庫裡還沒有轉檔完成的圖片。" : undefined}
						/>

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
			</Tabs.Root>
		</div>
	);
}
