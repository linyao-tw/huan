import { LandingPage } from "@/pages/LandingPage";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("官網首頁", () => {
	it("呈現品牌、產品說明與主要區塊", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getAllByText("HUAN").length).toBeGreaterThan(0);
		expect(screen.getAllByText("讙").length).toBeGreaterThan(0);
		expect(screen.getAllByText(/跨平台的雲端媒體播放與數位看板系統/).length).toBeGreaterThan(0);

		for (const heading of ["功能", "支援平台", "使用情境"]) {
			expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
		}

		for (const feature of ["遠端集中管理", "遞迴分割排版", "時段排程", "離線播放", "多裝置同步", "稽核紀錄"]) {
			expect(screen.getByRole("heading", { name: feature })).toBeInTheDocument();
		}

		for (const platform of ["Raspberry Pi", "Windows", "Ubuntu", "macOS"]) {
			expect(screen.getByRole("heading", { name: platform })).toBeInTheDocument();
		}

		for (const useCase of ["餐飲點餐看板", "零售櫥窗", "辦公室公告", "展場導覽"]) {
			expect(screen.getByRole("heading", { name: useCase })).toBeInTheDocument();
		}
	});

	it("誠實說明離線播放做不到的事", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getByText("但也有幾件事離線做不到")).toBeInTheDocument();
		expect(screen.getByText(/需重新上傳/)).toBeInTheDocument();
	});

	it("採購只提供 Email 洽詢，沒有任何付款流程", () => {
		renderWithProviders(<LandingPage />, { session: null });

		const mailLinks = screen.getAllByRole("link", { name: /contact@linyao\.tw/ });
		expect(mailLinks.length).toBeGreaterThan(0);
		expect(screen.getByText(/本站不提供線上付款流程/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /立即購買|線上付款|加入購物車/ })).not.toBeInTheDocument();
	});

	it("提供文件與登入的入口", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getAllByRole("link", { name: "文件" }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: "登入" }).length).toBeGreaterThan(0);
	});
});
