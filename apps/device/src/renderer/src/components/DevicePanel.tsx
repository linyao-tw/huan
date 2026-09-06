import type { DeviceSnapshot } from "@/shared/ipc";
import { formatBytes, formatUptimeSeconds } from "@huan/shared";
import { AlertDialog, Badge, Button, Card, CardBody, CardHeader, CardTitle, IconButton, Meter, Separator } from "@linyao.tw/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

interface DevicePanelProps {
	snapshot: DeviceSnapshot;
	onClose: () => void;
	onSync: () => void;
	onUnbind: () => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
	return (
		<>
			<span className="huan-panel__label">{label}</span>
			<span className="huan-panel__value">{value}</span>
		</>
	);
}

/**
 * 綁定後裝置本機唯一的介面。
 *
 * 這裡刻意只有資訊、連線狀態與解除綁定，沒有任何內容編輯：
 * 版面、素材與排程一律由後台控制，現場能改的話就沒有「集中管理」可言了。
 */
export function DevicePanel({ snapshot, onClose, onSync, onUnbind }: DevicePanelProps): React.JSX.Element {
	const usedRatio = snapshot.diskTotalBytes && snapshot.diskFreeBytes !== null ? (snapshot.diskTotalBytes - snapshot.diskFreeBytes) / snapshot.diskTotalBytes : null;

	return (
		<Card className="huan-panel" variant="elevated">
			<CardHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
				<CardTitle level={2}>裝置資訊</CardTitle>
				<IconButton aria-label="關閉裝置資訊" variant="quiet" onClick={onClose}>
					<XIcon weight="bold" />
				</IconButton>
			</CardHeader>

			<CardBody style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
				<div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
					<Badge variant={snapshot.online ? "success" : "warning"}>{snapshot.online ? "已連線" : "離線"}</Badge>
					{snapshot.revokePending ? <Badge variant="danger">待完成撤銷</Badge> : null}
					{snapshot.desiredVersion !== null && snapshot.activeVersion !== snapshot.desiredVersion ? <Badge variant="accent">同步中</Badge> : null}
				</div>

				{snapshot.storageError ? (
					<Badge variant="danger" size="md">
						{snapshot.storageError}
					</Badge>
				) : null}

				<div className="huan-panel__grid">
					<Row label="名稱" value={snapshot.deviceName} />
					<Row label="裝置 ID" value={snapshot.deviceId ?? "尚未綁定"} />
					<Row label="伺服器" value={snapshot.serverUrl} />
					<Row label="App 版本" value={snapshot.appVersion} />
					<Row label="平台" value={`${snapshot.platform} / ${snapshot.arch}`} />
					<Row label="作業系統" value={snapshot.osVersion ?? "—"} />
					<Row label="顯示器" value={snapshot.displays.map(display => `${display.width}×${display.height}`).join("、") || "—"} />
					<Row label="目前版面" value={snapshot.currentLayoutName ?? "待命"} />
					<Row label="目前排程" value={snapshot.currentScheduleName ?? "預設版面"} />
					<Row label="目標 / 回報版本" value={`${snapshot.desiredVersion ?? "—"} / ${snapshot.activeVersion ?? "—"}`} />
					<Row label="素材" value={`${snapshot.readyAssetCount} / ${snapshot.totalAssetCount}`} />
					<Row label="最後同步" value={snapshot.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toLocaleString("zh-TW") : "—"} />
					<Row label="運作時間" value={formatUptimeSeconds(snapshot.uptimeSeconds)} />
					<Row label="溫度" value={snapshot.temperatureCelsius === null ? "—" : `${snapshot.temperatureCelsius} °C`} />
				</div>

				{usedRatio !== null ? (
					<Meter
						label={`儲存空間：剩餘 ${formatBytes(snapshot.diskFreeBytes)} / ${formatBytes(snapshot.diskTotalBytes)}`}
						value={usedRatio}
						max={1}
						status={usedRatio > 0.9 ? "danger" : usedRatio > 0.75 ? "warning" : "neutral"}
					/>
				) : null}

				<Separator spacing="sm" />

				<div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
					<Button variant="secondary" startIcon={<ArrowsClockwiseIcon weight="bold" />} onClick={onSync}>
						立即同步
					</Button>

					<AlertDialog.Root>
						<AlertDialog.Trigger
							render={triggerProps => (
								<Button {...triggerProps} variant="danger">
									解除綁定
								</Button>
							)}
						/>
						<AlertDialog.Portal>
							<AlertDialog.Backdrop />
							<AlertDialog.Viewport>
								<AlertDialog.Popup>
									<AlertDialog.Header>
										<AlertDialog.Title>確定要解除綁定？</AlertDialog.Title>
										<AlertDialog.Description>這台裝置會立即停止接受後台控制並回到配對畫面。離線時解除綁定同樣立即生效，下次連上線後會完成伺服器端的撤銷。</AlertDialog.Description>
									</AlertDialog.Header>
									<AlertDialog.Actions>
										<AlertDialog.Close
											render={closeProps => (
												<Button {...closeProps} variant="secondary">
													取消
												</Button>
											)}
										/>
										<AlertDialog.Close
											render={closeProps => (
												<Button {...closeProps} variant="danger" onClick={onUnbind}>
													解除綁定
												</Button>
											)}
										/>
									</AlertDialog.Actions>
								</AlertDialog.Popup>
							</AlertDialog.Viewport>
						</AlertDialog.Portal>
					</AlertDialog.Root>
				</div>
			</CardBody>
		</Card>
	);
}
