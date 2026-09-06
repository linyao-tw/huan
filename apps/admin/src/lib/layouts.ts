import { apiRequest, type ApiError, type Paginated } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
	LayoutDetailSchema,
	LayoutRevisionSchema,
	type CreateLayoutRequest,
	type LayoutDetail,
	type LayoutRevision,
	type LayoutSummary,
	type PublishLayoutRequest,
	type UpdateLayoutDraftRequest
} from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export function useLayoutListQuery(): UseQueryResult<Paginated<LayoutSummary>, ApiError> {
	return useQuery<Paginated<LayoutSummary>, ApiError>({
		queryKey: queryKeys.layouts.list(),
		queryFn: ({ signal }) => apiRequest<Paginated<LayoutSummary>>("/layouts", { signal }),
		staleTime: 30_000
	});
}

/**
 * 版面詳情是唯一會被編輯器直接改寫的資料，因此在邊界就用 schema 收斂。
 * 少了這一步，Server 少送一個欄位會變成畫布上莫名其妙的空白，而不是一個明確的錯誤。
 */
export function useLayoutDetailQuery(id: string | null): UseQueryResult<LayoutDetail, ApiError> {
	return useQuery<LayoutDetail, ApiError>({
		queryKey: queryKeys.layouts.detail(id ?? ""),
		queryFn: ({ signal }) => apiRequest<LayoutDetail>(`/layouts/${id ?? ""}`, { signal, schema: LayoutDetailSchema }),
		enabled: Boolean(id),
		staleTime: 30_000
	});
}

export function useLayoutRevisionQuery(layoutId: string | null, revisionId: string | null): UseQueryResult<LayoutRevision, ApiError> {
	return useQuery<LayoutRevision, ApiError>({
		queryKey: queryKeys.layouts.revision(layoutId ?? "", revisionId ?? ""),
		queryFn: ({ signal }) => apiRequest<LayoutRevision>(`/layouts/${layoutId ?? ""}/revisions/${revisionId ?? ""}`, { signal, schema: LayoutRevisionSchema }),
		enabled: Boolean(layoutId && revisionId),
		staleTime: Infinity
	});
}

export function useCreateLayoutMutation() {
	const queryClient = useQueryClient();
	return useMutation<LayoutDetail, ApiError, CreateLayoutRequest>({
		mutationFn: variables => apiRequest<LayoutDetail>("/layouts", { method: "POST", body: variables, schema: LayoutDetailSchema }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.all });
		}
	});
}

export function useUpdateLayoutMutation() {
	const queryClient = useQueryClient();
	return useMutation<LayoutDetail, ApiError, { id: string; body: UpdateLayoutDraftRequest }>({
		mutationFn: ({ id, body }) => apiRequest<LayoutDetail>(`/layouts/${id}`, { method: "PATCH", body, schema: LayoutDetailSchema }),
		onSuccess: detail => {
			queryClient.setQueryData(queryKeys.layouts.detail(detail.id), detail);
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.list() });
		}
	});
}

export function usePublishLayoutMutation() {
	const queryClient = useQueryClient();
	return useMutation<LayoutRevision, ApiError, { id: string; body: PublishLayoutRequest }>({
		mutationFn: ({ id, body }) => apiRequest<LayoutRevision>(`/layouts/${id}/publish`, { method: "POST", body, schema: LayoutRevisionSchema }),
		onSuccess: revision => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.detail(revision.layoutId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.list() });
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}

export function useDeleteLayoutMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/layouts/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.layouts.all });
		}
	});
}
