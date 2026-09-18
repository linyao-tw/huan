import { childFolders, descendantFolderIds, folderPath, folderSummary } from "@/features/media/folders";
import { mediaListQueryOptions, useMediaFoldersQuery, useMediaListQuery, type MediaListFilters } from "@/features/media/hooks";
import "@/features/media/media.css";
import { MediaStatusBadge } from "@/features/media/MediaStatus";
import { formatResolution } from "@/shared/utils/format";
import { MEDIA_ROOT_FOLDER, type MediaAsset, type MediaKind } from "@huan/protocol";
import { formatBytes, formatDurationMs } from "@huan/shared";
import { Badge, Button, Checkbox, Dialog, EmptyState, Radio, RadioGroup, SearchField, Spinner } from "@linyao.tw/ui";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { VideoIcon } from "@phosphor-icons/react/dist/csr/Video";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

const KIND_LABELS: Record<MediaKind, string> = { video: "影片", image: "圖片", html: "HTML" };

export interface AssetPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	/** 只列出這些種類。挑背景圖時給 `["image"]`，輪播給 `["image", "video"]`。 */
	kinds: readonly MediaKind[];
	/** 多選模式會出現勾選框與「全選」；單選模式是一組單選鈕。 */
	multiple?: boolean;
	initialSelectedIds?: readonly string[];
	confirmLabel?: string;
	onConfirm: (assets: MediaAsset[]) => void;
}

function KindIcon({ kind }: { kind: MediaKind }) {
	if (kind === "video") return <VideoIcon weight="bold" />;
	if (kind === "image") return <ImageIcon weight="bold" />;
	return <FileHtmlIcon weight="bold" />;
}

/**
 * 預覽窗格。
 *
 * 影片一律靜音自動播放：挑素材時突然發出聲音是最容易嚇到人的一種互動，
 * 而實機音量由版面自己的設定決定，和這裡無關。
 */
function AssetPreview({ asset }: { asset: MediaAsset | null }) {
	if (!asset) {
		return (
			<div className="huan-picker__preview-empty">
				<p className="huan-muted">點一下素材就會在這裡看到它。</p>
			</div>
		);
	}

	const meta = [
		KIND_LABELS[asset.kind],
		formatResolution(asset.probe?.width, asset.probe?.height),
		asset.kind === "video" ? formatDurationMs(asset.probe?.durationMs ?? null) : null,
		formatBytes(asset.variants.find(variant => variant.role === "playback")?.sizeBytes ?? null)
	].filter((entry): entry is string => Boolean(entry) && entry !== "—");

	return (
		<div className="huan-picker__preview-body">
			<div className="huan-picker__preview-stage">
				{!asset.previewUrl ? (
					<span className="huan-caption">預覽尚未產生</span>
				) : asset.kind === "video" ? (
					<video src={asset.previewUrl} muted autoPlay loop playsInline preload="metadata" />
				) : asset.kind === "html" ? (
					<iframe src={asset.previewUrl} title={`${asset.name} 的預覽`} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" />
				) : (
					<img src={asset.previewUrl} alt="" />
				)}
			</div>
			<div className="huan-stack huan-stack--sm">
				<span className="huan-picker__preview-name">{asset.name}</span>
				<span className="huan-caption">{meta.join("・")}</span>
				<MediaStatusBadge status={asset.status} />
			</div>
		</div>
	);
}

export function AssetPicker({ open, onOpenChange, title, description, kinds, multiple = false, initialSelectedIds, confirmLabel = "選好了", onConfirm }: AssetPickerProps) {
	const queryClient = useQueryClient();
	const folders = useMediaFoldersQuery();
	const folderItems = useMemo(() => folders.data?.items ?? [], [folders.data]);

	const [folderId, setFolderId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Map<string, MediaAsset>>(new Map());
	const [focused, setFocused] = useState<MediaAsset | null>(null);
	const [expanding, setExpanding] = useState<string | null>(null);

	const searching = search.trim().length > 0;

	/** 每次打開都回到最上層並帶入目前的選擇；留著上一次的位置只會讓人以為自己選錯了。 */
	useEffect(() => {
		if (!open) return;
		setFolderId(null);
		setSearch("");
		setFocused(null);
		setSelected(new Map());
	}, [open]);

	const filters = useMemo<MediaListFilters>(() => {
		const next: MediaListFilters = { status: "ready", limit: 200 };
		if (kinds.length === 1) next.kind = kinds[0];
		if (searching) next.search = search.trim();
		/** 搜尋是跨資料夾的：找東西的時候還要先猜它在哪一層，等於沒有搜尋。 */
		else next.folderId = folderId ?? MEDIA_ROOT_FOLDER;
		return next;
	}, [kinds, searching, search, folderId]);

	const media = useMediaListQuery(open ? filters : { ...filters, limit: 1 });
	const assets = useMemo(() => (media.data?.items ?? []).filter(asset => kinds.includes(asset.kind)), [media.data, kinds]);

	/** 帶入初始選擇要等素材載進來，否則只拿得到 id，畫不出名稱也算不出「已選 N 個」。 */
	useEffect(() => {
		if (!open || !initialSelectedIds || initialSelectedIds.length === 0) return;
		setSelected(current => {
			if (current.size > 0) return current;
			const next = new Map(current);
			for (const asset of assets) {
				if (initialSelectedIds.includes(asset.id)) next.set(asset.id, asset);
			}
			return next;
		});
	}, [open, initialSelectedIds, assets]);

	const path = useMemo(() => folderPath(folderItems, folderId), [folderItems, folderId]);
	const subFolders = useMemo(() => (searching ? [] : childFolders(folderItems, folderId)), [folderItems, folderId, searching]);

	const toggle = (asset: MediaAsset, checked: boolean): void => {
		setSelected(current => {
			const next = multiple ? new Map(current) : new Map<string, MediaAsset>();
			if (checked) next.set(asset.id, asset);
			else next.delete(asset.id);
			return next;
		});
	};

	const allListedSelected = assets.length > 0 && assets.every(asset => selected.has(asset.id));

	const toggleAllListed = (checked: boolean): void => {
		setSelected(current => {
			const next = new Map(current);
			for (const asset of assets) {
				if (checked) next.set(asset.id, asset);
				else next.delete(asset.id);
			}
			return next;
		});
	};

	/**
	 * 整個資料夾（含子資料夾）一次加進來。
	 *
	 * 不用畫面上現有的資料：現在看的是別的資料夾，那些素材根本還沒載進來。
	 * 用同一組 query key 取，抓過的資料夾之後再點就直接命中快取。
	 */
	const selectFolder = async (id: string): Promise<void> => {
		setExpanding(id);
		try {
			const ids = [id, ...descendantFolderIds(folderItems, id)];
			const results = await Promise.all(
				ids.map(target => queryClient.fetchQuery(mediaListQueryOptions({ status: "ready", limit: 200, folderId: target, ...(kinds.length === 1 ? { kind: kinds[0] } : {}) })))
			);
			setSelected(current => {
				const next = new Map(current);
				for (const result of results) {
					for (const asset of result.items) {
						if (kinds.includes(asset.kind)) next.set(asset.id, asset);
					}
				}
				return next;
			});
		} finally {
			setExpanding(null);
		}
	};

	/**
	 * 素材卡片。
	 *
	 * 點整張卡片就會選取並顯示預覽：縮圖放大之後，使用者自然會直接點圖，而不是去找角落的
	 * 勾選框。勾選框仍然保留，鍵盤與螢幕報讀器用的是它。多選時再點一次就是取消。
	 */
	const cards = assets.map(asset => {
		const isSelected = selected.has(asset.id);
		return (
			<li key={asset.id} className="huan-picker__card" data-selected={isSelected ? "" : undefined}>
				<span className="huan-picker__card-check">
					{multiple ? (
						<Checkbox aria-label={`選取 ${asset.name}`} checked={isSelected} onCheckedChange={checked => toggle(asset, checked)} />
					) : (
						<Radio value={asset.id} aria-label={`選取 ${asset.name}`} />
					)}
				</span>
				<button
					type="button"
					className="huan-picker__card-main"
					aria-pressed={isSelected}
					onClick={() => {
						toggle(asset, multiple ? !isSelected : true);
						setFocused(asset);
					}}
				>
					<span className="huan-picker__card-thumb">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading="lazy" /> : <KindIcon kind={asset.kind} />}</span>
					<span className="huan-picker__card-name huan-truncate">{asset.name}</span>
					<span className="huan-caption huan-truncate">
						{KIND_LABELS[asset.kind]}・{formatResolution(asset.probe?.width, asset.probe?.height)}
					</span>
				</button>
			</li>
		);
	});

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false} className="huan-picker__popup">
						<Dialog.Header>
							<Dialog.Title>{title}</Dialog.Title>
							<Dialog.Description>{description ?? "只會列出處理完成、可以直接播的素材。"}</Dialog.Description>
						</Dialog.Header>
						<Dialog.Body>
							<div className="huan-picker">
								<div className="huan-picker__main">
									<div className="huan-picker__toolbar">
										<nav className="huan-picker__crumbs" aria-label="資料夾位置">
											<button type="button" onClick={() => setFolderId(null)} disabled={folderId === null && !searching}>
												素材庫
											</button>
											{path.map(folder => (
												<span key={folder.id} className="huan-row huan-row--tight huan-row--nowrap">
													<CaretRightIcon weight="bold" aria-hidden="true" />
													<button type="button" onClick={() => setFolderId(folder.id)} disabled={folder.id === folderId && !searching}>
														{folder.name}
													</button>
												</span>
											))}
										</nav>
										<SearchField label="搜尋素材" size="sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="輸入素材名稱" />
									</div>

									{multiple ? (
										<div className="huan-picker__bulk">
											<Checkbox
												aria-label="選取目前列出的全部素材"
												checked={allListedSelected}
												indeterminate={!allListedSelected && assets.some(asset => selected.has(asset.id))}
												onCheckedChange={toggleAllListed}
												disabled={assets.length === 0}
											/>
											<span className="huan-caption">{searching ? `全選搜尋結果（${assets.length} 個）` : `全選這個資料夾（${assets.length} 個）`}</span>
										</div>
									) : null}

									{media.isPending ? (
										<div className="huan-picker__loading">
											<Spinner size="sm" decorative /> <span className="huan-muted">正在載入素材…</span>
										</div>
									) : subFolders.length === 0 && assets.length === 0 ? (
										<EmptyState title={searching ? "沒有符合的素材" : "這裡還沒有東西"} description={searching ? "換一組關鍵字試試。" : "先到素材庫上傳，或換一個資料夾。"} />
									) : (
										<RadioGroupWrapper
											multiple={multiple}
											value={[...selected.keys()][0] ?? null}
											onValueChange={id => {
												const asset = assets.find(item => item.id === id);
												if (!asset) return;
												toggle(asset, true);
												setFocused(asset);
											}}
										>
											<div className="huan-picker__scroll">
												{subFolders.length > 0 ? (
													<ul className="huan-picker__folders" aria-label="資料夾">
														{subFolders.map(folder => (
															<li key={folder.id} className="huan-picker__row huan-picker__row--folder">
																<button type="button" className="huan-picker__row-main" onClick={() => setFolderId(folder.id)}>
																	<span className="huan-picker__thumb huan-picker__thumb--folder">
																		<FolderIcon weight="fill" />
																	</span>
																	<span className="huan-picker__row-text">
																		<span className="huan-truncate">{folder.name}</span>
																		<span className="huan-caption huan-truncate">{folderSummary(folder)}</span>
																	</span>
																	<CaretRightIcon weight="bold" aria-hidden="true" />
																</button>
																{/* 放在尾端：排在前面時它會先吃掉寬度，資料夾名稱就只剩兩個字。 */}
																{multiple ? (
																	<Button size="sm" variant="quiet" loading={expanding === folder.id} onClick={() => void selectFolder(folder.id)} aria-label={`全選資料夾 ${folder.name}`}>
																		全選
																	</Button>
																) : null}
															</li>
														))}
													</ul>
												) : null}
												{cards.length > 0 ? (
													<ul className="huan-picker__grid" aria-label="素材">
														{cards}
													</ul>
												) : null}
											</div>
										</RadioGroupWrapper>
									)}
								</div>

								<aside className="huan-picker__preview" aria-label="素材預覽">
									<AssetPreview asset={focused} />
								</aside>
							</div>
						</Dialog.Body>
						<Dialog.Footer>
							<span className="huan-picker__count">
								<Badge variant={selected.size > 0 ? "accent" : "neutral"}>已選 {selected.size} 個</Badge>
							</span>
							<Dialog.Close render={<Button variant="secondary">取消</Button>} />
							<Button
								disabled={selected.size === 0}
								onClick={() => {
									onConfirm([...selected.values()]);
									onOpenChange(false);
								}}
							>
								{confirmLabel}
							</Button>
						</Dialog.Footer>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** 單選時整份清單是一組單選鈕；多選時不需要這一層，直接把 children 放回去。 */
function RadioGroupWrapper({ multiple, value, onValueChange, children }: { multiple: boolean; value: string | null; onValueChange: (value: string) => void; children: React.ReactNode }) {
	if (multiple) return <>{children}</>;
	return (
		<RadioGroup aria-label="素材" value={value} onValueChange={next => typeof next === "string" && onValueChange(next)}>
			{children}
		</RadioGroup>
	);
}
