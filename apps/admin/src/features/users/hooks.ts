import { apiRequest, type ApiError, type Paginated } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import type { CreateUserRequest, ResetUserPasswordRequest, UpdateUserRequest, User } from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export function useUserListQuery(enabled: boolean): UseQueryResult<Paginated<User>, ApiError> {
	return useQuery<Paginated<User>, ApiError>({
		queryKey: queryKeys.users.list(),
		queryFn: ({ signal }) => apiRequest<Paginated<User>>("/users", { signal }),
		enabled,
		staleTime: 30_000
	});
}

export function useCreateUserMutation() {
	const queryClient = useQueryClient();
	return useMutation<User, ApiError, CreateUserRequest>({
		mutationFn: variables => apiRequest<User>("/users", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
		}
	});
}

export function useUpdateUserMutation() {
	const queryClient = useQueryClient();
	return useMutation<User, ApiError, { id: string; body: UpdateUserRequest }>({
		mutationFn: ({ id, body }) => apiRequest<User>(`/users/${id}`, { method: "PATCH", body }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
		}
	});
}

export function useResetUserPasswordMutation() {
	return useMutation<void, ApiError, { id: string; body: ResetUserPasswordRequest }>({
		mutationFn: ({ id, body }) => apiRequest<void>(`/users/${id}/password`, { method: "POST", body })
	});
}
