import { useDeviceListQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { scheduleToForm, toScheduleRequest, type ScheduleFormValues } from "@/features/schedules/form";
import { useCreateScheduleMutation, useDeleteScheduleMutation, useScheduleListQuery, useUpdateScheduleMutation } from "@/features/schedules/hooks";
import { ScheduleDialog } from "@/features/schedules/ScheduleDialog";
import "@/features/schedules/schedules.css";
import { timeZoneShortLabel } from "@/features/schedules/timezone-labels";
import { WeeklyTimeline } from "@/features/schedules/WeeklyTimeline";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDate, formatWeekdays } from "@/shared/utils/format";
import { browserTimeZone } from "@/shared/utils/timezones";
import type { Schedule } from "@huan/protocol";
import { Badge, Button, Card, CardBody, EmptyState, SectionHeading, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow, useToastManager } from "@linyao.tw/ui";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useState } from "react";

/** 判定順序寫死在 @huan/shared，這裡只是把它翻成人話；改一邊就要改另一邊。 */
const PRECEDENCE_RULES: readonly string[] = [
	"優先度數字大的先播。",
	"數字一樣時，每天播的時間比較短的先播 —— 短時段用來蓋掉長時段。",
	"還一樣時，指定的星期比較少的先播。",
	"還一樣時，有指定日期範圍的，贏過沒有指定的。",
	"還一樣時，最近改過的先播。",
	"全部都一樣時，系統會固定選同一個，不會今天播這個、明天播那個。"
];

function PrecedenceRules() {
	return (
		<section className="huan-stack" aria-label="同一時間有多個排程時播哪一個">
			<SectionHeading level={2} size="md" description="從第一條開始比，先分出勝負的那一條就決定播誰。">
				同一時間有多個排程，播哪一個
			</SectionHeading>
			<Card variant="inset">
				<CardBody>
					<div className="huan-stack huan-stack--sm">
						<ol className="huan-rules">
							{PRECEDENCE_RULES.map(rule => (
								<li key={rule}>{rule}</li>
							))}
						</ol>
						<p className="huan-caption">一個排程都沒對上的時間，裝置播自己的預設版面；連預設版面都沒有的話，顯示待機畫面。</p>
					</div>
				</CardBody>
			</Card>
		</section>
	);
}

export function SchedulesPage() {
	const schedules = useScheduleListQuery();
	const layouts = useLayoutListQuery();
	const devices = useDeviceListQuery();
	const create = useCreateScheduleMutation();
	const update = useUpdateScheduleMutation();
	const remove = useDeleteScheduleMutation();
	const toast = useToastManager();

	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<Schedule | null>(null);
	const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);

	const items = schedules.data?.items ?? [];
	const deviceNames = new Map((devices.data?.items ?? []).map(device => [device.id, device.name]));

	const submitCreate = (values: ScheduleFormValues): void => {
		create.mutate(toScheduleRequest(values), {
			onSuccess: () => {
				toast.add({ title: "已建立排程", data: { status: "success" } });
				setCreateOpen(false);
			}
		});
	};

	const submitUpdate = (values: ScheduleFormValues): void => {
		if (!editing) return;
		update.mutate(
			{ id: editing.id, body: toScheduleRequest(values) },
			{
				onSuccess: () => {
					toast.add({ title: "已更新排程", data: { status: "success" } });
					setEditing(null);
				}
			}
		);
	};

	return (
		<>
			<PageHeader
				title="排程"
				description="決定每一台裝置在什麼時間播哪一個版面。"
				actions={
					<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)} disabled={layouts.isPending}>
						建立排程
					</Button>
				}
			/>

			{schedules.isError ? <QueryErrorAlert error={schedules.error} onRetry={() => void schedules.refetch()} retrying={schedules.isFetching} title="排程載入失敗" /> : null}

			{schedules.isPending ? (
				<ListSkeleton rows={4} label="正在讀取排程" />
			) : items.length === 0 ? (
				<EmptyState
					icon={<CalendarBlankIcon weight="bold" />}
					title="還沒有任何排程"
					description="沒有排程的時候，裝置會一直播自己的預設版面。建立排程之後，才會依時段換內容。"
					actions={
						<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)}>
							建立排程
						</Button>
					}
				/>
			) : (
				<>
					<TableFrame>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>排程</TableHead>
									<TableHead>播放時間</TableHead>
									<TableHead>哪幾天</TableHead>
									<TableHead>播放裝置</TableHead>
									<TableHead textAlign="end">優先度</TableHead>
									<TableHead textAlign="end">操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.map(schedule => (
									<TableRow key={schedule.id}>
										<TableCell>
											<div className="huan-schedule-cell">
												<span className="huan-row huan-row--tight">
													{schedule.name}
													{schedule.enabled ? null : <Badge variant="neutral">已停用</Badge>}
												</span>
												<span className="huan-caption">播「{schedule.layoutName}」</span>
											</div>
										</TableCell>
										<TableCell>
											<div className="huan-schedule-cell">
												<span className="huan-numeric">
													{schedule.startTime} – {schedule.endTime}
													{schedule.endTime <= schedule.startTime ? "（跨過半夜）" : ""}
												</span>
												<span className="huan-caption">{timeZoneShortLabel(schedule.timezone)}</span>
											</div>
										</TableCell>
										<TableCell>
											<div className="huan-schedule-cell">
												<span>{formatWeekdays(schedule.daysOfWeek)}</span>
												<span className="huan-caption huan-numeric">
													{schedule.startDate || schedule.endDate
														? `${schedule.startDate ? formatDate(schedule.startDate) : "即日"} 到 ${schedule.endDate ? formatDate(schedule.endDate) : "無限期"}`
														: "不限日期"}
												</span>
											</div>
										</TableCell>
										<TableCell className="huan-wrap huan-schedule-devices">
											{/* 沒有勾裝置的排程對任何一台裝置都不成立，所以講後果，不要只說「未指定」。 */}
											{schedule.deviceIds.length === 0 ? <span className="huan-caption">還沒挑裝置，不會播</span> : schedule.deviceIds.map(id => deviceNames.get(id) ?? id).join("、")}
										</TableCell>
										<TableCell numeric textAlign="end">
											{schedule.priority}
										</TableCell>
										<TableCell textAlign="end">
											<div className="huan-row huan-row--end huan-row--tight huan-schedule-actions">
												<Button variant="quiet" size="sm" startIcon={<PencilSimpleIcon weight="bold" />} onClick={() => setEditing(schedule)}>
													編輯
												</Button>
												<Button variant="quiet" size="sm" startIcon={<TrashIcon weight="bold" />} onClick={() => setPendingDelete(schedule)}>
													刪除
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableFrame>

					<section className="huan-stack" aria-label="一週預覽">
						<SectionHeading level={2} size="md" description="只畫啟用中的排程。方塊重疊代表同一時間有多個排程對上，實際播哪一個看下面的規則。">
							一週預覽
						</SectionHeading>
						<WeeklyTimeline schedules={items} />
					</section>
				</>
			)}

			<PrecedenceRules />

			{createOpen ? (
				<ScheduleDialog
					open={createOpen}
					onOpenChange={open => {
						setCreateOpen(open);
						if (!open) create.reset();
					}}
					title="建立排程"
					defaultTimeZone={browserTimeZone()}
					layouts={layouts.data?.items ?? []}
					devices={devices.data?.items ?? []}
					pending={create.isPending}
					errorMessage={create.error?.message ?? null}
					onSubmit={submitCreate}
				/>
			) : null}

			{editing ? (
				<ScheduleDialog
					key={editing.id}
					open
					onOpenChange={open => {
						if (!open) {
							setEditing(null);
							update.reset();
						}
					}}
					title={`編輯「${editing.name}」`}
					initialValues={scheduleToForm(editing)}
					defaultTimeZone={editing.timezone}
					layouts={layouts.data?.items ?? []}
					devices={devices.data?.items ?? []}
					pending={update.isPending}
					errorMessage={update.error?.message ?? null}
					onSubmit={submitUpdate}
				/>
			) : null}

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={open => {
					if (!open) {
						setPendingDelete(null);
						remove.reset();
					}
				}}
				destructive
				title={`確定要刪除排程「${pendingDelete?.name ?? ""}」？`}
				description="刪除之後，這個時段會改用其他對得上的排程；沒有其他排程時，裝置回去播預設版面。"
				confirmLabel="刪除排程"
				pending={remove.isPending}
				errorMessage={remove.error?.message ?? null}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => {
							toast.add({ title: "已刪除排程", data: { status: "success" } });
							setPendingDelete(null);
						}
					});
				}}
			/>
		</>
	);
}
