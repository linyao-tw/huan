import { DeviceActions } from "@/features/devices/DeviceActions";
import "@/features/devices/devices.css";
import { DeviceContentBadge, deviceContentState, DeviceOnlineBadge, DiskMeter, PlatformLabel } from "@/features/devices/DeviceStatus";
import { useDeviceQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { useMediaListQuery } from "@/features/media/hooks";
import { useScheduleListQuery } from "@/features/schedules/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDateTime, formatRelativeTime, formatResolution } from "@/shared/utils/format";
import { formatUptimeSeconds } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Progress, SectionHeading, Separator } from "@linyao.tw/ui";
import { WarningOctagonIcon } from "@phosphor-icons/react/dist/csr/WarningOctagon";
import { Link as RouterLink, useParams } from "react-router";

export function DeviceDetailPage() {
	const { deviceId } = useParams();
	const device = useDeviceQuery(deviceId ?? null);
	const media = useMediaListQuery({ limit: 200 });
	const layouts = useLayoutListQuery();
	const schedules = useScheduleListQuery();

	if (device.isPending) return <ListSkeleton rows={6} label="正在載入裝置" />;

	if (device.isError) {
		return (
			<>
				<PageHeader title="裝置" />
				<QueryErrorAlert error={device.error} onRetry={() => void device.refetch()} retrying={device.isFetching} title="讀不到這台裝置" />
			</>
		);
	}

	if (!device.data) {
		return (
			<EmptyState
				title="找不到這台裝置"
				description="它可能已經被移出系統了。"
				actions={
					<Button render={<RouterLink to="/app/devices" />} nativeButton={false}>
						回到裝置清單
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
	const content = deviceContentState(current);
	/** 「待命畫面」三個字在這一頁已經出現過，這裡要說的是那三種模式實際看起來是什麼樣子。 */
	const idleLabel = current.idle.mode === "black" ? "黑螢幕" : current.idle.mode === "image" ? `圖片：${current.idleImageName ?? "已被刪除"}` : "HUAN 待命畫面";

	/*
	 * 畫面上一律顯示名稱，不顯示 UUID。
	 *
	 * 協定送來的是版面修訂與排程的識別碼，但「00000000-0000-4000-…」對店長沒有
	 * 任何意義。已發布的修訂可以從版面清單反查回名稱；查不到就代表裝置還停在
	 * 更早的一版 —— 那也是一句可以直接說出口的話。
	 */
	const currentSchedule = reported?.currentScheduleId ? ((schedules.data?.items ?? []).find(schedule => schedule.id === reported.currentScheduleId) ?? null) : null;
	const playingLayout = ((): string => {
		if (!reported) return "還沒回報";
		if (!reported.currentLayoutRevisionId) return "待命畫面";
		const published = (layouts.data?.items ?? []).find(layout => layout.publishedRevisionId === reported.currentLayoutRevisionId);
		if (published) return published.name;
		if (currentSchedule) return `${currentSchedule.layoutName}（較早的版本）`;
		return "較早版本的版面";
	})();

	return (
		<>
			<PageHeader
				title={
					<span className="huan-row huan-row--tight">
						{current.name}
						<DeviceOnlineBadge device={current} />
					</span>
				}
				description={`最後連線 ${formatRelativeTime(current.lastSeenAt)}・上次取得內容 ${formatRelativeTime(reported?.lastSyncAt ?? null)}`}
				actions={<DeviceActions device={current} />}
			/>

			{!current.online ? (
				<Alert status="danger">
					<AlertTitle>這台裝置連不上</AlertTitle>
					<AlertDescription>畫面還在播最後收到的內容。新的版面要等它重新連上、檔案全部下載完才會換過去。下面顯示的是它最後一次回報的狀況。</AlertDescription>
				</Alert>
			) : null}

			{reported?.storageError ? (
				<Alert status="danger" live="polite">
					<AlertTitle>
						<span className="huan-row huan-row--tight">
							<WarningOctagonIcon weight="bold" aria-hidden="true" /> 裝置存不下檔案
						</span>
					</AlertTitle>
					<AlertDescription>裝置回報：{reported.storageError}。在清出空間之前，新內容不會下載。</AlertDescription>
				</Alert>
			) : null}

			{versionBehind ? (
				<Alert status="warning">
					<AlertTitle>內容還沒更新完</AlertTitle>
					<AlertDescription>這台裝置還在下載新版面要用的檔案，下載完會自己換過去。這段期間畫面照常播舊的內容。</AlertDescription>
				</Alert>
			) : null}

			{/* 卡片內的標題用 CardTitle，不用 SectionHeading：後者在設計系統裡是列表軌道標籤，自帶背景與縮排。 */}
			<Card variant="material">
				<CardHeader>
					<CardTitle level={2}>現在播什麼</CardTitle>
				</CardHeader>
				<CardBody>
					<dl className="huan-device-facts">
						<div>
							<dt>畫面上的版面</dt>
							<dd>{playingLayout}</dd>
						</div>
						<div>
							<dt>依照的排程</dt>
							<dd>{currentSchedule ? currentSchedule.name : "目前沒有排程生效"}</dd>
						</div>
						<div>
							<dt>沒有排程時播</dt>
							<dd>{current.defaultLayoutName ?? "待命畫面"}</dd>
						</div>
						<div>
							<dt>連版面都沒有時</dt>
							<dd>{idleLabel}</dd>
						</div>
						<div>
							<dt>內容</dt>
							<dd>
								<span className="huan-row huan-row--tight">
									<DeviceContentBadge device={current} />
									{content.detail ? <span className="huan-caption">{content.detail}</span> : null}
								</span>
							</dd>
						</div>
					</dl>
				</CardBody>
			</Card>

			<div className="huan-device-grid">
				<Card variant="material">
					<CardHeader>
						<CardTitle level={2}>這台裝置</CardTitle>
					</CardHeader>
					<CardBody>
						<dl className="huan-device-def">
							<dt>系統</dt>
							<dd>
								<PlatformLabel platform={reported?.platform} arch={reported?.arch} />
							</dd>
							<dt>作業系統</dt>
							<dd>{reported?.osVersion ?? "—"}</dd>
							<dt>播放器版本</dt>
							<dd className="huan-device-def__atom">{reported?.appVersion ?? "—"}</dd>
							<dt>加入時間</dt>
							<dd className="huan-device-def__atom huan-numeric">{formatDateTime(current.pairedAt)}</dd>
							<dt>已連續運作</dt>
							<dd className="huan-device-def__atom">{formatUptimeSeconds(reported?.uptimeSeconds ?? null)}</dd>
							<dt>溫度</dt>
							<dd className="huan-device-def__atom huan-numeric">
								{reported?.temperatureCelsius !== null && reported?.temperatureCelsius !== undefined ? `${reported.temperatureCelsius.toFixed(1)} °C` : "未回報"}
							</dd>
							<dt>裝置編號</dt>
							<dd className="huan-device-def__atom huan-numeric" title={current.id}>
								{current.id}
							</dd>
						</dl>
					</CardBody>
				</Card>

				<Card variant="material">
					<CardHeader>
						<CardTitle level={2}>螢幕與儲存空間</CardTitle>
					</CardHeader>
					<CardBody>
						<div className="huan-stack huan-stack--sm">
							{!reported || reported.displays.length === 0 ? (
								<p className="huan-muted">裝置還沒回報螢幕資訊。</p>
							) : (
								<ul className="huan-device-displays">
									{reported.displays.map(display => (
										<li key={display.id} className="huan-stack huan-stack--sm">
											<span className="huan-row huan-row--tight">
												<span>{display.label}</span>
												{display.primary ? (
													<Badge variant="accent" size="sm">
														主螢幕
													</Badge>
												) : null}
											</span>
											<span className="huan-caption huan-numeric">
												{formatResolution(display.width, display.height)}・{display.orientation === "landscape" ? "橫向" : "直向"}・縮放 {display.scaleFactor}x
											</span>
										</li>
									))}
								</ul>
							)}
							<Separator spacing="sm" />
							<DiskMeter device={current} />
						</div>
					</CardBody>
				</Card>
			</div>

			<section className="huan-stack" aria-label="檔案下載">
				<SectionHeading level={2} size="md" description="所有圖片和影片都下載完，畫面才會換成新版面。">
					檔案下載
				</SectionHeading>

				{!reported ? (
					<EmptyState title="還沒連上過" description="裝置第一次連上之後，這裡會顯示下載進度。" />
				) : totalAssets === 0 ? (
					<EmptyState title="沒有要下載的檔案" description="這台裝置目前的版面沒有用到任何圖片或影片。" />
				) : (
					<div className="huan-stack">
						<Progress label="下載進度" value={Math.round((readyCount / totalAssets) * 100)} showValue status={pendingCount > 0 ? "info" : "success"} />
						<p className="huan-muted">{pendingCount > 0 ? `已完成 ${readyCount} 個，還有 ${pendingCount} 個在下載。` : `${readyCount} 個檔案全部下載好了。`}</p>

						{pendingCount > 0 ? (
							<Card variant="inset" size="sm">
								<CardBody>
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">還在下載</span>
										<ul className="huan-device-assets">
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
							<Card variant="inset" size="sm">
								<CardBody>
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">已完成</span>
										<ul className="huan-device-assets">
											{reported.readyAssetIds.map(assetId => (
												<li key={assetId} className="huan-truncate">
													{assetNames.get(assetId) ?? assetId}
												</li>
											))}
										</ul>
									</div>
								</CardBody>
							</Card>
						) : null}
					</div>
				)}
			</section>
		</>
	);
}
