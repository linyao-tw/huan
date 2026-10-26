import { apiRequest, apiRequestBlob, type ApiError, type Paginated } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import type { ConfirmPairingRequest, Device, PairingLookupResponse, UpdateDeviceRequest } from "@huan/protocol";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

export function useDeviceListQuery(): UseQueryResult<Paginated<Device>, ApiError> {
	return useQuery<Paginated<Device>, ApiError>({
		queryKey: queryKeys.devices.list(),
		queryFn: ({ signal }) => apiRequest<Paginated<Device>>("/devices", { signal }),
		staleTime: 10_000,
		// 上下線狀態靠 heartbeat 更新；WebSocket 沒接上時這個間隔仍讓畫面保持可信。
		refetchInterval: 30_000
	});
}

export function useDeviceQuery(id: string | null): UseQueryResult<Device, ApiError> {
	return useQuery<Device, ApiError>({
		queryKey: queryKeys.devices.detail(id ?? ""),
		queryFn: ({ signal }) => apiRequest<Device>(`/devices/${id ?? ""}`, { signal }),
		enabled: Boolean(id),
		staleTime: 10_000,
		refetchInterval: 15_000
	});
}

export interface DeviceScreenFrame {
	blob: Blob;
	capturedAt: string | null;
}

/** 輪詢就是「我還在看」的訊號：停止輪詢，裝置十秒內就會停止上傳截圖。 */
export const DEVICE_SCREEN_POLL_MS = 1_000;

export function useDeviceScreenQuery(id: string, enabled: boolean): UseQueryResult<DeviceScreenFrame | null, ApiError> {
	return useQuery<DeviceScreenFrame | null, ApiError>({
		queryKey: queryKeys.devices.screen(id),
		queryFn: async ({ signal }) => {
			const result = await apiRequestBlob(`/devices/${id}/screen`, { signal });
			return result ? { blob: result.blob, capturedAt: result.headers.get("x-huan-captured-at") } : null;
		},
		enabled,
		refetchInterval: enabled ? DEVICE_SCREEN_POLL_MS : false,
		// 分頁在背景時不看畫面，也就不必讓裝置一直傳。
		refetchIntervalInBackground: false,
		// 截圖過了幾秒就沒有價值，不留快取，下次打開不會先閃一張舊畫面。
		gcTime: 0,
		staleTime: 0,
		retry: false
	});
}

export function useUpdateDeviceMutation() {
	const queryClient = useQueryClient();
	return useMutation<Device, ApiError, { id: string; body: UpdateDeviceRequest }>({
		mutationFn: ({ id, body }) => apiRequest<Device>(`/devices/${id}`, { method: "PATCH", body }),
		onSuccess: device => {
			queryClient.setQueryData(queryKeys.devices.detail(device.id), device);
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.list() });
		}
	});
}

export function useUnbindDeviceMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/devices/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}

export function useForceSyncMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/devices/${id}/force-sync`, { method: "POST" }),
		onSuccess: (_result, id) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(id) });
		}
	});
}

export function useRestartPlayerMutation() {
	const queryClient = useQueryClient();
	return useMutation<void, ApiError, string>({
		mutationFn: id => apiRequest<void>(`/devices/${id}/restart-player`, { method: "POST" }),
		onSuccess: (_result, id) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(id) });
		}
	});
}

export function usePairingLookupQuery(code: string | null): UseQueryResult<PairingLookupResponse, ApiError> {
	return useQuery<PairingLookupResponse, ApiError>({
		queryKey: queryKeys.pairing.lookup(code ?? ""),
		queryFn: ({ signal }) => apiRequest<PairingLookupResponse>(`/pairing/${encodeURIComponent(code ?? "")}`, { signal }),
		enabled: Boolean(code),
		retry: false,
		staleTime: 5_000
	});
}

export function useConfirmPairingMutation() {
	const queryClient = useQueryClient();
	return useMutation<Device, ApiError, ConfirmPairingRequest>({
		mutationFn: variables => apiRequest<Device>("/pairing/confirm", { method: "POST", body: variables }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
		}
	});
}
