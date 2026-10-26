import { useViewportSize } from "@/features/layouts/editor/LayoutCanvas";
import { SlotPreview } from "@/features/layouts/editor/SlotPreview";
import "@/features/layouts/layouts.css";
import { computeFitTransform, computeLayoutGeometry } from "@huan/layout-engine";
import type { LayoutDocument, MediaAsset } from "@huan/protocol";
import { Button, Dialog } from "@linyao.tw/ui";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { useMemo, useRef } from "react";

/**
 * 只負責畫面，沒有任何編輯用的東西：沒有選取框、分隔線、提示角標。
 * 輪播照實機的規則往下換，影片會播，跑馬燈會跑。
 */
function LayoutStage({ document: layoutDocument, assets }: { document: LayoutDocument; assets: Map<string, MediaAsset> }) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const viewport = useViewportSize(viewportRef);
	const geometry = useMemo(() => computeLayoutGeometry(layoutDocument), [layoutDocument]);
	const fit = useMemo(() => computeFitTransform(layoutDocument.canvas, viewport), [layoutDocument.canvas, viewport]);
	const background = layoutDocument.background;
	const backgroundAsset = background.imageAssetId ? assets.get(background.imageAssetId) : undefined;

	return (
		<div className="huan-layout-preview__viewport" ref={viewportRef}>
			<div
				className="huan-layout-preview__stage"
				role="img"
				aria-label={`版面預覽 ${layoutDocument.canvas.width} × ${layoutDocument.canvas.height}`}
				style={{ left: `${fit.offsetX}px`, top: `${fit.offsetY}px`, width: `${fit.width}px`, height: `${fit.height}px`, background: background.color }}
			>
				{backgroundAsset?.previewUrl ? <img src={backgroundAsset.previewUrl} alt="" className="huan-preview-media" style={{ position: "absolute", inset: 0, objectFit: background.imageFit }} /> : null}
				{geometry.slots.map(slot => (
					<div
						key={slot.nodeId}
						className="huan-canvas-slot"
						style={{ left: `${slot.x * fit.scale}px`, top: `${slot.y * fit.scale}px`, width: `${slot.width * fit.scale}px`, height: `${slot.height * fit.scale}px` }}
					>
						<div className="huan-canvas-slot__content">
							<SlotPreview content={slot.content} assets={assets} scale={fit.scale} live />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function LayoutPreviewDialog({
	open,
	onOpenChange,
	document: layoutDocument,
	assets
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	document: LayoutDocument;
	assets: Map<string, MediaAsset>;
}) {
	const frameRef = useRef<HTMLDivElement>(null);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup className="huan-layout-preview__popup">
						<Dialog.Header>
							<Dialog.Title>預覽版面</Dialog.Title>
							<Dialog.Description>照實機的方式播放目前的草稿：輪播會依秒數換下一則，影片播完才換。預覽一律靜音。</Dialog.Description>
						</Dialog.Header>
						<Dialog.Body>
							{/* 只在開啟時掛上，關掉就停掉所有影片與計時器，下次打開從第一則重新開始。 */}
							<div className="huan-layout-preview" ref={frameRef}>
								{open ? <LayoutStage document={layoutDocument} assets={assets} /> : null}
							</div>
						</Dialog.Body>
						<Dialog.Footer>
							<Button variant="secondary" startIcon={<CornersOutIcon weight="bold" />} onClick={() => void frameRef.current?.requestFullscreen?.()}>
								全螢幕
							</Button>
							<Dialog.Close render={<Button>關閉</Button>} />
						</Dialog.Footer>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
