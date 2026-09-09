import { apiRequest, isApiError } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import { uploadFileWithProgress, type UploadTask } from "@/shared/services/upload";
import { MEDIA_ACCEPTED_CONTENT_TYPES, MEDIA_MAX_UPLOAD_BYTES, type CreateUploadResponse, type MediaAsset, type MediaKind } from "@huan/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export function detectMediaKind(file: File): MediaKind | null {
	const contentType = file.type.toLowerCase();
	for (const [kind, accepted] of Object.entries(MEDIA_ACCEPTED_CONTENT_TYPES) as [MediaKind, readonly string[]][]) {
		if (accepted.includes(contentType)) return kind;
	}
	// 部分系統對 .html 回報空的 MIME，這時用副檔名補判斷，其餘一律拒絕。
	if (contentType === "" && /\.html?$/i.test(file.name)) return "html";
	return null;
}

export const ACCEPTED_UPLOAD_TYPES = Object.values(MEDIA_ACCEPTED_CONTENT_TYPES).flat().join(",");

function stripExtension(filename: string): string {
	const index = filename.lastIndexOf(".");
	return index > 0 ? filename.slice(0, index) : filename;
}

interface UploaderApi {
	tasks: UploadTask[];
	enqueue: (files: readonly File[]) => void;
	cancel: (taskId: string) => void;
	dismiss: (taskId: string) => void;
	clearFinished: () => void;
}

/**
 * 三步驟直傳的狀態機。
 *
 * 每個檔案各自持有一個 AbortController，因為取消一個上傳不應該打斷其他檔案；
 * 進度只更新對應的 task，避免大量檔案同時上傳時整份清單重新算繪。
 */
export function useMediaUploader(): UploaderApi {
	const queryClient = useQueryClient();
	const [tasks, setTasks] = useState<UploadTask[]>([]);
	const controllers = useRef(new Map<string, AbortController>());

	const patchTask = useCallback((id: string, patch: Partial<UploadTask>) => {
		setTasks(current => current.map(task => (task.id === id ? { ...task, ...patch } : task)));
	}, []);

	const runTask = useCallback(
		async (id: string, file: File, kind: MediaKind) => {
			const controller = new AbortController();
			controllers.current.set(id, controller);

			try {
				patchTask(id, { phase: "requesting" });
				const authorization = await apiRequest<CreateUploadResponse>("/media/uploads", {
					method: "POST",
					body: { kind, name: stripExtension(file.name).slice(0, 120) || file.name.slice(0, 120), filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size },
					signal: controller.signal
				});

				patchTask(id, { phase: "uploading", assetId: authorization.assetId });
				await uploadFileWithProgress({
					url: authorization.uploadUrl,
					headers: authorization.headers,
					file,
					signal: controller.signal,
					onProgress: progress => patchTask(id, { loaded: progress.loaded })
				});

				patchTask(id, { phase: "completing" });
				await apiRequest<MediaAsset>("/media/uploads/complete", { method: "POST", body: { assetId: authorization.assetId }, signal: controller.signal });

				patchTask(id, { phase: "done", loaded: file.size });
				void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					patchTask(id, { phase: "cancelled" });
					return;
				}
				patchTask(id, { phase: "error", errorMessage: isApiError(error) ? error.message : "上傳失敗，請稍後再試。" });
			} finally {
				controllers.current.delete(id);
			}
		},
		[patchTask, queryClient]
	);

	const enqueue = useCallback(
		(files: readonly File[]) => {
			for (const file of files) {
				const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const kind = detectMediaKind(file);

				if (!kind) {
					setTasks(current => [...current, { id, name: file.name, sizeBytes: file.size, phase: "error", loaded: 0, assetId: null, errorMessage: "不支援的檔案格式。HUAN 只接受影片、圖片與 HTML。" }]);
					continue;
				}
				if (file.size > MEDIA_MAX_UPLOAD_BYTES) {
					setTasks(current => [...current, { id, name: file.name, sizeBytes: file.size, phase: "error", loaded: 0, assetId: null, errorMessage: "檔案超過 4 GB 上限。" }]);
					continue;
				}

				setTasks(current => [...current, { id, name: file.name, sizeBytes: file.size, phase: "queued", loaded: 0, assetId: null, errorMessage: null }]);
				void runTask(id, file, kind);
			}
		},
		[runTask]
	);

	const cancel = useCallback((taskId: string) => {
		controllers.current.get(taskId)?.abort();
	}, []);

	const dismiss = useCallback((taskId: string) => {
		setTasks(current => current.filter(task => task.id !== taskId));
	}, []);

	const clearFinished = useCallback(() => {
		setTasks(current => current.filter(task => task.phase !== "done" && task.phase !== "cancelled"));
	}, []);

	return { tasks, enqueue, cancel, dismiss, clearFinished };
}
