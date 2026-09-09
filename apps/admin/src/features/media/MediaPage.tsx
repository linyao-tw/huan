import { useMediaListQuery, type MediaListFilters } from "@/features/media/hooks";
import "@/features/media/media.css";
import { MediaDetailDialog } from "@/features/media/MediaDetailDialog";
import { MediaStatusBadge, mediaStatusDetail } from "@/features/media/MediaStatus";
import { MediaUploadPanel } from "@/features/media/MediaUploadPanel";
import { useMediaUploader } from "@/features/media/use-media-uploader";
import { PageHeader } from "@/shared/components/PageHeader";
import { CardsSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDateTime, formatResolution } from "@/shared/utils/format";
import type { MediaAsset, MediaKind, MediaStatus } from "@huan/protocol";
import { formatBytes, formatDurationMs } from "@huan/shared";
import {
	Badge,
	Card,
	CardBody,
	EmptyState,
	SearchField,
	SegmentedControl,
	SegmentedControlItem,
	Select,
	Table,
	TableBody,
	TableCell,
	TableFrame,
	TableHead,
	TableHeader,
	TableRow
} from "@linyao.tw/ui";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { VideoIcon } from "@phosphor-icons/react/dist/csr/Video";
import { useMemo, useState } from "react";

type ViewMode = "grid" | "list";

const KIND_LABELS: Record<MediaKind, string> = { video: "影片", image: "圖片", html: "HTML" };

const STATUS_OPTIONS: { value: MediaStatus | "all"; label: string }[] = [
	{ value: "all", label: "全部狀態" },
	{ value: "ready", label: "可使用" },
	{ value: "processing", label: "處理中" },
	{ value: "uploaded", label: "等待處理" },
	{ value: "failed", label: "轉檔失敗" },
	{ value: "needs_reupload", label: "需重新上傳" }
];

const KIND_OPTIONS: { value: MediaKind | "all"; label: string }[] = [
	{ value: "all", label: "全部類型" },
	{ value: "video", label: "影片" },
	{ value: "image", label: "圖片" },
	{ value: "html", label: "HTML" }
];

function KindIcon({ kind }: { kind: MediaKind }) {
	if (kind === "video") return <VideoIcon weight="bold" />;
	if (kind === "image") return <ImageIcon weight="bold" />;
	return <FileHtmlIcon weight="bold" />;
}

function MediaThumb({ asset }: { asset: MediaAsset }) {
	if (asset.thumbnailUrl) return <img src={asset.thumbnailUrl} alt="" loading="lazy" />;
	return (
		<span aria-hidden="true">
			<KindIcon kind={asset.kind} />
		</span>
	);
}

export function MediaPage() {
	const [view, setView] = useState<ViewMode>("grid");
	const [search, setSearch] = useState("");
	const [kind, setKind] = useState<MediaKind | "all">("all");
	const [status, setStatus] = useState<MediaStatus | "all">("all");
	const [selected, setSelected] = useState<MediaAsset | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);

	const uploader = useMediaUploader();

	const filters = useMemo<MediaListFilters>(() => {
		const next: MediaListFilters = { limit: 100 };
		if (search.trim().length > 0) next.search = search.trim();
		if (kind !== "all") next.kind = kind;
		if (status !== "all") next.status = status;
		return next;
	}, [search, kind, status]);

	const media = useMediaListQuery(filters);
	const items = media.data?.items ?? [];
	const hasFilters = search.trim().length > 0 || kind !== "all" || status !== "all";

	const openDetail = (asset: MediaAsset): void => {
		setSelected(asset);
		setDetailOpen(true);
	};

	return (
		<>
			<PageHeader
				title="素材庫"
				description="上傳的影片、圖片與 HTML 會在這裡轉檔並產生縮圖、預覽與播放版本。"
				annotation={media.data ? <Badge variant="neutral">{media.data.total} 個素材</Badge> : null}
				actions={
					<SegmentedControl aria-label="檢視方式" size="sm" value={view} onValueChange={next => next && setView(next as ViewMode)}>
						<SegmentedControlItem value="grid">
							<span className="huan-row huan-row--tight">
								<SquaresFourIcon weight="bold" aria-hidden="true" /> 格狀
							</span>
						</SegmentedControlItem>
						<SegmentedControlItem value="list">
							<span className="huan-row huan-row--tight">
								<ListIcon weight="bold" aria-hidden="true" /> 清單
							</span>
						</SegmentedControlItem>
					</SegmentedControl>
				}
			/>

			<Card variant="material">
				<CardBody>
					<MediaUploadPanel uploader={uploader} />
				</CardBody>
			</Card>

			<div className="huan-row">
				<SearchField className="huan-grow" label="搜尋素材" size="sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="輸入素材名稱" />
				<Select label="類型" size="sm" value={kind} onValueChange={value => setKind(value ?? "all")} options={KIND_OPTIONS} />
				<Select label="狀態" size="sm" value={status} onValueChange={value => setStatus(value ?? "all")} options={STATUS_OPTIONS} />
			</div>

			{media.isError ? <QueryErrorAlert error={media.error} onRetry={() => void media.refetch()} retrying={media.isFetching} title="無法載入素材庫" /> : null}

			{media.isPending ? (
				<CardsSkeleton cards={8} label="正在載入素材" />
			) : items.length === 0 ? (
				<EmptyState
					icon={<ImagesSquareIcon weight="bold" />}
					title={hasFilters ? "沒有符合條件的素材" : "素材庫還是空的"}
					description={hasFilters ? "換一組篩選條件，或清除搜尋關鍵字。" : "把影片、圖片或 HTML 檔案拖到上方的上傳區，就會開始轉檔。"}
				/>
			) : view === "grid" ? (
				<ul className="huan-media-grid">
					{items.map(asset => (
						<li key={asset.id}>
							<button type="button" className="huan-media-select" onClick={() => openDetail(asset)} aria-label={`開啟素材 ${asset.name} 的詳細資料`}>
								<Card variant="material" size="sm">
									<CardBody>
										<div className="huan-media-card">
											<div className="huan-media-thumb">
												<MediaThumb asset={asset} />
											</div>
											<span className="huan-truncate">{asset.name}</span>
											<MediaStatusBadge status={asset.status} />
											<span className="huan-caption">
												{KIND_LABELS[asset.kind]} · {formatResolution(asset.probe?.width, asset.probe?.height)}
											</span>
											<span className="huan-caption">{asset.status === "needs_reupload" ? "需重新上傳同一個檔案" : mediaStatusDetail(asset).slice(0, 40)}</span>
										</div>
									</CardBody>
								</Card>
							</button>
						</li>
					))}
				</ul>
			) : (
				<TableFrame>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名稱</TableHead>
								<TableHead>類型</TableHead>
								<TableHead>狀態</TableHead>
								<TableHead>解析度</TableHead>
								<TableHead>長度</TableHead>
								<TableHead>大小</TableHead>
								<TableHead>建立時間</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(asset => (
								<TableRow key={asset.id}>
									<TableCell>
										<button type="button" className="huan-media-select" onClick={() => openDetail(asset)}>
											{asset.name}
										</button>
									</TableCell>
									<TableCell>{KIND_LABELS[asset.kind]}</TableCell>
									<TableCell>
										<MediaStatusBadge status={asset.status} />
									</TableCell>
									<TableCell numeric>{formatResolution(asset.probe?.width, asset.probe?.height)}</TableCell>
									<TableCell numeric>{asset.kind === "video" ? formatDurationMs(asset.probe?.durationMs ?? null) : "—"}</TableCell>
									<TableCell numeric>{formatBytes(asset.variants.find(variant => variant.role === "playback")?.sizeBytes ?? asset.variants[0]?.sizeBytes ?? null)}</TableCell>
									<TableCell>{formatDateTime(asset.createdAt)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableFrame>
			)}

			<MediaDetailDialog key={selected?.id ?? "none"} asset={selected} open={detailOpen} onOpenChange={setDetailOpen} />
		</>
	);
}
