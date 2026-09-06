import { apiRequest, type ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
	SecurityOverviewSchema,
	TotpActivateResponseSchema,
	TotpSetupResponseSchema,
	type SecurityOverview,
	type TotpActivateRequest,
	type TotpActivateResponse,
	type TotpDisableRequest,
	type TotpSetupRequest,
	type TotpSetupResponse
} from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export function useSecurityOverviewQuery(): UseQueryResult<SecurityOverview, ApiError> {
	return useQuery<SecurityOverview, ApiError>({
		queryKey: queryKeys.security,
		queryFn: ({ signal }) => apiRequest<SecurityOverview>("/security", { signal, schema: SecurityOverviewSchema }),
		staleTime: 15_000
	});
}

export function useTotpSetupMutation() {
	return useMutation<TotpSetupResponse, ApiError, TotpSetupRequest>({
		mutationFn: variables => apiRequest<TotpSetupResponse>("/security/totp/setup", { method: "POST", body: variables, schema: TotpSetupResponseSchema })
	});
}

export function useTotpActivateMutation() {
	const queryClient = useQueryClient();
	return useMutation<TotpActivateResponse, ApiError, TotpActivateRequest>({
		mutationFn: variables => apiRequest<TotpActivateResponse>("/security/totp/activate", { method: "POST", body: variables, schema: TotpActivateResponseSchema }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.security });
			void queryClient.invalidateQueries({ queryKey: queryKeys.session });
		}
	});
}

export function useTotpDisableMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, TotpDisableRequest>({
		mutationFn: variables => apiRequest<void>("/security/totp/disable", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.security });
			void queryClient.invalidateQueries({ queryKey: queryKeys.session });
		}
	});
}

export function useRegenerateRecoveryCodesMutation() {
	const queryClient = useQueryClient();
	return useMutation<TotpActivateResponse, ApiError, TotpDisableRequest>({
		mutationFn: variables => apiRequest<TotpActivateResponse>("/security/totp/recovery-codes", { method: "POST", body: variables, schema: TotpActivateResponseSchema }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.security });
		}
	});
}

export function useRevokeSessionMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/security/sessions/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.security });
		}
	});
}
