import { queryKeys } from "@/shared/services/query-keys";
import { API_PREFIX, AdminEventSchema } from "@huan/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

function socketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}${API_PREFIX}/admin/socket`;
}

/**
 * Admin 的即時通知。
 *
 * 這條連線只負責「有東西變了」，收到之後一律回頭打 REST 取事實；
 * 因此連不上時畫面仍然正確，只是更新得慢一點，所以失敗完全靜默處理。
 */
export function useAdminSocket(enabled: boolean): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!enabled || typeof WebSocket === "undefined") return;

		let socket: WebSocket | null = null;
		let closed = false;
		let retryDelay = 1_000;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;

		const connect = (): void => {
			if (closed) return;
			try {
				socket = new WebSocket(socketUrl());
			} catch {
				return;
			}

			socket.addEventListener("open", () => {
				retryDelay = 1_000;
			});

			socket.addEventListener("message", event => {
				if (typeof event.data !== "string") return;
				let payload: unknown;
				try {
					payload = JSON.parse(event.data);
				} catch {
					return;
				}
				const parsed = AdminEventSchema.safeParse(payload);
				if (!parsed.success) return;
				const message = parsed.data;
				if (message.type === "device_changed") {
					void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
				} else if (message.type === "media_changed") {
					void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
				}
			});

			socket.addEventListener("close", () => {
				if (closed) return;
				retryTimer = setTimeout(connect, retryDelay);
				retryDelay = Math.min(retryDelay * 2, 30_000);
			});
		};

		connect();

		return () => {
			closed = true;
			if (retryTimer) clearTimeout(retryTimer);
			socket?.close();
		};
	}, [enabled, queryClient]);
}
