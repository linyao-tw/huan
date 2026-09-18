import { apiRequest, type ApiError, type Paginated } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import type {
	CompleteUploadRequest,
	CreateMediaFolderRequest,
	CreateUploadRequest,
	CreateUploadResponse,
	MediaAsset,
	MediaFolder,
	MediaListQuery,
	MediaUsage,
	MoveMediaRequest,
	UpdateMediaFolderRequest,
	UpdateMediaRequest
} from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export type MediaListFilters = Partial<Pick<MediaListQuery, "kind" | "status" | "search" | "folderId" | "limit" | "offset">>;

export interface MediaFolderList {
	items: MediaFolder[];
}

/** 查詢本身抽出來，是為了讓「全選這個資料夾」能用同一把 key 直接取資料，而不是另外寫一份 fetch。 */
export function mediaListQueryOptions(filters: MediaListFilters) {
	return {
		queryKey: queryKeys.media.list(filters),
		queryFn: ({ signal }: { signal?: AbortSignal }) => apiRequest<Paginated<MediaAsset>>("/media", { query: filters, ...(signal ? { signal } : {}) }),
		staleTime: 15_000
	};
}

/**
 * 素材列表在有檔案還在處理時需要自動更新。
 *
 * WebSocket 會送 `media_changed`，但轉檔中的畫面不能只靠推播：
 * 連線可能沒建立起來，所以這裡另外開一個只在「有待處理項目」時才啟動的輪詢。
 */
export function useMediaListQuery(filters: MediaListFilters): UseQueryResult<Paginated<MediaAsset>, ApiError> {
	return useQuery<Paginated<MediaAsset>, ApiError>({
		...mediaListQueryOptions(filters),
		refetchInterval: query => {
			const items = query.state.data?.items ?? [];
			return items.some(item => item.status === "uploaded" || item.status === "processing") ? 4_000 : false;
		}
	});
}

export function useMediaAssetQuery(id: string | null): UseQueryResult<MediaAsset, ApiError> {
	return useQuery<MediaAsset, ApiError>({
		queryKey: queryKeys.media.detail(id ?? ""),
		queryFn: ({ signal }) => apiRequest<MediaAsset>(`/media/${id ?? ""}`, { signal }),
		enabled: Boolean(id),
		staleTime: 15_000
	});
}

export function useMediaUsageQuery(id: string | null): UseQueryResult<MediaUsage, ApiError> {
	return useQuery<MediaUsage, ApiError>({
		queryKey: queryKeys.media.usage(id ?? ""),
		queryFn: ({ signal }) => apiRequest<MediaUsage>(`/media/${id ?? ""}/usage`, { signal }),
		enabled: Boolean(id),
		staleTime: 5_000
	});
}

export function useCreateUploadMutation() {
	return useMutation<CreateUploadResponse, ApiError, CreateUploadRequest>({
		mutationFn: variables => apiRequest<CreateUploadResponse>("/media/uploads", { method: "POST", body: variables })
	});
}

export function useCompleteUploadMutation() {
	const queryClient = useQueryClient();
	return useMutation<MediaAsset, ApiError, CompleteUploadRequest>({
		mutationFn: variables => apiRequest<MediaAsset>("/media/uploads/complete", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}

export function useRenameMediaMutation() {
	const queryClient = useQueryClient();
	return useMutation<MediaAsset, ApiError, { id: string; body: UpdateMediaRequest }>({
		mutationFn: ({ id, body }) => apiRequest<MediaAsset>(`/media/${id}`, { method: "PATCH", body }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}

export function useDeleteMediaMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/media/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.all });
		}
	});
}

/**
 * 資料夾一次全部拿。
 *
 * 樹本身很小，而麵包屑、搬移對話框與素材選擇器都要讀它；讓三個地方共用同一份
 * 快取，就不會出現「剛建好的資料夾在某個對話框裡看不到」這種事。
 */
export function useMediaFoldersQuery(): UseQueryResult<MediaFolderList, ApiError> {
	return useQuery<MediaFolderList, ApiError>({
		queryKey: queryKeys.media.folders(),
		queryFn: ({ signal }) => apiRequest<MediaFolderList>("/media/folders", { signal }),
		staleTime: 30_000
	});
}

export function useCreateMediaFolderMutation() {
	const queryClient = useQueryClient();
	return useMutation<MediaFolder, ApiError, CreateMediaFolderRequest>({
		mutationFn: variables => apiRequest<MediaFolder>("/media/folders", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}

export function useUpdateMediaFolderMutation() {
	const queryClient = useQueryClient();
	return useMutation<MediaFolder, ApiError, { id: string; body: UpdateMediaFolderRequest }>({
		mutationFn: ({ id, body }) => apiRequest<MediaFolder>(`/media/folders/${id}`, { method: "PATCH", body }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}

export function useDeleteMediaFolderMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/media/folders/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}

export function useMoveMediaMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, MoveMediaRequest>({
		mutationFn: variables => apiRequest<void>("/media/move", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
		}
	});
}
