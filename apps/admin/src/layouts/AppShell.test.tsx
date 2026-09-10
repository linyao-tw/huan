import { AppRoutes } from "@/app/App";
import { makeUser, renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetch(): void {
	// 導覽的測試不應該打到網路；所有清單端點一律回空集合。
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
	);
}

describe("後台導覽", () => {
	beforeEach(() => {
		stubFetch();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("一般使用者看得到自己的四項資源，但看不到使用者管理", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app"], session: { user: makeUser() } });

		for (const label of ["總覽", "素材庫", "版面", "排程", "裝置", "安全設定"]) {
			expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
		}
		expect(screen.queryByRole("link", { name: "使用者" })).not.toBeInTheDocument();
	});

	it("系統管理員只看到總覽、安全設定與使用者", async () => {
		renderWithProviders(<AppRoutes />, { initialEntries: ["/app"], session: { user: makeUser({ role: "super_admin" }) } });

		expect(await screen.findByRole("link", { name: "使用者" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "總覽" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "安全設定" })).toBeInTheDocument();

		/* 這四項屬於各個使用者。列出來等於給一個永遠是空的入口，所以連連結都不該有。 */
		for (const label of ["素材庫", "版面", "排程", "裝置"]) {
			expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
		}
	});
});
