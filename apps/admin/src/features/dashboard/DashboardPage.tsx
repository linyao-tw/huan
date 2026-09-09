import { deviceNeedsAttention } from "@/features/devices/DeviceStatus";
import { useDeviceListQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { useMediaListQuery } from "@/features/media/hooks";
import { useScheduleListQuery } from "@/features/schedules/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { CardsSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatRelativeTime } from "@/shared/utils/format";
import type { Device } from "@huan/protocol";
import { Badge, Button, Card, CardBody, EmptyState, ListCell, SectionHeading } from "@linyao.tw/ui";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

function StatCard({ label, value, hint, to, tone }: { label: string; value: ReactNode; hint?: string; to: string; tone?: "danger" | "warning" | "success" }) {
	return (
		<RouterLink to={to} className="huan-stat-link">
			<Card variant={tone ? "elevated" : "material"} size="sm">
				<CardBody>
					<div className="huan-stat">
						<span className="huan-stat__label">{label}</span>
						<span className="huan-stat__value">{value}</span>
						{hint ? <span className="huan-caption">{hint}</span> : null}
						{tone ? (
							<span>
								<Badge variant={tone === "success" ? "success" : tone === "warning" ? "warning" : "danger"} size="sm">
									{tone === "success" ? "正常" : "需要處理"}
								</Badge>
							</span>
						) : null}
					</div>
				</CardBody>
			</Card>
		</RouterLink>
	);
}

export function DashboardPage() {
	const devices = useDeviceListQuery();
	const media = useMediaListQuery({ limit: 200 });
	const layouts = useLayoutListQuery();
	const schedules = useScheduleListQuery();

	const isPending = devices.isPending || media.isPending || layouts.isPending || schedules.isPending;
	const firstError = devices.error ?? media.error ?? layouts.error ?? schedules.error;

	const deviceItems = devices.data?.items ?? [];
	const mediaItems = media.data?.items ?? [];
	const layoutItems = layouts.data?.items ?? [];
	const scheduleItems = schedules.data?.items ?? [];

	const online = deviceItems.filter(device => device.online).length;
	const offline = deviceItems.length - online;
	const processing = mediaItems.filter(asset => asset.status === "processing" || asset.status === "uploaded" || asset.status === "uploading").length;
	const failed = mediaItems.filter(asset => asset.status === "failed").length;
	const needsReupload = mediaItems.filter(asset => asset.status === "needs_reupload").length;
	const published = layoutItems.filter(layout => layout.publishedRevisionId !== null).length;
	const enabledSchedules = scheduleItems.filter(schedule => schedule.enabled).length;

	const attention = deviceItems.map(device => ({ device, reason: deviceNeedsAttention(device) })).filter((entry): entry is { device: Device; reason: string } => entry.reason !== null);

	return (
		<>
			<PageHeader title="總覽" description="這個工作區目前的狀態。每一張卡片都可以點進去處理。" />

			{firstError ? (
				<QueryErrorAlert
					error={firstError}
					onRetry={() => {
						void devices.refetch();
						void media.refetch();
						void layouts.refetch();
						void schedules.refetch();
					}}
					retrying={devices.isFetching || media.isFetching}
				/>
			) : null}

			{isPending ? (
				<CardsSkeleton cards={6} label="正在載入總覽" />
			) : (
				<div className="huan-card-grid">
					<StatCard
						label="裝置線上"
						value={online}
						hint={`共 ${deviceItems.length} 台已配對`}
						to="/app/devices"
						tone={deviceItems.length > 0 && online === deviceItems.length ? "success" : undefined}
					/>
					<StatCard label="裝置離線" value={offline} hint={offline > 0 ? "離線裝置仍會播放本機內容" : "全部裝置都在線上"} to="/app/devices" tone={offline > 0 ? "danger" : undefined} />
					<StatCard label="素材處理中" value={processing} hint="上傳、排隊與轉檔中的素材" to="/app/media" />
					<StatCard label="素材轉檔失敗" value={failed} hint={failed > 0 ? "需要確認檔案格式後重新上傳" : "沒有失敗的素材"} to="/app/media" tone={failed > 0 ? "danger" : undefined} />
					<StatCard label="需重新上傳" value={needsReupload} hint="播放產物已回收，原始檔不再保存" to="/app/media" tone={needsReupload > 0 ? "warning" : undefined} />
					<StatCard label="已發布版面" value={published} hint={`共 ${layoutItems.length} 個版面`} to="/app/layouts" />
					<StatCard label="啟用中排程" value={enabledSchedules} hint={`共 ${scheduleItems.length} 個排程`} to="/app/schedules" />
				</div>
			)}

			<section className="huan-stack" aria-label="需要注意的裝置">
				<SectionHeading level={2} size="md" description="離線、版本落後、同步未完成或有儲存空間問題的裝置。">
					需要注意的裝置
				</SectionHeading>

				{isPending ? (
					<CardsSkeleton cards={3} label="正在載入裝置狀態" />
				) : attention.length === 0 ? (
					<EmptyState status="success" icon={<CheckCircleIcon weight="bold" />} title="所有裝置都正常" description="沒有離線、落後或同步失敗的裝置。" />
				) : (
					<div className="huan-stack huan-stack--sm">
						{attention.map(({ device, reason }) => (
							<ListCell
								key={device.id}
								leading={
									<span aria-hidden="true">
										<WarningIcon weight="bold" />
									</span>
								}
								title={device.name}
								description={reason}
								metadata={`最後回報 ${formatRelativeTime(device.lastSeenAt)}`}
								trailing={
									<Button render={<RouterLink to={`/app/devices/${device.id}`} />} nativeButton={false} variant="quiet" size="sm" endIcon={<ArrowRightIcon weight="bold" />}>
										查看
									</Button>
								}
							/>
						))}
					</div>
				)}
			</section>
		</>
	);
}
