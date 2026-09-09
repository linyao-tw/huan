import { useDeviceListQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { scheduleToForm, toScheduleRequest, type ScheduleFormValues } from "@/features/schedules/form";
import { useCreateScheduleMutation, useDeleteScheduleMutation, useScheduleListQuery, useUpdateScheduleMutation } from "@/features/schedules/hooks";
import { ScheduleDialog } from "@/features/schedules/ScheduleDialog";
import "@/features/schedules/schedules.css";
import { WeeklyTimeline } from "@/features/schedules/WeeklyTimeline";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDate, formatWeekdays } from "@/shared/utils/format";
import { browserTimeZone } from "@/shared/utils/timezones";
import type { Schedule } from "@huan/protocol";
import {
	Badge,
	Button,
	Card,
	CardBody,
	EmptyState,
	ListItem,
	OrderedList,
	SectionHeading,
	Table,
	TableBody,
	TableCell,
	TableFrame,
	TableHead,
	TableHeader,
	TableRow,
	useToastManager
} from "@linyao.tw/ui";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useState } from "react";

function ConflictRules() {
	return (
		<Card variant="inset" size="sm">
			<CardBody>
				<div className="huan-stack huan-stack--sm">
					<SectionHeading level={2} size="sm" description="同一時間有多個排程命中時，依序比較下列條件，第一個分出勝負的就決定播哪一個版面。">
						衝突判定規則
					</SectionHeading>
					<OrderedList density="compact" aria-label="排程衝突判定順序">
						<ListItem>優先度較高者勝出。</ListItem>
						<ListItem>每日視窗較短者勝出（越短代表指定得越精確，可以覆蓋長時段的底圖）。</ListItem>
						<ListItem>指定的星期天數較少者勝出。</ListItem>
						<ListItem>有設定日期區間者勝過沒有設定的。</ListItem>
						<ListItem>更新時間較新者勝出。</ListItem>
						<ListItem>以 id 字典序作最後決勝，確保結果永遠一致。</ListItem>
					</OrderedList>
					<p className="huan-caption">沒有任何排程命中時，裝置會播放它的預設版面；沒有預設版面時顯示待命畫面。</p>
				</div>
			</CardBody>
		</Card>
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
				description="決定每一台裝置在什麼時間播放哪一個版面。時間一律以排程自己的時區判定。"
				actions={
					<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)} disabled={layouts.isPending}>
						建立排程
					</Button>
				}
			/>

			<ConflictRules />

			{schedules.isError ? <QueryErrorAlert error={schedules.error} onRetry={() => void schedules.refetch()} retrying={schedules.isFetching} title="無法載入排程" /> : null}

			{schedules.isPending ? (
				<ListSkeleton rows={4} label="正在載入排程" />
			) : items.length === 0 ? (
				<EmptyState
					icon={<CalendarBlankIcon weight="bold" />}
					title="還沒有任何排程"
					description="沒有排程時，裝置會一直播放自己的預設版面。建立排程之後才能依時段切換內容。"
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
									<TableHead>名稱</TableHead>
									<TableHead>版面</TableHead>
									<TableHead>時段</TableHead>
									<TableHead>星期</TableHead>
									<TableHead>日期區間</TableHead>
									<TableHead>時區</TableHead>
									<TableHead textAlign="end">優先度</TableHead>
									<TableHead>目標裝置</TableHead>
									<TableHead textAlign="end">操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.map(schedule => (
									<TableRow key={schedule.id}>
										<TableCell>
											<div className="huan-row huan-row--tight">
												{schedule.name}
												{schedule.enabled ? null : <Badge variant="neutral">已停用</Badge>}
											</div>
										</TableCell>
										<TableCell>{schedule.layoutName}</TableCell>
										<TableCell numeric>
											{schedule.startTime} – {schedule.endTime}
											{schedule.endTime <= schedule.startTime ? <span className="huan-caption"> 跨午夜</span> : null}
										</TableCell>
										<TableCell>{formatWeekdays(schedule.daysOfWeek)}</TableCell>
										<TableCell>
											{schedule.startDate || schedule.endDate
												? `${schedule.startDate ? formatDate(schedule.startDate) : "不限"} – ${schedule.endDate ? formatDate(schedule.endDate) : "不限"}`
												: "不限"}
										</TableCell>
										<TableCell>{schedule.timezone}</TableCell>
										<TableCell numeric textAlign="end">
											{schedule.priority}
										</TableCell>
										<TableCell>{schedule.deviceIds.length === 0 ? <span className="huan-caption">未指定</span> : schedule.deviceIds.map(id => deviceNames.get(id) ?? id).join("、")}</TableCell>
										<TableCell textAlign="end">
											<div className="huan-row huan-row--end huan-row--tight">
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

					<section className="huan-stack" aria-label="一週排程預覽">
						<SectionHeading level={2} size="md" description="只顯示已啟用的排程。重疊的方塊代表同一時間有多個排程命中，實際播放的版面由上方的判定規則決定。">
							一週預覽
						</SectionHeading>
						<WeeklyTimeline schedules={items} />
					</section>
				</>
			)}

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
				title={`刪除排程「${pendingDelete?.name ?? ""}」？`}
				description="刪除後，這個時段的裝置會改用其他命中的排程；沒有其他排程時則回到預設版面。"
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
