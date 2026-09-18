import { CreateFolderDialog, MoveAssetsDialog, RenameFolderDialog } from "@/features/media/FolderDialogs";
import { childFolders, folderPath } from "@/features/media/folders";
import { useDeleteMediaFolderMutation, useMediaFoldersQuery, useMediaListQuery, type MediaListFilters } from "@/features/media/hooks";
import "@/features/media/media.css";
import { MediaDetailDialog } from "@/features/media/MediaDetailDialog";
import { MediaStatusBadge, mediaStatusDetail } from "@/features/media/MediaStatus";
import { MediaUploadPanel } from "@/features/media/MediaUploadPanel";
import { useMediaUploader } from "@/features/media/use-media-uploader";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { CardsSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";
import { formatDateTime, formatResolution } from "@/shared/utils/format";
import { MEDIA_ROOT_FOLDER, type MediaAsset, type MediaFolder, type MediaKind, type MediaStatus } from "@huan/protocol";
import { formatBytes, formatDurationMs } from "@huan/shared";
import {
	Badge,
	Button,
	Card,
	Checkbox,
	EmptyState,
	IconButton,
	SearchField,
	SegmentedControl,
	SegmentedControlItem,
	Select,
	Separator,
	Table,
	TableBody,
	TableCell,
	TableFrame,
	TableHead,
	TableHeader,
	TableRow,
	useToastManager
} from "@linyao.tw/ui";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FolderPlusIcon } from "@phosphor-icons/react/dist/csr/FolderPlus";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
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
	useDocumentTitle("素材庫");

	const toast = useToastManager();
	const [view, setView] = useState<ViewMode>("grid");
	const [search, setSearch] = useState("");
	const [kind, setKind] = useState<MediaKind | "all">("all");
	const [status, setStatus] = useState<MediaStatus | "all">("all");
	const [folderId, setFolderId] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [selected, setSelected] = useState<MediaAsset | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);
	const [createFolderOpen, setCreateFolderOpen] = useState(false);
	const [moveOpen, setMoveOpen] = useState(false);
	const [editingFolder, setEditingFolder] = useState<MediaFolder | null>(null);
	const [deletingFolder, setDeletingFolder] = useState<MediaFolder | null>(null);

	const uploader = useMediaUploader(folderId);
	const folders = useMediaFoldersQuery();
	const deleteFolder = useDeleteMediaFolderMutation();
	const folderItems = useMemo(() => folders.data?.items ?? [], [folders.data]);

	const searching = search.trim().length > 0;

	const filters = useMemo<MediaListFilters>(() => {
		const next: MediaListFilters = { limit: 100 };
		if (searching) next.search = search.trim();
		/** 搜尋時跨整個素材庫找，否則只列出目前這一層。 */
		else next.folderId = folderId ?? MEDIA_ROOT_FOLDER;
		if (kind !== "all") next.kind = kind;
		if (status !== "all") next.status = status;
		return next;
	}, [search, searching, kind, status, folderId]);

	const media = useMediaListQuery(filters);
	const items = media.data?.items ?? [];
	const hasFilters = searching || kind !== "all" || status !== "all";

	const path = useMemo(() => folderPath(folderItems, folderId), [folderItems, folderId]);
	const subFolders = useMemo(() => (searching ? [] : childFolders(folderItems, folderId)), [folderItems, folderId, searching]);
	const currentFolderName = path.at(-1)?.name ?? "素材庫";

	const openDetail = (asset: MediaAsset): void => {
		setSelected(asset);
		setDetailOpen(true);
	};

	const goToFolder = (next: string | null): void => {
		setFolderId(next);
		setSelectedIds([]);
		setSearch("");
	};

	const toggleSelected = (assetId: string, checked: boolean): void => {
		setSelectedIds(current => (checked ? [...new Set([...current, assetId])] : current.filter(id => id !== assetId)));
	};

	const allSelected = items.length > 0 && items.every(asset => selectedIds.includes(asset.id));

	return (
		<>
			<PageHeader
				title="素材庫"
				description="上傳影片、圖片或 HTML 檔案，處理完成後就可以放進版面。用資料夾整理，挑素材時會輕鬆很多。"
				annotation={
					media.data ? (
						<Badge variant="neutral">{searching ? `${media.data.total} 個符合` : folderId === null ? `最上層 ${media.data.total} 個素材` : `這個資料夾 ${media.data.total} 個素材`}</Badge>
					) : null
				}
				actions={
					<div className="huan-row huan-row--tight">
						<Button size="sm" variant="secondary" startIcon={<FolderPlusIcon weight="bold" />} onClick={() => setCreateFolderOpen(true)}>
							新增資料夾
						</Button>
						<SegmentedControl aria-label="檢視方式" size="sm" value={view} onValueChange={next => next && setView(next as ViewMode)}>
							<SegmentedControlItem value="grid">
								<span className="huan-row huan-row--tight huan-row--nowrap">
									<SquaresFourIcon weight="bold" aria-hidden="true" /> 格狀
								</span>
							</SegmentedControlItem>
							<SegmentedControlItem value="list">
								<span className="huan-row huan-row--tight huan-row--nowrap">
									<ListIcon weight="bold" aria-hidden="true" /> 清單
								</span>
							</SegmentedControlItem>
						</SegmentedControl>
					</div>
				}
			/>

			{/* 上傳卡與格狀卡同一個 size，否則同一頁上會出現 24px 與 16px 兩種內距。 */}
			<Card variant="material" size="sm">
				<MediaUploadPanel uploader={uploader} folderName={currentFolderName} />
			</Card>

			<nav className="huan-media-crumbs" aria-label="資料夾位置">
				<button type="button" onClick={() => goToFolder(null)} disabled={folderId === null}>
					素材庫
				</button>
				{path.map(folder => (
					<span key={folder.id} className="huan-row huan-row--tight huan-row--nowrap">
						<CaretRightIcon weight="bold" aria-hidden="true" />
						<button type="button" onClick={() => goToFolder(folder.id)} disabled={folder.id === folderId}>
							{folder.name}
						</button>
					</span>
				))}
			</nav>

			<div className="huan-media-toolbar">
				<SearchField label="搜尋素材" size="sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="輸入素材名稱（會跨資料夾找）" />
				<Select label="類型" size="sm" value={kind} onValueChange={value => setKind(value ?? "all")} options={KIND_OPTIONS} />
				<Select label="狀態" size="sm" value={status} onValueChange={value => setStatus(value ?? "all")} options={STATUS_OPTIONS} />
			</div>

			{folders.isError ? <QueryErrorAlert error={folders.error} onRetry={() => void folders.refetch()} retrying={folders.isFetching} title="無法載入資料夾" /> : null}
			{media.isError ? <QueryErrorAlert error={media.error} onRetry={() => void media.refetch()} retrying={media.isFetching} title="無法載入素材庫" /> : null}

			{subFolders.length > 0 ? (
				<ul className="huan-media-folders">
					{subFolders.map(folder => (
						<li key={folder.id}>
							<Card variant="material" size="sm">
								<div className="huan-media-folder">
									<button type="button" className="huan-media-folder__open" onClick={() => goToFolder(folder.id)}>
										<span className="huan-media-folder__icon" aria-hidden="true">
											<FolderIcon weight="fill" />
										</span>
										<span className="huan-media-folder__text">
											<span className="huan-truncate">{folder.name}</span>
											<span className="huan-caption">
												{folder.assetCount} 個素材・{folder.childCount} 個子資料夾
											</span>
										</span>
									</button>
									<IconButton aria-label={`編輯資料夾 ${folder.name}`} variant="quiet" size="sm" onClick={() => setEditingFolder(folder)}>
										<PencilSimpleIcon weight="bold" />
									</IconButton>
									<IconButton aria-label={`刪除資料夾 ${folder.name}`} variant="quiet" size="sm" onClick={() => setDeletingFolder(folder)}>
										<TrashIcon weight="bold" />
									</IconButton>
								</div>
							</Card>
						</li>
					))}
				</ul>
			) : null}

			{items.length > 0 ? (
				<div className="huan-media-selection">
					<Checkbox
						aria-label="選取目前列出的全部素材"
						checked={allSelected}
						indeterminate={!allSelected && selectedIds.length > 0}
						onCheckedChange={checked => setSelectedIds(checked ? items.map(asset => asset.id) : [])}
					/>
					<span className="huan-caption">{selectedIds.length > 0 ? `已選 ${selectedIds.length} 個` : `全選這一層的 ${items.length} 個素材`}</span>
					<Separator orientation="vertical" />
					<Button size="sm" variant="secondary" disabled={selectedIds.length === 0} onClick={() => setMoveOpen(true)}>
						搬移到…
					</Button>
					<Button size="sm" variant="quiet" disabled={selectedIds.length === 0} onClick={() => setSelectedIds([])}>
						取消選取
					</Button>
				</div>
			) : null}

			{media.isPending ? (
				<CardsSkeleton cards={8} label="正在載入素材" />
			) : items.length === 0 ? (
				subFolders.length > 0 ? null : (
					<EmptyState
						icon={<ImagesSquareIcon weight="bold" />}
						title={hasFilters ? "沒有符合條件的素材" : folderId === null ? "素材庫還是空的" : "這個資料夾還是空的"}
						description={hasFilters ? "換一組篩選條件，或清除搜尋關鍵字。" : "把影片、圖片或 HTML 檔案拖到上面的上傳區就會開始處理。"}
					/>
				)
			) : view === "grid" ? (
				<ul className="huan-media-grid">
					{items.map(asset => (
						<li key={asset.id}>
							<div className="huan-media-card__check">
								<Checkbox aria-label={`選取 ${asset.name}`} checked={selectedIds.includes(asset.id)} onCheckedChange={checked => toggleSelected(asset.id, checked)} />
							</div>
							<button type="button" className="huan-media-select" onClick={() => openDetail(asset)} aria-label={`開啟素材 ${asset.name} 的詳細資料`}>
								<Card variant="material" size="sm">
									<div className="huan-media-card">
										<div className="huan-media-thumb">
											<MediaThumb asset={asset} />
										</div>
										<span className="huan-media-card__name huan-truncate">{asset.name}</span>
										<div className="huan-media-card__meta">
											<MediaStatusBadge status={asset.status} />
											<span className="huan-caption huan-truncate">
												{KIND_LABELS[asset.kind]} · {formatResolution(asset.probe?.width, asset.probe?.height)}
											</span>
										</div>
										<span className="huan-caption huan-media-card__detail">{mediaStatusDetail(asset)}</span>
									</div>
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
								<TableHead>選取</TableHead>
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
										<Checkbox aria-label={`選取 ${asset.name}`} checked={selectedIds.includes(asset.id)} onCheckedChange={checked => toggleSelected(asset.id, checked)} />
									</TableCell>
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

			<MediaDetailDialog key={selected?.id ?? "none"} asset={selected} open={detailOpen} onOpenChange={setDetailOpen} folders={folderItems} />

			<CreateFolderDialog open={createFolderOpen} onOpenChange={setCreateFolderOpen} parentId={folderId} parentName={currentFolderName} />
			<RenameFolderDialog open={editingFolder !== null} onOpenChange={open => !open && setEditingFolder(null)} folder={editingFolder} folders={folderItems} />
			<MoveAssetsDialog open={moveOpen} onOpenChange={setMoveOpen} assetIds={selectedIds} folders={folderItems} currentFolderId={folderId} onMoved={() => setSelectedIds([])} />

			<ConfirmDialog
				open={deletingFolder !== null}
				onOpenChange={open => {
					if (!open) {
						setDeletingFolder(null);
						deleteFolder.reset();
					}
				}}
				destructive
				title={`刪除資料夾「${deletingFolder?.name ?? ""}」？`}
				description="只能刪空的資料夾。裡面還有素材或子資料夾時，請先把它們搬走。"
				confirmLabel="刪除資料夾"
				pending={deleteFolder.isPending}
				errorMessage={deleteFolder.error?.message ?? null}
				onConfirm={() => {
					const target = deletingFolder;
					if (!target) return;
					deleteFolder.mutate(target.id, {
						onSuccess: () => {
							toast.add({ title: `已刪除「${target.name}」`, data: { status: "success" } });
							setDeletingFolder(null);
						}
					});
				}}
			/>
		</>
	);
}
