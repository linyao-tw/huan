import { useCurrentUser } from "@/features/auth/hooks";
import "@/features/dashboard/dashboard.css";
import { deviceNeedsAttention } from "@/features/devices/DeviceStatus";
import { useDeviceListQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { useMediaListQuery } from "@/features/media/hooks";
import { useScheduleListQuery } from "@/features/schedules/hooks";
import { useUserListQuery } from "@/features/users/hooks";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";
import { formatRelativeTime } from "@/shared/utils/format";
import { Badge, Button, Card, CardBody, EmptyState, ListCell, SectionHeading, Skeleton } from "@linyao.tw/ui";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ProhibitIcon } from "@phosphor-icons/react/dist/csr/Prohibit";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
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

function OwnerDashboard() {
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
			<PageHeader title="總覽" description="你自己的裝置、素材、版面與排程現在的狀況。要處理的事都放在最上面。" />

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
					description="你自己沒在播的螢幕、還不能用的素材。處理完就會從這裡消失。"
					annotation={isPending || attention.length === 0 ? undefined : <Badge variant="danger">{attention.length} 件</Badge>}
				>
					需要處理
				</SectionHeading>

				{isPending ? (
					<ListSkeleton rows={3} label="正在讀取需要處理的項目" />
				) : attention.length === 0 ? (
					<EmptyState status="success" icon={<CheckCircleIcon weight="bold" />} title="目前沒有要處理的事" description="你的裝置都在線上，素材也都轉好了。" />
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
				<SectionHeading level={2} size="md" description="這些數字只算你自己的東西，看不到別人的。點任何一張卡片可以進去看細節。">
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
						<StatCard
							label="裝置在線上"
							value={`${online} / ${deviceItems.length}`}
							hint={deviceItems.length === 0 ? "你還沒有配對任何裝置" : "離線的裝置會繼續播已經下載好的內容"}
							to="/app/devices"
						/>
						<StatCard
							label="素材"
							value={mediaItems.length}
							hint={processing > 0 ? `${processing} 個還在上傳或轉檔` : failed + needsReupload > 0 ? `${failed + needsReupload} 個現在不能播` : "全部都可以播"}
							to="/app/media"
						/>
						<StatCard label="已發布的版面" value={published} hint={`你有 ${layoutItems.length} 個版面，只有發布過的才會播`} to="/app/layouts" />
						<StatCard label="啟用中的排程" value={enabledSchedules} hint={`你有 ${scheduleItems.length} 個排程`} to="/app/schedules" />
					</div>
				)}
			</section>
		</>
	);
}

/**
 * 系統管理員的總覽。
 *
 * 這個角色不擁有素材、版面、排程與裝置，把一般使用者那四張卡片端給它只會是四個零，
 * 而四個零讀起來像「東西被刪光了」。改成說清楚這個角色負責什麼，並把人帶去使用者管理。
 */
function AccountAdminDashboard() {
	const users = useUserListQuery(true);

	const items = users.data?.items ?? [];
	const active = items.filter(user => user.status === "active").length;
	const admins = items.filter(user => user.role === "super_admin").length;

	/* 讀不到清單時不能說「沒有帳號」——沒查到不等於沒有，至少還有登入中的自己。 */
	const unreadable = !users.isPending && !users.isError && items.length === 0;

	return (
		<>
			<PageHeader title="總覽" description="你的角色是系統管理員，負責的是帳號：建立使用者、調整角色、停用帳號與重設密碼。" />

			{users.isError ? <QueryErrorAlert error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} title="讀不到帳號數量" /> : null}

			<section className="huan-stack" aria-label="帳號">
				<SectionHeading level={2} size="md" description="點卡片進去建立帳號、調整角色或停用帳號。">
					帳號
				</SectionHeading>

				{users.isPending ? (
					/* 骨架用同一個網格，資料進來時卡片不會換位置。 */
					<div className="huan-card-grid huan-stat-grid" aria-busy="true" aria-live="polite">
						<span className="huan-visually-hidden">正在讀取帳號數量</span>
						{Array.from({ length: 2 }, (_value, index) => (
							<Skeleton key={index} shape="rectangular" style={{ blockSize: "var(--space-24)" }} />
						))}
					</div>
				) : unreadable ? (
					<EmptyState
						status="warning"
						icon={<UsersThreeIcon weight="bold" />}
						title="讀不到任何帳號"
						description="伺服器回傳了空的帳號清單。這不太可能，因為你自己就是一個帳號，請重試一次。"
						actions={
							<Button variant="secondary" onClick={() => void users.refetch()} loading={users.isFetching}>
								重試
							</Button>
						}
					/>
				) : (
					<div className="huan-card-grid huan-stat-grid">
						<StatCard
							label="啟用中的帳號"
							value={`${active} / ${items.length}`}
							hint={active === items.length ? "沒有被停用的帳號" : `${items.length - active} 個被停用，停用的帳號無法登入`}
							to="/app/users"
						/>
						<StatCard label="系統管理員" value={admins} hint="系統管理員只管帳號，不會有自己的素材與裝置" to="/app/users" />
					</div>
				)}
			</section>

			<section className="huan-stack" aria-label="素材、版面、排程與裝置">
				<SectionHeading level={2} size="md">
					素材、版面、排程與裝置
				</SectionHeading>

				<EmptyState
					status="info"
					icon={<ProhibitIcon weight="bold" />}
					title="這四項不在系統管理員手上"
					description="它們都屬於各個使用者，只有本人看得到。系統管理員不會有這些數字，也不能代為上傳、編輯或配對裝置。要自己放內容，請用一般使用者帳號登入。"
					actions={
						<Button render={<RouterLink to="/app/users" />} nativeButton={false} variant="secondary" endIcon={<ArrowRightIcon weight="bold" />}>
							去使用者管理
						</Button>
					}
				/>
			</section>
		</>
	);
}

export function DashboardPage() {
	useDocumentTitle("總覽");

	const user = useCurrentUser();

	/*
	 * 兩個角色看的是兩份不同的資料，所以分成兩個元件。
	 * 寫成一個的話，系統管理員這邊也得照 hooks 的呼叫順序去打那四個自己只會拿到 403 的清單。
	 */
	return user?.role === "super_admin" ? <AccountAdminDashboard /> : <OwnerDashboard />;
}
