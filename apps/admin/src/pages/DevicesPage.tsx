import { deviceNeedsAttention, DeviceOnlineBadge, DiskMeter, PLATFORM_LABELS } from "@/components/DeviceStatus";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/components/QueryState";
import { useDeviceListQuery } from "@/lib/devices";
import { formatRelativeTime, formatResolution } from "@/lib/format";
import { Button, EmptyState, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "@linyao.tw/ui";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import { Link as RouterLink } from "react-router";

export function DevicesPage() {
	const devices = useDeviceListQuery();
	const items = devices.data?.items ?? [];

	return (
		<>
			<PageHeader
				title="裝置"
				description="每一台已配對的播放裝置。伺服器只宣告期望狀態，實際下載、驗證與切換都由裝置自己完成。"
				actions={
					<Button render={<RouterLink to="/pair" />} nativeButton={false} startIcon={<PlugsConnectedIcon weight="bold" />}>
						配對新裝置
					</Button>
				}
			/>

			{devices.isError ? <QueryErrorAlert error={devices.error} onRetry={() => void devices.refetch()} retrying={devices.isFetching} title="無法載入裝置列表" /> : null}

			{devices.isPending ? (
				<ListSkeleton rows={4} label="正在載入裝置" />
			) : items.length === 0 ? (
				<EmptyState
					icon={<MonitorIcon weight="bold" />}
					title="還沒有配對任何裝置"
					description="在播放裝置上啟動 HUAN 播放器，畫面會顯示 8 碼配對碼，輸入之後就能完成綁定。"
					actions={
						<Button render={<RouterLink to="/pair" />} nativeButton={false}>
							前往配對
						</Button>
					}
				/>
			) : (
				<TableFrame>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>裝置</TableHead>
								<TableHead>狀態</TableHead>
								<TableHead>平台</TableHead>
								<TableHead>解析度</TableHead>
								<TableHead>播放器版本</TableHead>
								<TableHead>目前版面</TableHead>
								<TableHead>期望／實際版本</TableHead>
								<TableHead>磁碟</TableHead>
								<TableHead>最後回報</TableHead>
								<TableHead>最後同步</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(device => {
								const display = device.reported?.displays.find(entry => entry.primary) ?? device.reported?.displays[0];
								const attention = deviceNeedsAttention(device);
								return (
									<TableRow key={device.id} className={device.online ? undefined : "huan-offline-row"}>
										<TableCell>
											<div className="huan-stack huan-stack--sm">
												<RouterLink to={`/app/devices/${device.id}`}>{device.name}</RouterLink>
												{attention ? <span className="huan-caption">{attention}</span> : null}
											</div>
										</TableCell>
										<TableCell>
											<DeviceOnlineBadge device={device} />
										</TableCell>
										<TableCell>{device.reported ? `${PLATFORM_LABELS[device.reported.platform]} · ${device.reported.arch}` : "—"}</TableCell>
										<TableCell numeric>{formatResolution(display?.width, display?.height)}</TableCell>
										<TableCell>{device.reported?.appVersion ?? "—"}</TableCell>
										<TableCell>{device.defaultLayoutName ?? <span className="huan-caption">未指定預設版面</span>}</TableCell>
										<TableCell numeric>
											{device.desiredVersion} / {device.reported?.desiredVersion ?? "—"}
										</TableCell>
										<TableCell>
											<DiskMeter device={device} />
										</TableCell>
										<TableCell>{formatRelativeTime(device.lastSeenAt)}</TableCell>
										<TableCell>{formatRelativeTime(device.reported?.lastSyncAt ?? null)}</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</TableFrame>
			)}
		</>
	);
}
