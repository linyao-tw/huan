import "@/features/devices/devices.css";
import { DeviceContentBadge, DeviceOnlineBadge, DiskMeter, PlatformLabel } from "@/features/devices/DeviceStatus";
import { useDeviceListQuery } from "@/features/devices/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";
import { formatRelativeTime, formatResolution } from "@/shared/utils/format";
import { Button, EmptyState, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "@linyao.tw/ui";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import { Link as RouterLink } from "react-router";

export function DevicesPage() {
	useDocumentTitle("裝置");

	const devices = useDeviceListQuery();
	const items = devices.data?.items ?? [];

	/*
	 * 空狀態只在「查得到、而且真的沒有」時才出現。
	 *
	 * 原本錯誤與空狀態是各自判斷的，載入失敗時會同時看到「無法載入」與
	 * 「還沒有配對任何裝置」—— 兩句話互相矛盾，而且後面那句是錯的：
	 * 沒查到不等於沒有。
	 */
	const showEmptyState = !devices.isPending && !devices.isError && items.length === 0;

	return (
		<>
			<PageHeader
				title="裝置"
				description="所有已加入的播放螢幕。內容會先下載到裝置上，網路斷掉也會繼續播。"
				actions={
					<Button render={<RouterLink to="/pair" />} nativeButton={false} startIcon={<PlugsConnectedIcon weight="bold" />}>
						新增裝置
					</Button>
				}
			/>

			{devices.isError ? <QueryErrorAlert error={devices.error} onRetry={() => void devices.refetch()} retrying={devices.isFetching} title="讀不到裝置清單" /> : null}

			{devices.isPending ? <ListSkeleton rows={5} label="正在載入裝置" /> : null}

			{showEmptyState ? (
				<EmptyState
					icon={<MonitorIcon weight="bold" />}
					title="還沒有任何裝置"
					description="在要播放的螢幕上打開 HUAN 播放器，畫面會顯示一組 8 位數的配對碼，輸入後就會出現在這裡。"
					actions={
						<Button render={<RouterLink to="/pair" />} nativeButton={false}>
							新增裝置
						</Button>
					}
				/>
			) : null}

			{items.length > 0 ? (
				<TableFrame>
					{/* 欄位多，給表格一個最小寬度，中文才會觸發橫向捲動而不是把每一欄壓成一個字。 */}
					<Table className="huan-table--wide">
						<TableHeader>
							<TableRow>
								<TableHead>裝置</TableHead>
								<TableHead>狀態</TableHead>
								<TableHead>內容</TableHead>
								<TableHead>預設版面</TableHead>
								<TableHead>系統</TableHead>
								<TableHead>螢幕</TableHead>
								<TableHead>儲存空間</TableHead>
								<TableHead>最後連線</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(device => {
								const display = device.reported?.displays.find(entry => entry.primary) ?? device.reported?.displays[0];
								return (
									<TableRow key={device.id}>
										<TableCell>
											<RouterLink to={`/app/devices/${device.id}`} className="huan-device-link">
												{device.name}
											</RouterLink>
										</TableCell>
										<TableCell>
											<DeviceOnlineBadge device={device} />
										</TableCell>
										<TableCell>
											<DeviceContentBadge device={device} />
										</TableCell>
										<TableCell>{device.defaultLayoutName ?? <span className="huan-caption">未指定</span>}</TableCell>
										<TableCell>
											<PlatformLabel platform={device.reported?.platform} arch={device.reported?.arch} />
										</TableCell>
										<TableCell numeric>{formatResolution(display?.width, display?.height)}</TableCell>
										<TableCell>
											<DiskMeter device={device} compact />
										</TableCell>
										<TableCell>{formatRelativeTime(device.lastSeenAt)}</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</TableFrame>
			) : null}
		</>
	);
}
