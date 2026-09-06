import { ApiError, apiRequest } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
	ChangePasswordRequestSchema,
	LoginResponseSchema,
	SessionResponseSchema,
	type ChangePasswordRequest,
	type LoginRequest,
	type LoginResponse,
	type SessionResponse,
	type TotpChallengeRequest,
	type User
} from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

/**
 * 未登入不是錯誤，而是一種正常結果。
 *
 * 把 401 轉成 `null` 之後，守衛只要看資料就能決定要不要導頁，
 * 不必去分辨「還在載入」與「請求失敗」，也不會觸發 TanStack Query 的重試。
 */
async function fetchSession(signal: AbortSignal): Promise<SessionResponse | null> {
	try {
		return await apiRequest<SessionResponse>("/auth/session", { signal, schema: SessionResponseSchema, skipUnauthorizedHandler: true });
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) return null;
		throw error;
	}
}

export function useSessionQuery(): UseQueryResult<SessionResponse | null, ApiError> {
	return useQuery<SessionResponse | null, ApiError>({
		queryKey: queryKeys.session,
		queryFn: ({ signal }) => fetchSession(signal),
		staleTime: 60_000,
		retry: false
	});
}

export function useCurrentUser(): User | null {
	const session = useSessionQuery();
	return session.data?.user ?? null;
}

export function useLoginMutation() {
	return useMutation<LoginResponse, ApiError, LoginRequest>({
		mutationFn: variables => apiRequest<LoginResponse>("/auth/login", { method: "POST", body: variables, schema: LoginResponseSchema, skipUnauthorizedHandler: true })
	});
}

export function useTotpChallengeMutation() {
	return useMutation<SessionResponse, ApiError, TotpChallengeRequest>({
		mutationFn: variables => apiRequest<SessionResponse>("/auth/totp/challenge", { method: "POST", body: variables, schema: SessionResponseSchema, skipUnauthorizedHandler: true })
	});
}

export function useLogoutMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, void>({
		mutationFn: () => apiRequest<void>("/auth/logout", { method: "POST" }),
		onSuccess: () => {
			queryClient.setQueryData(queryKeys.session, null);
			// 登出後留著的清單快取會在下一個帳號登入時短暫閃出，因此整份丟掉。
			queryClient.clear();
		}
	});
}

export function useChangePasswordMutation() {
	return useMutation<void, ApiError, ChangePasswordRequest>({
		mutationFn: variables => apiRequest<void>("/auth/password", { method: "POST", body: ChangePasswordRequestSchema.parse(variables) })
	});
}
