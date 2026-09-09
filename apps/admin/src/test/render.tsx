import { AppProviders } from "@/app/AppProviders";
import { queryKeys } from "@/shared/services/query-keys";
import type { SessionResponse, User } from "@huan/protocol";
import { QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

export function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		email: "operator@example.com",
		username: "operator",
		displayName: "現場操作員",
		role: "user",
		status: "active",
		totpEnabled: false,
		lastLoginAt: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

export interface RenderOptions {
	initialEntries?: string[];
	/** `null` 代表未登入，`undefined` 代表不預先填入快取（會實際發出請求）。 */
	session?: SessionResponse | null;
}

export function renderWithProviders(ui: ReactNode, { initialEntries = ["/"], session }: RenderOptions = {}): RenderResult & { queryClient: QueryClient } {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false, refetchOnMount: false },
			mutations: { retry: false }
		}
	});

	if (session !== undefined) queryClient.setQueryData(queryKeys.session, session);

	const result = render(
		<AppProviders client={queryClient}>
			<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
		</AppProviders>
	);

	return { ...result, queryClient };
}
