import { useForceSyncMutation, useRestartPlayerMutation, useUnbindDeviceMutation, useUpdateDeviceMutation } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { AssetPicker } from "@/features/media/AssetPicker";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import type { Device, DeviceIdleMode } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, Dialog, SegmentedControl, SegmentedControlItem, Select, TextField, useToastManager } from "@linyao.tw/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { PowerIcon } from "@phosphor-icons/react/dist/csr/Power";
import { useState } from "react";
import { useNavigate } from "react-router";

type PendingAction = "unbind" | "force-sync" | "restart" | null;

const IDLE_HINTS: Record<DeviceIdleMode, string> = {
	brand: "顯示 HUAN 的待命畫面。現場一眼就知道機器是好的，只是還沒有內容。",
	black: "整片黑。看板通常要這個——待命畫面本身也是一種內容。",
	image: "一直顯示指定的那張圖，例如 logo 牆。圖會先下載到裝置上，斷網也看得到。"
};

export function DeviceActions({ device, size = "sm" }: { device: Device; size?: "sm" | "md" }) {
	const navigate = useNavigate();
	const toast = useToastManager();
	const layouts = useLayoutListQuery();
	const update = useUpdateDeviceMutation();
	const unbind = useUnbindDeviceMutation();
	const forceSync = useForceSyncMutation();
	const restart = useRestartPlayerMutation();

	const [renameOpen, setRenameOpen] = useState(false);
	const [name, setName] = useState(device.name);
	const [defaultLayoutId, setDefaultLayoutId] = useState<string | null>(device.defaultLayoutId);
	const [idleMode, setIdleMode] = useState<DeviceIdleMode>(device.idle.mode);
	const [idleImageAssetId, setIdleImageAssetId] = useState<string | null>(device.idle.imageAssetId);
	const [idleImageName, setIdleImageName] = useState<string | null>(device.idleImageName);
	const [idlePickerOpen, setIdlePickerOpen] = useState(false);
	const [pending, setPending] = useState<PendingAction>(null);

	const close = (): void => setPending(null);

	return (
		<>
			<div className="huan-row huan-row--tight">
				<Button size={size} variant="quiet" startIcon={<PencilSimpleIcon weight="bold" />} onClick={() => setRenameOpen(true)}>
					編輯
				</Button>
				<Button size={size} variant="quiet" startIcon={<ArrowsClockwiseIcon weight="bold" />} onClick={() => setPending("force-sync")} disabled={!device.online}>
					立即更新
				</Button>
				<Button size={size} variant="quiet" startIcon={<PowerIcon weight="bold" />} onClick={() => setPending("restart")} disabled={!device.online}>
					重新啟動
				</Button>
				<Button size={size} variant="quiet" startIcon={<PlugsIcon weight="bold" />} onClick={() => setPending("unbind")}>
					移除裝置
				</Button>
			</div>

			<Dialog.Root
				open={renameOpen}
				onOpenChange={open => {
					setRenameOpen(open);
					if (!open) update.reset();
				}}
			>
				<Dialog.Portal>
					<Dialog.Backdrop />
					<Dialog.Viewport>
						<Dialog.Popup closeButton={false}>
							<form
								onSubmit={event => {
									event.preventDefault();
									update.mutate(
										{ id: device.id, body: { name: name.trim(), defaultLayoutId, idleMode, idleImageAssetId: idleMode === "image" ? idleImageAssetId : null } },
										{
											onSuccess: () => {
												toast.add({ title: "已儲存", data: { status: "success" } });
												setRenameOpen(false);
											}
										}
									);
								}}
							>
								<Dialog.Header>
									<Dialog.Title>編輯裝置</Dialog.Title>
									<Dialog.Description>名稱只用在後台。沒有排程的時段，畫面會播預設版面。</Dialog.Description>
								</Dialog.Header>
								<Dialog.Body>
									<div className="huan-stack">
										<TextField
											label="裝置名稱"
											required
											value={name}
											onChange={event => setName(event.target.value)}
											disabled={update.isPending}
											description="填實際位置最好認，例如「三號店櫥窗」。"
										/>
										<Select
											label="預設版面"
											placeholder="沒有排程時顯示待命畫面"
											value={defaultLayoutId}
											onValueChange={value => setDefaultLayoutId(value)}
											options={(layouts.data?.items ?? []).map(layout => ({ value: layout.id, label: layout.name }))}
											disabled={update.isPending}
										/>
										<div className="huan-stack huan-stack--sm">
											<span className="huan-muted">沒有內容時的畫面</span>
											<SegmentedControl aria-label="沒有內容時的畫面" size="sm" value={idleMode} onValueChange={value => value && setIdleMode(value as DeviceIdleMode)} disabled={update.isPending}>
												<SegmentedControlItem value="brand">待命畫面</SegmentedControlItem>
												<SegmentedControlItem value="black">黑螢幕</SegmentedControlItem>
												<SegmentedControlItem value="image">指定圖片</SegmentedControlItem>
											</SegmentedControl>
											<span className="huan-caption">{IDLE_HINTS[idleMode]}</span>
											{idleMode === "image" ? (
												<div className="huan-row huan-row--tight">
													<span className="huan-truncate huan-grow">{idleImageAssetId ? (idleImageName ?? "已選一張圖片") : "還沒選圖片"}</span>
													<Button size="sm" variant="secondary" startIcon={<ImagesSquareIcon weight="bold" />} onClick={() => setIdlePickerOpen(true)} disabled={update.isPending}>
														{idleImageAssetId ? "換一張" : "選一張"}
													</Button>
												</div>
											) : null}
										</div>
										{update.isError ? (
											<Alert status="danger" live="assertive">
												<AlertTitle>更新失敗</AlertTitle>
												<AlertDescription>{update.error.message}</AlertDescription>
											</Alert>
										) : null}
									</div>
								</Dialog.Body>
								<Dialog.Footer>
									<Dialog.Close render={<Button variant="secondary">取消</Button>} />
									<Button type="submit" loading={update.isPending} disabled={name.trim().length === 0 || (idleMode === "image" && idleImageAssetId === null)}>
										儲存
									</Button>
								</Dialog.Footer>
							</form>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>

			{/* 選擇器放在編輯對話框外面：兩層 portal 疊在一起時，焦點會在關閉內層後回不到外層。 */}
			<AssetPicker
				open={idlePickerOpen}
				onOpenChange={setIdlePickerOpen}
				title="待命時顯示的圖片"
				description="這張圖會跟版面素材一起下載到裝置上，沒有網路也顯示得出來。"
				kinds={["image"]}
				initialSelectedIds={idleImageAssetId ? [idleImageAssetId] : []}
				onConfirm={picked => {
					const asset = picked[0];
					if (!asset) return;
					setIdleImageAssetId(asset.id);
					setIdleImageName(asset.name);
				}}
			/>

			<ConfirmDialog
				open={pending === "force-sync"}
				onOpenChange={open => {
					if (!open) {
						close();
						forceSync.reset();
					}
				}}
				title="現在就更新這台裝置？"
				description="它會馬上重新確認一次該播什麼，缺的檔案會補下載。畫面不會中斷。"
				confirmLabel="立即更新"
				pending={forceSync.isPending}
				errorMessage={forceSync.error?.message ?? null}
				onConfirm={() =>
					forceSync.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已通知裝置更新", data: { status: "success" } });
							close();
						}
					})
				}
			/>

			<ConfirmDialog
				open={pending === "restart"}
				onOpenChange={open => {
					if (!open) {
						close();
						restart.reset();
					}
				}}
				destructive
				title="重新啟動播放器？"
				description="畫面會黑幾秒，然後回到現在的內容。已經下載好的檔案不會不見，還沒下載完的要重來。"
				confirmLabel="重新啟動"
				pending={restart.isPending}
				errorMessage={restart.error?.message ?? null}
				onConfirm={() =>
					restart.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已通知裝置重新啟動", data: { status: "success" } });
							close();
						}
					})
				}
			/>

			<ConfirmDialog
				open={pending === "unbind"}
				onOpenChange={open => {
					if (!open) {
						close();
						unbind.reset();
					}
				}}
				destructive
				title={`把「${device.name}」移出系統？`}
				description="它會立刻停止收到新內容，要重新配對才能加回來。已經下載到裝置上的檔案會留著，畫面還是會繼續播。"
				confirmLabel="移除裝置"
				pending={unbind.isPending}
				errorMessage={unbind.error?.message ?? null}
				onConfirm={() =>
					unbind.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已移除裝置", data: { status: "success" } });
							close();
							void navigate("/app/devices");
						}
					})
				}
			/>
		</>
	);
}
