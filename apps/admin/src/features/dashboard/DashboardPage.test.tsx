import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { makeUser, renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetch(): void {
	// 總覽只在意「哪些數字出現」，因此所有清單端點一律回空集合。
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
	);
}

describe("總覽", () => {
	beforeEach(() => {
		stubFetch();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("一般使用者看到自己的資源數字", async () => {
		renderWithProviders(<DashboardPage />, { initialEntries: ["/app"], session: { user: makeUser() } });

		expect(await screen.findByText("裝置在線上")).toBeInTheDocument();
		expect(screen.getByText("已發布的版面")).toBeInTheDocument();
		expect(screen.getByText("啟用中的排程")).toBeInTheDocument();
	});

	it("系統管理員看到角色說明與使用者管理的入口，而不是四個零", async () => {
		renderWithProviders(<DashboardPage />, { initialEntries: ["/app"], session: { user: makeUser({ role: "super_admin" }) } });

		expect(await screen.findByText("這四項不在系統管理員手上")).toBeInTheDocument();
		/* 設計系統的 Button 即使渲染成 <a> 也會掛上 role="button"，所以用按鈕角色查。 */
		expect(screen.getByRole("button", { name: "去使用者管理" })).toHaveAttribute("href", "/app/users");

		/* 四個零沒有任何解釋時，讀起來像資料被刪光了。 */
		expect(screen.queryByText("裝置在線上")).not.toBeInTheDocument();
		expect(screen.queryByText("已發布的版面")).not.toBeInTheDocument();
	});
});
