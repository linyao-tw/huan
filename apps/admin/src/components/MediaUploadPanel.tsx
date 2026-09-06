import { UPLOAD_PHASE_LABELS } from "@/lib/upload";
import { ACCEPTED_UPLOAD_TYPES, useMediaUploader } from "@/lib/use-media-uploader";
import { formatBytes } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, DropZone, IconButton, Progress } from "@linyao.tw/ui";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";

export type MediaUploader = ReturnType<typeof useMediaUploader>;

export function MediaUploadPanel({ uploader }: { uploader: MediaUploader }) {
	const active = uploader.tasks.filter(task => task.phase !== "done" && task.phase !== "error" && task.phase !== "cancelled").length;

	return (
		<div className="huan-stack">
			<DropZone
				label="上傳素材"
				description="支援 MP4、MOV、MKV、WebM、JPEG、PNG、WebP、AVIF、GIF 與 HTML，單檔上限 4 GB。原始檔在轉檔完成後會刪除，HUAN 不長期保存原始檔。"
				primaryLabel="把檔案拖到這裡"
				secondaryLabel="或"
				browseLabel="選擇檔案"
				multiple
				accept={ACCEPTED_UPLOAD_TYPES}
				onFilesChange={files => uploader.enqueue(files)}
			/>

			{uploader.tasks.length > 0 ? (
				<div className="huan-stack huan-stack--sm">
					<div className="huan-row huan-row--between">
						<span className="huan-muted">{active > 0 ? `${active} 個檔案上傳中` : "上傳佇列"}</span>
						<Button variant="quiet" size="sm" startIcon={<TrashIcon weight="bold" />} onClick={uploader.clearFinished}>
							清除已完成
						</Button>
					</div>

					<ul className="huan-upload-list">
						{uploader.tasks.map(task => {
							const ratio = task.sizeBytes > 0 ? Math.min(100, Math.round((task.loaded / task.sizeBytes) * 100)) : 0;
							const finished = task.phase === "done" || task.phase === "error" || task.phase === "cancelled";
							return (
								<li key={task.id} className="huan-upload-item">
									<div className="huan-row huan-row--between">
										<span className="huan-truncate huan-grow">{task.name}</span>
										<Badge size="sm" variant={task.phase === "error" ? "danger" : task.phase === "done" ? "success" : task.phase === "cancelled" ? "neutral" : "accent"}>
											{UPLOAD_PHASE_LABELS[task.phase]}
										</Badge>
										{finished ? (
											<IconButton aria-label={`從清單移除 ${task.name}`} variant="quiet" size="sm" onClick={() => uploader.dismiss(task.id)}>
												<XCircleIcon weight="bold" />
											</IconButton>
										) : (
											<Button variant="quiet" size="sm" onClick={() => uploader.cancel(task.id)}>
												取消
											</Button>
										)}
									</div>

									{task.phase === "error" ? (
										<Alert status="danger" live="polite">
											<AlertTitle>無法上傳</AlertTitle>
											<AlertDescription>{task.errorMessage}</AlertDescription>
										</Alert>
									) : (
										<Progress label={`${task.name} 上傳進度`} value={task.phase === "done" ? 100 : ratio} showValue status={task.phase === "cancelled" ? "neutral" : "info"} />
									)}

									<span className="huan-caption huan-numeric">
										{formatBytes(task.loaded)} / {formatBytes(task.sizeBytes)}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
		</div>
	);
}
