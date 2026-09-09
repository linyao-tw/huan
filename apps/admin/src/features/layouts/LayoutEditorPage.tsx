import { contentForAsset, createTextContent, createTickerContent, createUrlContent } from "@/features/layouts/editor/content";
import { Inspector } from "@/features/layouts/editor/Inspector";
import { LayoutCanvas } from "@/features/layouts/editor/LayoutCanvas";
import { MediaPalette } from "@/features/layouts/editor/MediaPalette";
import { useDocumentHistory } from "@/features/layouts/editor/useDocumentHistory";
import { useLayoutDetailQuery, usePublishLayoutMutation, useUpdateLayoutMutation } from "@/features/layouts/hooks";
import { useMediaListQuery } from "@/features/media/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDateTime, formatRelativeTime } from "@/shared/utils/format";
import { collectSlots, removeSlot, serializeLayoutDocument, setSlotContent, setSplitDirection, setSplitRatio, splitNode, swapSlotContent } from "@huan/layout-engine";
import type { LayoutDetail, LayoutDocument, MediaAsset, SlotContent, SplitDirection } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardBody, Dialog, EmptyState, SectionHeading, Spinner, TextField, TextView, useToastManager } from "@linyao.tw/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CloudCheckIcon } from "@phosphor-icons/react/dist/csr/CloudCheck";
import { CloudWarningIcon } from "@phosphor-icons/react/dist/csr/CloudWarning";
import { RocketLaunchIcon } from "@phosphor-icons/react/dist/csr/RocketLaunch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useParams } from "react-router";

const AUTOSAVE_DELAY_MS = 900;

type SaveState = "saved" | "dirty" | "saving" | "error" | "invalid";

function SaveIndicator({ state, message }: { state: SaveState; message: string | null }) {
	if (state === "saving") {
		return (
			<span className="huan-row huan-row--tight huan-muted">
				<Spinner size="sm" decorative /> 儲存中…
			</span>
		);
	}
	if (state === "error" || state === "invalid") {
		return (
			<span className="huan-row huan-row--tight">
				<CloudWarningIcon weight="bold" aria-hidden="true" />
				<Badge variant="danger">{state === "invalid" ? "草稿內容不合法" : "儲存失敗"}</Badge>
				{message ? <span className="huan-caption">{message}</span> : null}
			</span>
		);
	}
	if (state === "dirty") return <span className="huan-muted">尚未儲存的變更</span>;
	return (
		<span className="huan-row huan-row--tight huan-muted">
			<CloudCheckIcon weight="bold" aria-hidden="true" /> 草稿已儲存
		</span>
	);
}

function LayoutEditor({ layout }: { layout: LayoutDetail }) {
	const toast = useToastManager();
	const update = useUpdateLayoutMutation();
	const publish = usePublishLayoutMutation();
	const media = useMediaListQuery({ limit: 200 });

	const history = useDocumentHistory(layout.draft);
	const [name, setName] = useState(layout.name);
	const [description, setDescription] = useState(layout.description ?? "");
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => collectSlots(layout.draft.root)[0]?.id ?? null);
	const [publishOpen, setPublishOpen] = useState(false);
	const [publishNote, setPublishNote] = useState("");

	const savedSignature = useRef(`${layout.name} ${layout.description ?? ""} ${serializeLayoutDocument(layout.draft)}`);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [saveMessage, setSaveMessage] = useState<string | null>(null);

	const assets = useMemo(() => media.data?.items ?? [], [media.data]);
	const assetMap = useMemo(() => new Map<string, MediaAsset>(assets.map(asset => [asset.id, asset])), [assets]);

	const applyDocument = useCallback(
		(updater: (current: LayoutDocument) => LayoutDocument, coalesceKey?: string) => {
			history.apply(updater, coalesceKey === undefined ? undefined : { coalesceKey });
		},
		[history]
	);

	const mutateDraft = update.mutate;

	/**
	 * 自動儲存。
	 *
	 * 送出前先用 schema 序列化一次：使用者把畫布寬度暫時輸入成 12 的當下，
	 * 這份草稿是不合法的，寧可顯示「內容不合法」也不要送出去讓 Server 回 400。
	 */
	useEffect(() => {
		let signature: string;
		try {
			signature = `${name} ${description} ${serializeLayoutDocument(history.document)}`;
		} catch {
			setSaveState("invalid");
			setSaveMessage("畫布尺寸、比例或內容超出允許範圍，修正後會自動繼續儲存。");
			return;
		}

		if (signature === savedSignature.current) {
			setSaveState("saved");
			setSaveMessage(null);
			return;
		}

		setSaveState("dirty");
		setSaveMessage(null);

		const timer = setTimeout(() => {
			setSaveState("saving");
			mutateDraft(
				{ id: layout.id, body: { name: name.trim() || layout.name, description: description.trim().length > 0 ? description.trim() : null, draft: history.document } },
				{
					onSuccess: () => {
						savedSignature.current = signature;
						setSaveState("saved");
					},
					onError: error => {
						setSaveState("error");
						setSaveMessage(error.message);
					}
				}
			);
		}, AUTOSAVE_DELAY_MS);

		return () => clearTimeout(timer);
	}, [history.document, name, description, layout.id, layout.name, mutateDraft]);

	const slots = useMemo(() => collectSlots(history.document.root), [history.document]);
	const activeSlotId = selectedNodeId !== null && slots.some(slot => slot.id === selectedNodeId) ? selectedNodeId : (slots[0]?.id ?? null);

	const splitSelected = useCallback(
		(direction: SplitDirection) => {
			if (!activeSlotId) return;
			applyDocument(current => splitNode(current, activeSlotId, direction));
		},
		[activeSlotId, applyDocument]
	);

	const removeSelected = useCallback(() => {
		if (!activeSlotId) return;
		applyDocument(current => removeSlot(current, activeSlotId));
	}, [activeSlotId, applyDocument]);

	const setSelectedContent = useCallback(
		(content: SlotContent | null) => {
			if (!activeSlotId) return;
			applyDocument(current => setSlotContent(current, activeSlotId, content), content ? `content:${activeSlotId}:${content.type}` : undefined);
		},
		[activeSlotId, applyDocument]
	);

	// 鍵盤是分割、刪除與復原的第一級操作，不是拖曳的補充。
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement | null;
			const editing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) history.redo();
				else history.undo();
				return;
			}
			if (editing) return;
			if (event.altKey && (event.key === "ArrowRight" || event.key.toLowerCase() === "h")) {
				event.preventDefault();
				splitSelected("horizontal");
				return;
			}
			if (event.altKey && (event.key === "ArrowDown" || event.key.toLowerCase() === "v")) {
				event.preventDefault();
				splitSelected("vertical");
				return;
			}
			if ((event.key === "Delete" || event.key === "Backspace") && target?.classList.contains("huan-canvas-slot__hit")) {
				event.preventDefault();
				removeSelected();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [history, splitSelected, removeSelected]);

	return (
		<>
			<PageHeader
				title={
					<span className="huan-row huan-row--tight">
						{layout.name}
						{layout.publishedRevisionNumber === null ? <Badge variant="neutral">尚未發布</Badge> : <Badge variant="success">已發布第 {layout.publishedRevisionNumber} 版</Badge>}
					</span>
				}
				description={`畫布 ${history.document.canvas.width} x ${history.document.canvas.height}，草稿最後修改 ${formatRelativeTime(layout.draftUpdatedAt)}`}
				actions={
					<div className="huan-row huan-row--tight">
						<SaveIndicator state={saveState} message={saveMessage} />
						<Button size="sm" variant="quiet" startIcon={<ArrowCounterClockwiseIcon weight="bold" />} onClick={history.undo} disabled={!history.canUndo}>
							復原
						</Button>
						<Button size="sm" variant="quiet" startIcon={<ArrowClockwiseIcon weight="bold" />} onClick={history.redo} disabled={!history.canRedo}>
							重做
						</Button>
						<Button size="sm" startIcon={<RocketLaunchIcon weight="bold" />} onClick={() => setPublishOpen(true)} disabled={saveState === "invalid"}>
							發布
						</Button>
					</div>
				}
			/>

			{media.isError ? <QueryErrorAlert error={media.error} onRetry={() => void media.refetch()} retrying={media.isFetching} title="無法載入素材，畫布上的圖片與影片會顯示為預留位置" /> : null}

			<div className="huan-editor">
				<MediaPalette
					selectedSlotId={activeSlotId}
					onAssign={assetId => {
						const asset = assetMap.get(assetId);
						if (asset) setSelectedContent(contentForAsset(asset));
					}}
					onInsertText={() => setSelectedContent(createTextContent())}
					onInsertTicker={() => setSelectedContent(createTickerContent())}
					onInsertUrl={() => setSelectedContent(createUrlContent())}
				/>

				<div className="huan-editor__canvas-pane">
					<LayoutCanvas
						document={history.document}
						assets={assetMap}
						selectedNodeId={activeSlotId}
						onSelectNode={setSelectedNodeId}
						onRatioChange={(nodeId, ratio, coalesceKey) => applyDocument(current => setSplitRatio(current, nodeId, ratio), coalesceKey)}
						onDropAsset={(slotId, assetId) => {
							const asset = assetMap.get(assetId);
							if (asset) applyDocument(current => setSlotContent(current, slotId, contentForAsset(asset)));
						}}
						onSwapSlots={(sourceId, targetId) => applyDocument(current => swapSlotContent(current, sourceId, targetId))}
					/>

					<Alert status="info">
						<AlertTitle>操作提示</AlertTitle>
						<AlertDescription>
							拖曳分隔線可調整比例，按住 Alt 會暫時關閉吸附；分隔線取得焦點後也能用方向鍵微調。選取區塊後按 Alt 加右方向鍵水平分割、Alt 加下方向鍵垂直分割，Delete 刪除分割，Ctrl 或 Command 加 Z 復原。
						</AlertDescription>
					</Alert>

					<Card variant="material" size="sm">
						<CardBody>
							<div className="huan-stack huan-stack--sm">
								<TextField label="版面名稱" size="sm" value={name} onChange={event => setName(event.target.value)} />
								<TextView label="說明" size="sm" rows={2} value={description} onChange={event => setDescription(event.target.value)} />
							</div>
						</CardBody>
					</Card>

					<Card variant="material" size="sm">
						<CardBody>
							<div className="huan-stack huan-stack--sm">
								<SectionHeading level={2} size="sm" description="每一次發布都會產生一個新的修訂，裝置只會播放已發布的修訂。">
									發布歷史
								</SectionHeading>
								{layout.revisions.length === 0 ? (
									<p className="huan-muted">這個版面還沒有發布過。</p>
								) : (
									<ul className="huan-stack huan-stack--sm">
										{layout.revisions.map(revision => (
											<li key={revision.id} className="huan-row huan-row--between">
												<span className="huan-row huan-row--tight">
													<Badge variant={revision.id === layout.publishedRevisionId ? "success" : "neutral"} size="sm">
														第 {revision.revisionNumber} 版
													</Badge>
													<span className="huan-caption">{revision.note ?? "（沒有備註）"}</span>
												</span>
												<span className="huan-caption">{formatDateTime(revision.publishedAt)}</span>
											</li>
										))}
									</ul>
								)}
							</div>
						</CardBody>
					</Card>
				</div>

				<Inspector
					document={history.document}
					assets={assets}
					selectedNodeId={activeSlotId}
					onSplit={splitSelected}
					onRemoveSlot={removeSelected}
					onClearSlot={() => setSelectedContent(null)}
					onSwapWith={targetId => {
						if (!activeSlotId) return;
						applyDocument(current => swapSlotContent(current, activeSlotId, targetId));
					}}
					onContentChange={setSelectedContent}
					onRatioChange={(splitId, ratio) => applyDocument(current => setSplitRatio(current, splitId, ratio), `ratio-field:${splitId}`)}
					onDirectionChange={(splitId, direction) => applyDocument(current => setSplitDirection(current, splitId, direction))}
					onDocumentChange={updater => applyDocument(updater, "layout-settings")}
				/>
			</div>

			<Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
				<Dialog.Portal>
					<Dialog.Backdrop />
					<Dialog.Viewport>
						<Dialog.Popup closeButton={false}>
							<Dialog.Header>
								<Dialog.Title>發布版面</Dialog.Title>
								<Dialog.Description>發布會把目前的草稿凍結成一個新的修訂，並派送給使用這個版面的裝置。裝置會先下載完所有素材，再原子性切換。</Dialog.Description>
							</Dialog.Header>
							<Dialog.Body>
								<div className="huan-stack">
									<TextView label="發布備註" rows={3} value={publishNote} onChange={event => setPublishNote(event.target.value)} description="選填，最多 280 個字。日後在發布歷史裡看得到。" />
									{saveState !== "saved" ? (
										<Alert status="warning">
											<AlertTitle>草稿尚未完全儲存</AlertTitle>
											<AlertDescription>發布的是伺服器上的草稿。請等待「草稿已儲存」出現後再發布，才不會漏掉最後幾個修改。</AlertDescription>
										</Alert>
									) : null}
									{publish.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>發布失敗</AlertTitle>
											<AlertDescription>{publish.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button
									loading={publish.isPending}
									disabled={saveState !== "saved"}
									onClick={() =>
										publish.mutate(
											{ id: layout.id, body: { note: publishNote.trim().length > 0 ? publishNote.trim() : null } },
											{
												onSuccess: revision => {
													toast.add({ title: `已發布第 ${revision.revisionNumber} 版`, data: { status: "success" } });
													setPublishOpen(false);
													setPublishNote("");
												}
											}
										)
									}
								>
									確認發布
								</Button>
							</Dialog.Footer>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

export function LayoutEditorPage() {
	const { layoutId } = useParams();
	const detail = useLayoutDetailQuery(layoutId ?? null);

	if (detail.isPending) return <ListSkeleton rows={6} label="正在載入版面" />;

	if (detail.isError) {
		return (
			<>
				<PageHeader title="版面編輯器" />
				<QueryErrorAlert error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title="無法載入這個版面" />
			</>
		);
	}

	if (!detail.data) {
		return (
			<EmptyState
				title="找不到這個版面"
				description="它可能已經被刪除。"
				actions={
					<Button render={<RouterLink to="/app/layouts" />} nativeButton={false}>
						回到版面列表
					</Button>
				}
			/>
		);
	}

	// key 讓切換版面時歷史堆疊與選取狀態完全重置，不會把上一個版面的 undo 帶過來。
	return <LayoutEditor key={detail.data.id} layout={detail.data} />;
}
