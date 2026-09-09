import { useDeleteMediaMutation, useMediaUsageQuery, useRenameMediaMutation } from "@/features/media/hooks";
import "@/features/media/media.css";
import { MediaStatusBadge, mediaStatusDetail } from "@/features/media/MediaStatus";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { formatDateTime, formatResolution } from "@/shared/utils/format";
import type { MediaAsset, MediaUsage } from "@huan/protocol";
import { formatBytes, formatDurationMs } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Dialog, Link, Loader, TextField, useToastManager } from "@linyao.tw/ui";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useState } from "react";
import { Link as RouterLink } from "react-router";

const KIND_LABELS: Record<MediaAsset["kind"], string> = { video: "影片", image: "圖片", html: "HTML" };

function usageTotal(usage: MediaUsage | undefined): number {
	if (!usage) return 0;
	return usage.layouts.length + usage.schedules.length + usage.devices.length;
}

function UsageList({ usage }: { usage: MediaUsage }) {
	if (usageTotal(usage) === 0) return <p className="huan-muted">還沒有任何版面、排程或裝置用到這份素材。</p>;
	return (
		<div className="huan-stack huan-stack--sm">
			{usage.layouts.length > 0 ? (
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">版面（{usage.layouts.length}）</span>
					<ul className="huan-stack huan-stack--sm">
						{usage.layouts.map(layout => (
							<li key={layout.id} className="huan-row huan-row--tight">
								<Link render={<RouterLink to={`/app/layouts/${layout.id}`} />} size="sm">
									{layout.name}
								</Link>
								<Badge size="sm" variant={layout.published ? "success" : "neutral"}>
									{layout.published ? "已發布" : "僅草稿"}
								</Badge>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{usage.schedules.length > 0 ? (
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">排程（{usage.schedules.length}）</span>
					<ul className="huan-stack huan-stack--sm">
						{usage.schedules.map(schedule => (
							<li key={schedule.id}>{schedule.name}</li>
						))}
					</ul>
				</div>
			) : null}
			{usage.devices.length > 0 ? (
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">裝置（{usage.devices.length}）</span>
					<ul className="huan-stack huan-stack--sm">
						{usage.devices.map(device => (
							<li key={device.id}>
								<Link render={<RouterLink to={`/app/devices/${device.id}`} />} size="sm">
									{device.name}
								</Link>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

export function MediaDetailDialog({ asset, open, onOpenChange }: { asset: MediaAsset | null; open: boolean; onOpenChange: (open: boolean) => void }) {
	const toast = useToastManager();
	const usage = useMediaUsageQuery(open && asset ? asset.id : null);
	const rename = useRenameMediaMutation();
	const remove = useDeleteMediaMutation();
	/** 表單狀態靠呼叫端的 `key={asset.id}` 重置，比在 effect 裡追蹤 id 更難出錯。 */
	const [name, setName] = useState(asset?.name ?? "");
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (!asset) return null;

	const inUse = usageTotal(usage.data) > 0;
	const playbackAvailable = asset.variants.some(variant => variant.role === "playback" && variant.available);

	return (
		<>
			<Dialog.Root open={open} onOpenChange={onOpenChange}>
				<Dialog.Portal>
					<Dialog.Backdrop />
					<Dialog.Viewport>
						<Dialog.Popup closeButton={false}>
							<Dialog.Header>
								<Dialog.Title>{asset.name}</Dialog.Title>
								<Dialog.Description>{mediaStatusDetail(asset)}</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									<div className="huan-row huan-row--tight">
										<MediaStatusBadge status={asset.status} />
										<Badge variant="neutral">{KIND_LABELS[asset.kind]}</Badge>
										{!playbackAvailable && asset.status === "ready" ? <Badge variant="warning">伺服器上已無檔案</Badge> : null}
									</div>

									{asset.status === "needs_reupload" ? (
										<Alert status="warning">
											<AlertTitle>這份素材需要重新上傳</AlertTitle>
											<AlertDescription>伺服器上已經沒有這個檔案了。重新上傳同一個檔案，下面列出的版面與排程就會恢復正常。</AlertDescription>
										</Alert>
									) : null}

									{asset.status === "failed" && asset.errorMessage ? (
										<Alert status="danger">
											<AlertTitle>轉檔失敗</AlertTitle>
											<AlertDescription>{asset.errorMessage}</AlertDescription>
										</Alert>
									) : null}

									{asset.previewUrl && asset.kind === "image" ? <img className="huan-media-preview" src={asset.previewUrl} alt={`${asset.name} 預覽`} /> : null}
									{asset.previewUrl && asset.kind === "video" ? <video className="huan-media-preview" src={asset.previewUrl} muted controls playsInline preload="metadata" /> : null}

									<dl className="huan-definition">
										<dt>原始檔名</dt>
										<dd className="huan-truncate">{asset.originalFilename}</dd>
										<dt>解析度</dt>
										<dd className="huan-numeric">{formatResolution(asset.probe?.width, asset.probe?.height)}</dd>
										<dt>長度</dt>
										<dd className="huan-numeric">{asset.kind === "video" ? formatDurationMs(asset.probe?.durationMs ?? null) : "—"}</dd>
										<dt>影像格式</dt>
										<dd>{asset.probe?.videoCodec ?? "—"}</dd>
										<dt>音訊格式</dt>
										<dd>{asset.probe?.audioCodec ?? "—"}</dd>
										<dt>畫面更新率</dt>
										<dd className="huan-numeric">{asset.probe?.frameRate ? `${asset.probe.frameRate.toFixed(2)} fps` : "—"}</dd>
										<dt>檔案大小</dt>
										<dd className="huan-numeric">{formatBytes(asset.variants.find(variant => variant.role === "playback")?.sizeBytes ?? asset.variants[0]?.sizeBytes ?? null)}</dd>
										<dt>建立時間</dt>
										<dd>{formatDateTime(asset.createdAt)}</dd>
										<dt>最後更新</dt>
										<dd>{formatDateTime(asset.updatedAt)}</dd>
									</dl>

									<TextField label="素材名稱" value={name} onChange={event => setName(event.target.value)} disabled={rename.isPending} description="只改後台看到的名稱，不影響已經在播的內容。" />

									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">使用情形</span>
										{usage.isPending ? (
											<Loader label="正在檢查使用情形" size="sm" />
										) : usage.isError ? (
											<Alert status="danger">無法取得使用情形：{usage.error.message}</Alert>
										) : usage.data ? (
											<UsageList usage={usage.data} />
										) : null}
									</div>
								</div>
							</Dialog.Body>

							<Dialog.Footer align="between">
								<Button variant="danger" startIcon={<TrashIcon weight="bold" />} onClick={() => setConfirmOpen(true)} disabled={usage.isPending}>
									刪除素材
								</Button>
								<div className="huan-row huan-row--tight">
									<Dialog.Close render={<Button variant="secondary">關閉</Button>} />
									<Button
										loading={rename.isPending}
										disabled={name.trim().length === 0 || name === asset.name}
										onClick={() =>
											rename.mutate(
												{ id: asset.id, body: { name: name.trim() } },
												{
													onSuccess: () => toast.add({ title: "已更新素材名稱", data: { status: "success" } }),
													onError: error => toast.add({ title: "更新失敗", description: error.message, data: { status: "danger" } })
												}
											)
										}
									>
										儲存名稱
									</Button>
								</div>
							</Dialog.Footer>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				destructive={!inUse}
				title={inUse ? "無法刪除：素材仍在使用中" : "刪除這份素材？"}
				description={inUse ? "請先把下面這些版面、排程與裝置改成其他素材，再回來刪除。" : "刪除後無法復原。正在播這份素材的裝置，下次連上線就會改播預設內容。"}
				confirmLabel={inUse ? "我知道了" : "刪除"}
				cancelLabel={inUse ? "關閉" : "取消"}
				confirmDisabled={remove.isPending}
				pending={remove.isPending}
				errorMessage={remove.error?.message ?? null}
				onConfirm={() => {
					if (inUse) {
						setConfirmOpen(false);
						return;
					}
					remove.mutate(asset.id, {
						onSuccess: () => {
							toast.add({ title: "已刪除素材", data: { status: "success" } });
							setConfirmOpen(false);
							onOpenChange(false);
						}
					});
				}}
			>
				{inUse && usage.data ? <UsageList usage={usage.data} /> : null}
			</ConfirmDialog>
		</>
	);
}
