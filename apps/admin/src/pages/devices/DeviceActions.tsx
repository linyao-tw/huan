import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useForceSyncMutation, useRestartPlayerMutation, useUnbindDeviceMutation, useUpdateDeviceMutation } from "@/lib/devices";
import { useLayoutListQuery } from "@/lib/layouts";
import type { Device } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, Dialog, Select, TextField, useToastManager } from "@linyao.tw/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { PowerIcon } from "@phosphor-icons/react/dist/csr/Power";
import { useState } from "react";
import { useNavigate } from "react-router";

type PendingAction = "unbind" | "force-sync" | "restart" | null;

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
	const [pending, setPending] = useState<PendingAction>(null);

	const close = (): void => setPending(null);

	return (
		<>
			<div className="huan-row huan-row--tight">
				<Button size={size} variant="quiet" startIcon={<PencilSimpleIcon weight="bold" />} onClick={() => setRenameOpen(true)}>
					重新命名
				</Button>
				<Button size={size} variant="quiet" startIcon={<ArrowsClockwiseIcon weight="bold" />} onClick={() => setPending("force-sync")} disabled={!device.online}>
					強制同步
				</Button>
				<Button size={size} variant="quiet" startIcon={<PowerIcon weight="bold" />} onClick={() => setPending("restart")} disabled={!device.online}>
					重啟播放器
				</Button>
				<Button size={size} variant="quiet" startIcon={<PlugsIcon weight="bold" />} onClick={() => setPending("unbind")}>
					解除綁定
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
										{ id: device.id, body: { name: name.trim(), defaultLayoutId } },
										{
											onSuccess: () => {
												toast.add({ title: "已更新裝置", data: { status: "success" } });
												setRenameOpen(false);
											}
										}
									);
								}}
							>
								<Dialog.Header>
									<Dialog.Title>編輯裝置</Dialog.Title>
									<Dialog.Description>名稱只影響後台顯示；預設版面會在沒有任何排程命中時播放。</Dialog.Description>
								</Dialog.Header>
								<Dialog.Body>
									<div className="huan-stack">
										<TextField
											label="裝置名稱"
											required
											value={name}
											onChange={event => setName(event.target.value)}
											disabled={update.isPending}
											description="建議使用實際位置，例如「三號店櫥窗」。"
										/>
										<Select
											label="預設版面"
											placeholder="沒有排程命中時顯示待命畫面"
											value={defaultLayoutId}
											onValueChange={value => setDefaultLayoutId(value)}
											options={(layouts.data?.items ?? []).map(layout => ({ value: layout.id, label: layout.name }))}
											disabled={update.isPending}
										/>
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
									<Button type="submit" loading={update.isPending} disabled={name.trim().length === 0}>
										儲存
									</Button>
								</Dialog.Footer>
							</form>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>

			<ConfirmDialog
				open={pending === "force-sync"}
				onOpenChange={open => {
					if (!open) {
						close();
						forceSync.reset();
					}
				}}
				title="要求裝置立即同步？"
				description="裝置會馬上向伺服器取一次完整狀態並重新下載缺少的檔案。正在播放的內容不會中斷。"
				confirmLabel="立即同步"
				pending={forceSync.isPending}
				errorMessage={forceSync.error?.message ?? null}
				onConfirm={() =>
					forceSync.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已送出同步指令", data: { status: "success" } });
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
				description="畫面會黑屏數秒後回到目前的版面。已下載的素材不會遺失，但正在進行的下載會重來。"
				confirmLabel="重啟播放器"
				pending={restart.isPending}
				errorMessage={restart.error?.message ?? null}
				onConfirm={() =>
					restart.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已送出重啟指令", data: { status: "success" } });
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
				title={`解除綁定「${device.name}」？`}
				description="裝置憑證會立刻失效，這台裝置將無法再取得任何內容，必須重新走一次配對流程才能回來。本機已下載的素材會保留在該裝置上。"
				confirmLabel="解除綁定"
				pending={unbind.isPending}
				errorMessage={unbind.error?.message ?? null}
				onConfirm={() =>
					unbind.mutate(device.id, {
						onSuccess: () => {
							toast.add({ title: "已解除綁定", data: { status: "success" } });
							close();
							void navigate("/app/devices");
						}
					})
				}
			/>
		</>
	);
}
