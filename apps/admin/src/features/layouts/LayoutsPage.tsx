import { CreateLayoutDialog } from "@/features/layouts/CreateLayoutDialog";
import { useDeleteLayoutMutation, useLayoutListQuery } from "@/features/layouts/hooks";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatRelativeTime } from "@/shared/utils/format";
import type { LayoutSummary } from "@huan/protocol";
import { Badge, Button, EmptyState, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow, useToastManager } from "@linyao.tw/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useState } from "react";
import { Link as RouterLink } from "react-router";

export function LayoutsPage() {
	const layouts = useLayoutListQuery();
	const remove = useDeleteLayoutMutation();
	const toast = useToastManager();
	const [createOpen, setCreateOpen] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<LayoutSummary | null>(null);

	const items = layouts.data?.items ?? [];

	return (
		<>
			<PageHeader
				title="版面"
				description="版面是一棵遞迴分割樹。編輯中的內容存在草稿，按下發布才會產生新的修訂並派送到裝置。"
				actions={
					<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)}>
						建立版面
					</Button>
				}
			/>

			{layouts.isError ? <QueryErrorAlert error={layouts.error} onRetry={() => void layouts.refetch()} retrying={layouts.isFetching} title="無法載入版面列表" /> : null}

			{layouts.isPending ? (
				<ListSkeleton rows={4} label="正在載入版面" />
			) : items.length === 0 ? (
				<EmptyState
					icon={<SquaresFourIcon weight="bold" />}
					title="還沒有任何版面"
					description="建立第一個版面之後，就可以把畫面切分成多個區塊，分別放入影片、圖片、文字與跑馬燈。"
					actions={
						<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)}>
							建立版面
						</Button>
					}
				/>
			) : (
				<TableFrame>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名稱</TableHead>
								<TableHead>畫布</TableHead>
								<TableHead>已發布修訂</TableHead>
								<TableHead>草稿最後修改</TableHead>
								<TableHead textAlign="end">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(layout => (
								<TableRow key={layout.id}>
									<TableCell>
										<div className="huan-stack huan-stack--sm">
											<RouterLink to={`/app/layouts/${layout.id}`}>{layout.name}</RouterLink>
											{layout.description ? <span className="huan-caption">{layout.description}</span> : null}
										</div>
									</TableCell>
									<TableCell numeric>
										{layout.canvas.width} × {layout.canvas.height}
									</TableCell>
									<TableCell>{layout.publishedRevisionNumber === null ? <Badge variant="neutral">尚未發布</Badge> : <Badge variant="success">第 {layout.publishedRevisionNumber} 版</Badge>}</TableCell>
									<TableCell>{formatRelativeTime(layout.draftUpdatedAt)}</TableCell>
									<TableCell textAlign="end">
										<div className="huan-row huan-row--end huan-row--tight">
											<Button render={<RouterLink to={`/app/layouts/${layout.id}`} />} nativeButton={false} variant="quiet" size="sm" startIcon={<PencilSimpleIcon weight="bold" />}>
												編輯
											</Button>
											<Button variant="quiet" size="sm" startIcon={<TrashIcon weight="bold" />} onClick={() => setPendingDelete(layout)}>
												刪除
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableFrame>
			)}

			<CreateLayoutDialog open={createOpen} onOpenChange={setCreateOpen} />

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={open => {
					if (!open) {
						setPendingDelete(null);
						remove.reset();
					}
				}}
				destructive
				title={`刪除版面「${pendingDelete?.name ?? ""}」？`}
				description="刪除後所有修訂都會一併移除，無法復原。若版面正被排程或裝置引用，伺服器會拒絕刪除並說明原因。"
				confirmLabel="刪除版面"
				pending={remove.isPending}
				errorMessage={remove.error?.message ?? null}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => {
							toast.add({ title: "已刪除版面", data: { status: "success" } });
							setPendingDelete(null);
						}
					});
				}}
			/>
		</>
	);
}
