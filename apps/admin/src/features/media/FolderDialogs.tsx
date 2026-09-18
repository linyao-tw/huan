import { descendantFolderIds, folderOptions } from "@/features/media/folders";
import { useCreateMediaFolderMutation, useMoveMediaMutation, useUpdateMediaFolderMutation } from "@/features/media/hooks";
import "@/features/media/media.css";
import type { MediaFolder } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, Dialog, RadioGroup, RadioItem, TextField, useToastManager } from "@linyao.tw/ui";
import { useEffect, useState } from "react";

/** RadioGroup 的值只能是字串，最上層因此需要一個不會和 UUID 相撞的代號。 */
const ROOT_VALUE = "__root__";

function FolderChoices({
	folders,
	value,
	onChange,
	disabledIds,
	disabled
}: {
	folders: readonly MediaFolder[];
	value: string | null;
	onChange: (value: string | null) => void;
	disabledIds?: readonly string[];
	disabled?: boolean;
}) {
	return (
		<RadioGroup aria-label="目標資料夾" value={value ?? ROOT_VALUE} onValueChange={next => onChange(next === ROOT_VALUE ? null : String(next))} disabled={disabled}>
			<div className="huan-stack huan-stack--sm">
				{folderOptions(folders).map(option => (
					<div key={option.id ?? ROOT_VALUE} style={{ paddingInlineStart: `calc(var(--space-4) * ${option.depth})` }}>
						<RadioItem value={option.id ?? ROOT_VALUE} label={option.label} disabled={option.id !== null && disabledIds?.includes(option.id)} />
					</div>
				))}
			</div>
		</RadioGroup>
	);
}

export function CreateFolderDialog({ open, onOpenChange, parentId, parentName }: { open: boolean; onOpenChange: (open: boolean) => void; parentId: string | null; parentName: string }) {
	const toast = useToastManager();
	const create = useCreateMediaFolderMutation();
	const [name, setName] = useState("");

	/** 相依只有 `open`：mutation 物件每次算繪都是新的，放進去會讓這個 effect 每一輪都重跑。 */
	useEffect(() => {
		if (open) {
			setName("");
			create.reset();
		}
	}, [open]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								create.mutate(
									{ name: name.trim(), parentId },
									{
										onSuccess: folder => {
											toast.add({ title: `已建立「${folder.name}」`, data: { status: "success" } });
											onOpenChange(false);
										}
									}
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>新增資料夾</Dialog.Title>
								<Dialog.Description>會建在「{parentName}」底下。資料夾只是整理素材用的，不影響已經排好的版面。</Dialog.Description>
							</Dialog.Header>
							<Dialog.Body>
								<div className="huan-stack">
									<TextField label="資料夾名稱" required value={name} onChange={event => setName(event.target.value)} disabled={create.isPending} description="例如「門市櫥窗」或「2026 春季檔期」。" />
									{create.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>建立失敗</AlertTitle>
											<AlertDescription>{create.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={create.isPending} disabled={name.trim().length === 0}>
									建立
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function RenameFolderDialog({ open, onOpenChange, folder, folders }: { open: boolean; onOpenChange: (open: boolean) => void; folder: MediaFolder | null; folders: readonly MediaFolder[] }) {
	const toast = useToastManager();
	const update = useUpdateMediaFolderMutation();
	const [name, setName] = useState(folder?.name ?? "");
	const [parentId, setParentId] = useState<string | null>(folder?.parentId ?? null);

	/** 只在打開或換一個資料夾時重新帶入；跟著整個 folder 物件走，打字打到一半會被回填的值洗掉。 */
	useEffect(() => {
		if (!open || !folder) return;
		setName(folder.name);
		setParentId(folder.parentId);
		update.reset();
	}, [open, folder?.id]);

	if (!folder) return null;

	/** 自己與自己的子孫都不能當目標，否則整棵樹會脫離素材庫。 */
	const blocked = [folder.id, ...descendantFolderIds(folders, folder.id)];

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								update.mutate(
									{ id: folder.id, body: { name: name.trim(), parentId } },
									{
										onSuccess: () => {
											toast.add({ title: "已儲存", data: { status: "success" } });
											onOpenChange(false);
										}
									}
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>編輯資料夾</Dialog.Title>
								<Dialog.Description>改名字或換位置。裡面的素材會跟著一起走。</Dialog.Description>
							</Dialog.Header>
							<Dialog.Body>
								<div className="huan-stack">
									<TextField label="資料夾名稱" required value={name} onChange={event => setName(event.target.value)} disabled={update.isPending} />
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">放在哪裡</span>
										<FolderChoices folders={folders} value={parentId} onChange={setParentId} disabledIds={blocked} disabled={update.isPending} />
									</div>
									{update.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>儲存失敗</AlertTitle>
											<AlertDescription>{update.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={update.isPending} disabled={name.trim().length === 0}>
									儲存
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function MoveAssetsDialog({
	open,
	onOpenChange,
	assetIds,
	folders,
	currentFolderId,
	onMoved
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	assetIds: readonly string[];
	folders: readonly MediaFolder[];
	currentFolderId: string | null;
	onMoved: () => void;
}) {
	const toast = useToastManager();
	const move = useMoveMediaMutation();
	const [target, setTarget] = useState<string | null>(currentFolderId);

	/** 預設停在目前所在的資料夾，讓「搬到隔壁」只要改一個選項。 */
	useEffect(() => {
		if (!open) return;
		setTarget(currentFolderId);
		move.reset();
	}, [open, currentFolderId]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<Dialog.Header>
							<Dialog.Title>搬移 {assetIds.length} 個素材</Dialog.Title>
							<Dialog.Description>只是換個位置。正在播的版面照樣播，裝置上的檔案不會重新下載。</Dialog.Description>
						</Dialog.Header>
						<Dialog.Body>
							<div className="huan-stack">
								<FolderChoices folders={folders} value={target} onChange={setTarget} disabled={move.isPending} />
								{move.isError ? (
									<Alert status="danger" live="assertive">
										<AlertTitle>搬移失敗</AlertTitle>
										<AlertDescription>{move.error.message}</AlertDescription>
									</Alert>
								) : null}
							</div>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.Close render={<Button variant="secondary">取消</Button>} />
							<Button
								loading={move.isPending}
								disabled={assetIds.length === 0}
								onClick={() =>
									move.mutate(
										{ assetIds: [...assetIds], folderId: target },
										{
											onSuccess: () => {
												toast.add({ title: `已搬移 ${assetIds.length} 個素材`, data: { status: "success" } });
												onOpenChange(false);
												onMoved();
											}
										}
									)
								}
							>
								搬過去
							</Button>
						</Dialog.Footer>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
