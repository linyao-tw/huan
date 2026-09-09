import { DRAG_MEDIA_TYPE, DRAG_SLOT_TYPE, describeContent } from "@/features/layouts/editor/content";
import { ratioFromClientPoint, ratioFromKeyboard, type CanvasProjection } from "@/features/layouts/editor/ratio";
import { SlotPreview } from "@/features/layouts/editor/SlotPreview";
import "@/features/layouts/layouts.css";
import { computeFitTransform, computeLayoutGeometry, type DividerRect } from "@huan/layout-engine";
import type { LayoutDocument, MediaAsset } from "@huan/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const MIN_DIVIDER_HIT_PX = 14;

export interface LayoutCanvasProps {
	document: LayoutDocument;
	assets: Map<string, MediaAsset>;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string) => void;
	onRatioChange: (nodeId: string, ratio: number, coalesceKey?: string) => void;
	onDropAsset: (slotId: string, assetId: string) => void;
	onSwapSlots: (sourceSlotId: string, targetSlotId: string) => void;
}

interface DropState {
	nodeId: string;
	mode: "fill" | "swap";
}

function useViewportSize(ref: RefObject<HTMLDivElement | null>): { width: number; height: number } {
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(entries => {
			const entry = entries[0];
			if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
		});
		observer.observe(element);
		const rect = element.getBoundingClientRect();
		setSize({ width: rect.width, height: rect.height });
		return () => observer.disconnect();
	}, [ref]);

	return size;
}

export function LayoutCanvas({ document: layoutDocument, assets, selectedNodeId, onSelectNode, onRatioChange, onDropAsset, onSwapSlots }: LayoutCanvasProps) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const viewport = useViewportSize(viewportRef);
	const [dropState, setDropState] = useState<DropState | null>(null);
	const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

	// 幾何完全交給 @huan/layout-engine：後台與播放器讀同一份計算，比例不可能對不上。
	const geometry = useMemo(() => computeLayoutGeometry(layoutDocument), [layoutDocument]);
	const fit = useMemo(() => computeFitTransform(layoutDocument.canvas, viewport), [layoutDocument.canvas, viewport]);

	const assetNames = useMemo(() => new Map([...assets.values()].map(asset => [asset.id, asset.name])), [assets]);

	const projection = useCallback((): CanvasProjection => {
		const rect = viewportRef.current?.getBoundingClientRect();
		return { scale: fit.scale, offsetX: fit.offsetX, offsetY: fit.offsetY, originX: rect?.left ?? 0, originY: rect?.top ?? 0 };
	}, [fit]);

	const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>, divider: DividerRect): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		const target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		target.dataset.dragging = "true";

		const coalesceKey = `ratio:${divider.nodeId}:${event.pointerId}`;
		const move = (moveEvent: PointerEvent): void => {
			const ratio = ratioFromClientPoint({ divider, gap: layoutDocument.gap, projection: projection(), clientX: moveEvent.clientX, clientY: moveEvent.clientY, snap: !moveEvent.altKey });
			onRatioChange(divider.nodeId, ratio, coalesceKey);
		};
		const up = (): void => {
			target.dataset.dragging = "false";
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
		};

		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	};

	const background = layoutDocument.background;
	const backgroundAsset = background.imageAssetId ? assets.get(background.imageAssetId) : undefined;

	return (
		// 視窗用版面自己的長寬比，直式看板才不會被固定的 16:9 浪費掉大半面積。
		<div className="huan-canvas-viewport" ref={viewportRef} style={{ ["--huan-canvas-ratio" as string]: `${layoutDocument.canvas.width} / ${layoutDocument.canvas.height}` }}>
			<div
				className="huan-canvas-stage"
				role="group"
				aria-label={`版面畫布 ${layoutDocument.canvas.width} × ${layoutDocument.canvas.height}`}
				style={{ left: `${fit.offsetX}px`, top: `${fit.offsetY}px`, width: `${fit.width}px`, height: `${fit.height}px`, background: background.color }}
			>
				{backgroundAsset?.previewUrl ? <img src={backgroundAsset.previewUrl} alt="" className="huan-preview-media" style={{ position: "absolute", inset: 0, objectFit: background.imageFit }} /> : null}

				{geometry.slots.map(slot => {
					const isSelected = slot.nodeId === selectedNodeId;
					const drop = dropState?.nodeId === slot.nodeId ? dropState.mode : undefined;
					return (
						<div
							key={slot.nodeId}
							className="huan-canvas-slot"
							style={{ left: `${slot.x * fit.scale}px`, top: `${slot.y * fit.scale}px`, width: `${slot.width * fit.scale}px`, height: `${slot.height * fit.scale}px` }}
						>
							<div className="huan-canvas-slot__content">
								<SlotPreview content={slot.content} assets={assets} scale={fit.scale} />
							</div>

							<button
								type="button"
								className="huan-canvas-slot__hit"
								data-selected={isSelected}
								data-drop={drop}
								aria-pressed={isSelected}
								aria-label={`區塊：${describeContent(slot.content, assetNames)}`}
								draggable={slot.content !== null}
								onClick={() => onSelectNode(slot.nodeId)}
								onFocus={() => onSelectNode(slot.nodeId)}
								onDragStart={(event: DragEvent<HTMLButtonElement>) => {
									event.dataTransfer.setData(DRAG_SLOT_TYPE, slot.nodeId);
									event.dataTransfer.effectAllowed = "move";
									setDraggingNodeId(slot.nodeId);
								}}
								onDragEnd={() => {
									setDraggingNodeId(null);
									setDropState(null);
								}}
								onDragOver={(event: DragEvent<HTMLButtonElement>) => {
									const types = event.dataTransfer.types;
									if (types.includes(DRAG_MEDIA_TYPE)) {
										event.preventDefault();
										event.dataTransfer.dropEffect = "copy";
										setDropState({ nodeId: slot.nodeId, mode: "fill" });
										return;
									}
									if (types.includes(DRAG_SLOT_TYPE) && draggingNodeId !== slot.nodeId) {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										setDropState({ nodeId: slot.nodeId, mode: "swap" });
									}
								}}
								onDragLeave={() => setDropState(current => (current?.nodeId === slot.nodeId ? null : current))}
								onDrop={(event: DragEvent<HTMLButtonElement>) => {
									event.preventDefault();
									setDropState(null);
									const assetId = event.dataTransfer.getData(DRAG_MEDIA_TYPE);
									if (assetId) {
										onDropAsset(slot.nodeId, assetId);
										onSelectNode(slot.nodeId);
										return;
									}
									const sourceSlotId = event.dataTransfer.getData(DRAG_SLOT_TYPE);
									if (sourceSlotId && sourceSlotId !== slot.nodeId) onSwapSlots(sourceSlotId, slot.nodeId);
								}}
							/>

							{drop ? <span className="huan-canvas-slot__badge">{drop === "swap" ? "放開以交換內容" : "放開以填入素材"}</span> : null}
						</div>
					);
				})}

				{geometry.dividers.map(divider => {
					const horizontal = divider.direction === "horizontal";
					const centerX = (divider.x + divider.width / 2) * fit.scale;
					const centerY = (divider.y + divider.height / 2) * fit.scale;
					const hitWidth = horizontal ? Math.max(divider.width * fit.scale, MIN_DIVIDER_HIT_PX) : divider.width * fit.scale;
					const hitHeight = horizontal ? divider.height * fit.scale : Math.max(divider.height * fit.scale, MIN_DIVIDER_HIT_PX);

					return (
						<div
							key={divider.nodeId}
							className="huan-canvas-divider"
							role="separator"
							tabIndex={0}
							data-direction={divider.direction}
							data-dragging="false"
							aria-orientation={horizontal ? "vertical" : "horizontal"}
							aria-label={`${horizontal ? "左右" : "上下"}分隔線，目前比例 ${Math.round(divider.ratio * 100)}%`}
							aria-valuenow={Math.round(divider.ratio * 100)}
							aria-valuemin={5}
							aria-valuemax={95}
							style={{ left: `${centerX - hitWidth / 2}px`, top: `${centerY - hitHeight / 2}px`, width: `${hitWidth}px`, height: `${hitHeight}px` }}
							onPointerDown={event => handleDividerPointerDown(event, divider)}
							onKeyDown={event => {
								const next = ratioFromKeyboard(divider.ratio, event.key, event.shiftKey, divider.direction);
								if (next === null) return;
								event.preventDefault();
								onRatioChange(divider.nodeId, next, `ratio-key:${divider.nodeId}`);
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}
