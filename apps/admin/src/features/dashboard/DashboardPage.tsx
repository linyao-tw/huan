import "@/features/dashboard/dashboard.css";
import { deviceNeedsAttention } from "@/features/devices/DeviceStatus";
import { useDeviceListQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { useMediaListQuery } from "@/features/media/hooks";
import { useScheduleListQuery } from "@/features/schedules/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatRelativeTime } from "@/shared/utils/format";
import { Badge, Button, Card, CardBody, EmptyState, ListCell, SectionHeading, Skeleton } from "@linyao.tw/ui";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

/** 每一張卡都是「標籤 / 數字 / 一句補充」，三行都在，同一列的高度才會一致。 */
function StatCard({ label, value, hint, to }: { label: string; value: ReactNode; hint: string; to: string }) {
	return (
		<RouterLink to={to} className="huan-stat-link">
			<Card variant="material" size="sm">
				<CardBody>
					<div className="huan-stat">
						<span className="huan-stat__label">{label}</span>
						<span className="huan-stat__value">{value}</span>
						<span className="huan-caption">{hint}</span>
					</div>
				</CardBody>
			</Card>
		</RouterLink>
	);
}

interface AttentionItem {
	id: string;
	title: string;
	description: string;
	metadata?: string;
	to: string;
	kind: "device" | "media";
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
	const processing = mediaItems.filter(asset => asset.status === "processing" || asset.status === "uploaded" || asset.status === "uploading").length;
	const failed = mediaItems.filter(asset => asset.status === "failed").length;
	const needsReupload = mediaItems.filter(asset => asset.status === "needs_reupload").length;
	const published = layoutItems.filter(layout => layout.publishedRevisionId !== null).length;
	const enabledSchedules = scheduleItems.filter(schedule => schedule.enabled).length;

	/*
	 * 裝置排在素材前面：螢幕沒在播是現場看得到的問題，素材轉檔失敗只是還沒能用。
	 * 這一段就是這一頁的重點，其餘數字都只是背景資訊。
	 */
	const attention: AttentionItem[] = [
		...deviceItems.flatMap(device => {
			const reason = deviceNeedsAttention(device);
			if (!reason) return [];
			return [{ id: device.id, title: device.name, description: reason, metadata: `最後回報 ${formatRelativeTime(device.lastSeenAt)}`, to: `/app/devices/${device.id}`, kind: "device" as const }];
		}),
		...(failed > 0 ? [{ id: "media-failed", title: `${failed} 個素材轉檔失敗`, description: "檔案格式可能不支援，換一個檔案重新上傳。", to: "/app/media", kind: "media" as const }] : []),
		...(needsReupload > 0
			? [{ id: "media-reupload", title: `${needsReupload} 個素材要重新上傳`, description: "這些檔案在伺服器上已經清掉了，要給新裝置播就得再上傳一次。", to: "/app/media", kind: "media" as const }]
			: [])
	];

	return (
		<>
			<PageHeader title="總覽" description="這個工作區現在的狀況。要處理的事都放在最上面。" />

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

			<section className="huan-stack" aria-label="需要處理">
				<SectionHeading
					level={2}
					size="md"
					description="沒在播的螢幕、還不能用的素材。處理完就會從這裡消失。"
					annotation={isPending || attention.length === 0 ? undefined : <Badge variant="danger">{attention.length} 件</Badge>}
				>
					需要處理
				</SectionHeading>

				{isPending ? (
					<ListSkeleton rows={3} label="正在讀取需要處理的項目" />
				) : attention.length === 0 ? (
					<EmptyState status="success" icon={<CheckCircleIcon weight="bold" />} title="目前沒有要處理的事" description="裝置都在線上，素材也都轉好了。" />
				) : (
					<div className="huan-stack huan-stack--sm">
						{attention.map(item => (
							<ListCell
								key={item.id}
								leading={<span aria-hidden="true">{item.kind === "device" ? <WarningIcon weight="bold" /> : <WarningCircleIcon weight="bold" />}</span>}
								title={item.title}
								description={item.description}
								metadata={item.metadata}
								trailing={
									<Button render={<RouterLink to={item.to} />} nativeButton={false} variant="quiet" size="sm" endIcon={<ArrowRightIcon weight="bold" />}>
										去處理
									</Button>
								}
							/>
						))}
					</div>
				)}
			</section>

			<section className="huan-stack" aria-label="目前狀態">
				<SectionHeading level={2} size="md" description="點任何一張卡片可以進去看細節。">
					目前狀態
				</SectionHeading>

				{isPending ? (
					/* 骨架用同一個網格，資料進來時卡片不會換位置。 */
					<div className="huan-card-grid huan-stat-grid" aria-busy="true" aria-live="polite">
						<span className="huan-visually-hidden">正在讀取目前狀態</span>
						{Array.from({ length: 4 }, (_value, index) => (
							<Skeleton key={index} shape="rectangular" style={{ blockSize: "var(--space-24)" }} />
						))}
					</div>
				) : (
					<div className="huan-card-grid huan-stat-grid">
						<StatCard label="裝置在線上" value={`${online} / ${deviceItems.length}`} hint={deviceItems.length === 0 ? "還沒有配對任何裝置" : "離線的裝置會繼續播已經下載好的內容"} to="/app/devices" />
						<StatCard
							label="素材"
							value={mediaItems.length}
							hint={processing > 0 ? `${processing} 個還在上傳或轉檔` : failed + needsReupload > 0 ? `${failed + needsReupload} 個現在不能播` : "全部都可以播"}
							to="/app/media"
						/>
						<StatCard label="已發布的版面" value={published} hint={`共 ${layoutItems.length} 個版面，只有發布過的才會播`} to="/app/layouts" />
						<StatCard label="啟用中的排程" value={enabledSchedules} hint={`共 ${scheduleItems.length} 個排程`} to="/app/schedules" />
					</div>
				)}
			</section>
		</>
	);
}
