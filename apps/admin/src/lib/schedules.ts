import { apiRequest, type ApiError, type Paginated } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { CreateScheduleRequest, Schedule, UpdateScheduleRequest } from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export function useScheduleListQuery(): UseQueryResult<Paginated<Schedule>, ApiError> {
	return useQuery<Paginated<Schedule>, ApiError>({
		queryKey: queryKeys.schedules.list(),
		queryFn: ({ signal }) => apiRequest<Paginated<Schedule>>("/schedules", { signal }),
		staleTime: 30_000
	});
}

export function useCreateScheduleMutation() {
	const queryClient = useQueryClient();
	return useMutation<Schedule, ApiError, CreateScheduleRequest>({
		mutationFn: variables => apiRequest<Schedule>("/schedules", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}

export function useUpdateScheduleMutation() {
	const queryClient = useQueryClient();
	return useMutation<Schedule, ApiError, { id: string; body: UpdateScheduleRequest }>({
		mutationFn: ({ id, body }) => apiRequest<Schedule>(`/schedules/${id}`, { method: "PATCH", body }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}

export function useDeleteScheduleMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/schedules/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}
