import { AppRoutes } from "@/app/App";
import { makeUser, renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetch(): void {
	// 守衛的測試不應該打到網路；所有清單端點一律回空集合。
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
	);
}

describe("/app 的登入守衛", () => {
	beforeEach(() => {
		stubFetch();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("未登入時把 /app/media 轉往登入頁，並保留原本要去的位址", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/media"], session: null });

		expect(await screen.findByRole("heading", { name: "登入 HUAN 後台" })).toBeInTheDocument();
		expect(screen.getByLabelText("Email 或帳號")).toBeInTheDocument();
	});

	it("已登入時讓一般使用者進入後台", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/devices"], session: { user: makeUser() } });

		expect(await screen.findByRole("heading", { name: "裝置", level: 2 })).toBeInTheDocument();
	});

	it("一般使用者開啟 /app/users 時顯示 403 說明，而不是空白或轉址", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/users"], session: { user: makeUser({ role: "user" }) } });

		expect(await screen.findByText("沒有存取這個頁面的權限")).toBeInTheDocument();
		expect(screen.getByText("403")).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "使用者管理" })).not.toBeInTheDocument();
	});

	it("super_admin 可以開啟 /app/users", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/users"], session: { user: makeUser({ role: "super_admin" }) } });

		expect(await screen.findByRole("heading", { name: "使用者管理", level: 2 })).toBeInTheDocument();
	});

	it("super_admin 開啟 /app/devices 時看到這個角色沒有這項功能，而不是空表格", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/devices"], session: { user: makeUser({ role: "super_admin" }) } });

		expect(await screen.findByText("這個角色沒有這項功能")).toBeInTheDocument();
		expect(screen.getByText("403")).toBeInTheDocument();
		/* 空清單會讓人以為自己的裝置被刪掉了，所以裝置頁的標題一個字都不該出現。 */
		expect(screen.queryByRole("heading", { name: "裝置", level: 2 })).not.toBeInTheDocument();
	});

	it("super_admin 開啟 /app/media 時同樣看到權限說明", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app/media"], session: { user: makeUser({ role: "super_admin" }) } });

		expect(await screen.findByText("這個角色沒有這項功能")).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "素材庫", level: 2 })).not.toBeInTheDocument();
	});
});
