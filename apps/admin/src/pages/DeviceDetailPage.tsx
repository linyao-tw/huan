import { DeviceOnlineBadge, DiskMeter, PlatformLabel } from "@/components/DeviceStatus";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/components/QueryState";
import { useDeviceQuery } from "@/lib/devices";
import { formatDateTime, formatRelativeTime, formatResolution } from "@/lib/format";
import { useMediaListQuery } from "@/lib/media";
import { DeviceActions } from "@/pages/devices/DeviceActions";
import { formatBytes, formatUptimeSeconds } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardBody, EmptyState, Progress, SectionHeading, Separator } from "@linyao.tw/ui";
import { WarningOctagonIcon } from "@phosphor-icons/react/dist/csr/WarningOctagon";
import { Link as RouterLink, useParams } from "react-router";

export function DeviceDetailPage() {
	const { deviceId } = useParams();
	const device = useDeviceQuery(deviceId ?? null);
	const media = useMediaListQuery({ limit: 200 });

	if (device.isPending) return <ListSkeleton rows={6} label="正在載入裝置" />;

	if (device.isError) {
		return (
			<>
				<PageHeader title="裝置詳情" />
				<QueryErrorAlert error={device.error} onRetry={() => void device.refetch()} retrying={device.isFetching} title="無法載入這台裝置" />
			</>
		);
	}

	if (!device.data) {
		return (
			<EmptyState
				title="找不到這台裝置"
				description="它可能已經解除綁定。"
				actions={
					<Button render={<RouterLink to="/app/devices" />} nativeButton={false}>
						回到裝置列表
					</Button>
				}
			/>
		);
	}

	const current = device.data;
	const reported = current.reported;
	const assetNames = new Map((media.data?.items ?? []).map(asset => [asset.id, asset.name]));
	const readyCount = reported?.readyAssetIds.length ?? 0;
	const pendingCount = reported?.pendingAssetIds.length ?? 0;
	const totalAssets = readyCount + pendingCount;
	const versionBehind = reported !== null && reported.desiredVersion !== current.desiredVersion;

	return (
		<>
			<PageHeader
				title={
					<span className="huan-row huan-row--tight">
						{current.name}
						<DeviceOnlineBadge device={current} />
					</span>
				}
				description={`最後回報 ${formatRelativeTime(current.lastSeenAt)}，最後同步 ${formatRelativeTime(reported?.lastSyncAt ?? null)}`}
				actions={<DeviceActions device={current} />}
			/>

			{!current.online ? (
				<Alert status="danger">
					<AlertTitle>這台裝置目前離線</AlertTitle>
					<AlertDescription>
						離線期間畫面仍會播放本機已下載的內容，但新發布的版面要等連線恢復、所有檔案下載並驗證完成後才會切換。下面顯示的是最後一次回報的狀態，不代表現在的實際情形。
					</AlertDescription>
				</Alert>
			) : null}

			{reported?.storageError ? (
				<Alert status="danger" live="polite">
					<AlertTitle>
						<span className="huan-row huan-row--tight">
							<WarningOctagonIcon weight="bold" aria-hidden="true" /> 儲存空間錯誤
						</span>
					</AlertTitle>
					<AlertDescription>{reported.storageError}</AlertDescription>
				</Alert>
			) : null}

			{versionBehind ? (
				<Alert status="warning">
					<AlertTitle>裝置版本落後</AlertTitle>
					<AlertDescription>
						伺服器期望第 {current.desiredVersion} 版，裝置回報的是第 {reported?.desiredVersion ?? "未知"} 版。裝置會自行補上，通常代表素材還在下載中。
					</AlertDescription>
				</Alert>
			) : null}

			<div className="huan-card-grid">
				<Card variant="material">
					<CardBody>
						<div className="huan-stack huan-stack--sm">
							<SectionHeading level={2} size="sm">
								基本資訊
							</SectionHeading>
							<dl className="huan-definition">
								<dt>裝置 ID</dt>
								<dd className="huan-truncate">{current.id}</dd>
								<dt>平台</dt>
								<dd>
									<PlatformLabel platform={reported?.platform} arch={reported?.arch} />
								</dd>
								<dt>作業系統</dt>
								<dd>{reported?.osVersion ?? "—"}</dd>
								<dt>播放器版本</dt>
								<dd>{reported?.appVersion ?? "—"}</dd>
								<dt>協定版本</dt>
								<dd className="huan-numeric">{reported?.protocolVersion ?? "—"}</dd>
								<dt>配對時間</dt>
								<dd>{formatDateTime(current.pairedAt)}</dd>
								<dt>連續執行</dt>
								<dd>{formatUptimeSeconds(reported?.uptimeSeconds ?? null)}</dd>
								<dt>溫度</dt>
								<dd className="huan-numeric">{reported?.temperatureCelsius !== null && reported?.temperatureCelsius !== undefined ? `${reported.temperatureCelsius.toFixed(1)} °C` : "未回報"}</dd>
							</dl>
						</div>
					</CardBody>
				</Card>

				<Card variant="material">
					<CardBody>
						<div className="huan-stack huan-stack--sm">
							<SectionHeading level={2} size="sm">
								顯示器
							</SectionHeading>
							{!reported || reported.displays.length === 0 ? (
								<p className="huan-muted">裝置尚未回報顯示器資訊。</p>
							) : (
								<ul className="huan-stack huan-stack--sm">
									{reported.displays.map(display => (
										<li key={display.id} className="huan-row huan-row--between">
											<span className="huan-stack huan-stack--sm">
												<span>{display.label}</span>
												<span className="huan-caption huan-numeric">
													{formatResolution(display.width, display.height)} · {display.orientation === "landscape" ? "橫向" : "直向"} · 縮放 {display.scaleFactor}x
												</span>
											</span>
											{display.primary ? <Badge variant="accent">主要</Badge> : null}
										</li>
									))}
								</ul>
							)}
						</div>
					</CardBody>
				</Card>

				<Card variant="material">
					<CardBody>
						<div className="huan-stack huan-stack--sm">
							<SectionHeading level={2} size="sm">
								儲存空間
							</SectionHeading>
							<DiskMeter device={current} />
							<dl className="huan-definition">
								<dt>可用空間</dt>
								<dd className="huan-numeric">{formatBytes(reported?.diskFreeBytes ?? null)}</dd>
								<dt>總容量</dt>
								<dd className="huan-numeric">{formatBytes(reported?.diskTotalBytes ?? null)}</dd>
							</dl>
						</div>
					</CardBody>
				</Card>

				<Card variant="material">
					<CardBody>
						<div className="huan-stack huan-stack--sm">
							<SectionHeading level={2} size="sm">
								目前播放
							</SectionHeading>
							<dl className="huan-definition">
								<dt>預設版面</dt>
								<dd>{current.defaultLayoutName ?? "未指定"}</dd>
								<dt>目前版面修訂</dt>
								<dd className="huan-truncate">{reported?.currentLayoutRevisionId ?? "—"}</dd>
								<dt>目前排程</dt>
								<dd className="huan-truncate">{reported?.currentScheduleId ?? "沒有排程命中"}</dd>
								<dt>期望版本</dt>
								<dd className="huan-numeric">{current.desiredVersion}</dd>
								<dt>回報版本</dt>
								<dd className="huan-numeric">{reported?.desiredVersion ?? "—"}</dd>
							</dl>
						</div>
					</CardBody>
				</Card>
			</div>

			<section className="huan-stack" aria-label="素材同步進度">
				<SectionHeading level={2} size="md" description="裝置必須先下載並以 SHA-256 驗證每一個檔案，才會切換到新的版面。">
					素材同步
				</SectionHeading>

				{!reported ? (
					<EmptyState title="尚未收到任何回報" description="裝置第一次連線後就會出現同步進度。" />
				) : totalAssets === 0 ? (
					<EmptyState title="沒有需要下載的素材" description="目前指派給這台裝置的版面沒有引用任何影片、圖片或 HTML。" />
				) : (
					<div className="huan-stack">
						<Progress label="已完成的素材" value={Math.round((readyCount / totalAssets) * 100)} showValue status={pendingCount > 0 ? "info" : "success"} />
						<p className="huan-muted">
							已就緒 {readyCount} 個，待下載 {pendingCount} 個。
						</p>

						{pendingCount > 0 ? (
							<Card variant="inset" size="sm">
								<CardBody>
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">待下載</span>
										<ul className="huan-stack huan-stack--sm">
											{reported.pendingAssetIds.map(assetId => (
												<li key={assetId} className="huan-truncate">
													{assetNames.get(assetId) ?? assetId}
												</li>
											))}
										</ul>
									</div>
								</CardBody>
							</Card>
						) : null}

						{readyCount > 0 ? (
							<>
								<Separator spacing="sm" />
								<Card variant="inset" size="sm">
									<CardBody>
										<div className="huan-stack huan-stack--sm">
											<span className="huan-muted">已就緒</span>
											<ul className="huan-stack huan-stack--sm">
												{reported.readyAssetIds.map(assetId => (
													<li key={assetId} className="huan-truncate">
														{assetNames.get(assetId) ?? assetId}
													</li>
												))}
											</ul>
										</div>
									</CardBody>
								</Card>
							</>
						) : null}
					</div>
				)}
			</section>
		</>
	);
}
