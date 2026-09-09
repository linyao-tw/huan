import { DRAG_MEDIA_TYPE } from "@/features/layouts/editor/content";
import "@/features/layouts/layouts.css";
import { useMediaListQuery } from "@/features/media/hooks";
import { QueryErrorAlert } from "@/shared/components/QueryState";
import { formatResolution } from "@/shared/utils/format";
import type { MediaAsset } from "@huan/protocol";
import { Button, EmptyState, SearchField, SectionHeading, Skeleton } from "@linyao.tw/ui";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { VideoIcon } from "@phosphor-icons/react/dist/csr/Video";
import { useMemo, useState } from "react";

function KindGlyph({ asset }: { asset: MediaAsset }) {
	if (asset.thumbnailUrl) return <img className="huan-palette-thumb" src={asset.thumbnailUrl} alt="" loading="lazy" />;
	return (
		<span className="huan-palette-thumb" aria-hidden="true">
			{asset.kind === "video" ? <VideoIcon weight="bold" /> : asset.kind === "image" ? <ImageIcon weight="bold" /> : <FileHtmlIcon weight="bold" />}
		</span>
	);
}

export interface MediaPaletteProps {
	/** 沒有選取區塊時，鍵盤指派按鈕必須停用；拖曳仍然可用。 */
	selectedSlotId: string | null;
	onAssign: (assetId: string) => void;
	onInsertText: () => void;
	onInsertTicker: () => void;
	onInsertUrl: () => void;
}

export function MediaPalette({ selectedSlotId, onAssign, onInsertText, onInsertTicker, onInsertUrl }: MediaPaletteProps) {
	const [search, setSearch] = useState("");
	const media = useMediaListQuery(useMemo(() => ({ status: "ready" as const, limit: 100, ...(search.trim() ? { search: search.trim() } : {}) }), [search]));

	const items = media.data?.items ?? [];
	const assignDisabled = selectedSlotId === null;

	return (
		<div className="huan-editor__pane huan-editor__pane--source">
			<SectionHeading level={2} size="sm" description="把素材拖到畫布上，或選好區塊後按「放入」。">
				內容來源
			</SectionHeading>

			<div className="huan-palette-inserts">
				<Button size="sm" variant="secondary" onClick={onInsertText} disabled={assignDisabled}>
					放入文字
				</Button>
				<Button size="sm" variant="secondary" onClick={onInsertTicker} disabled={assignDisabled}>
					放入跑馬燈
				</Button>
				<Button size="sm" variant="secondary" onClick={onInsertUrl} disabled={assignDisabled}>
					放入網頁
				</Button>
			</div>

			<SearchField label="搜尋素材" size="sm" value={search} onChange={event => setSearch(event.target.value)} />

			{media.isError ? <QueryErrorAlert error={media.error} onRetry={() => void media.refetch()} retrying={media.isFetching} title="無法載入素材" /> : null}

			{media.isPending ? (
				<div className="huan-stack huan-stack--sm" aria-busy="true">
					{Array.from({ length: 4 }, (_value, index) => (
						<Skeleton key={index} shape="rectangular" style={{ blockSize: "var(--control-height-md)" }} />
					))}
				</div>
			) : items.length === 0 ? (
				<EmptyState title="沒有可用的素材" description={search ? "換一個關鍵字試試。" : "只有處理完成的素材可以放進版面。先到素材庫上傳。"} />
			) : (
				<ul className="huan-palette-list">
					{items.map(asset => (
						<li key={asset.id}>
							<div
								className="huan-palette-item"
								draggable
								onDragStart={event => {
									event.dataTransfer.setData(DRAG_MEDIA_TYPE, asset.id);
									event.dataTransfer.effectAllowed = "copy";
								}}
							>
								<KindGlyph asset={asset} />
								<span className="huan-grow huan-stack huan-stack--sm">
									<span className="huan-truncate">{asset.name}</span>
									<span className="huan-caption huan-numeric">{formatResolution(asset.probe?.width, asset.probe?.height)}</span>
								</span>
								<Button size="sm" variant="quiet" disabled={assignDisabled} onClick={() => onAssign(asset.id)}>
									放入
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
