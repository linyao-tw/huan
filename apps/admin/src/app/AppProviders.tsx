import { ApiError, setUnauthorizedHandler } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import { ThemeProvider } from "@/shared/theme";
import { LinyaoProvider, ToastProvider } from "@linyao.tw/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

export function createAppQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) => {
					// 4xx 重試沒有意義，只會讓錯誤畫面慢好幾秒才出現。
					if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
					return failureCount < 2;
				}
			},
			mutations: { retry: false }
		}
	});
}

function UnauthorizedBridge({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
	useEffect(() => {
		setUnauthorizedHandler(() => {
			// 只把 session 標成「已登出」。導頁交給守衛，避免和 router 互相觸發。
			queryClient.setQueryData(queryKeys.session, null);
		});
		return () => setUnauthorizedHandler(null);
	}, [queryClient]);

	return children;
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
	const [fallbackClient] = useState(() => createAppQueryClient());
	const queryClient = client ?? fallbackClient;

	return (
		<QueryClientProvider client={queryClient}>
			<UnauthorizedBridge queryClient={queryClient}>
				<ThemeProvider>
					<LinyaoProvider locale="zh-TW">
						<ToastProvider>{children}</ToastProvider>
					</LinyaoProvider>
				</ThemeProvider>
			</UnauthorizedBridge>
		</QueryClientProvider>
	);
}
