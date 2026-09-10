import { LandingPage } from "@/features/marketing/LandingPage";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("官網首頁", () => {
	it("呈現品牌、產品說明與主要區塊", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getAllByText("HUAN").length).toBeGreaterThan(0);
		expect(screen.getAllByText("讙").length).toBeGreaterThan(0);
		expect(screen.getByRole("heading", { name: "集中管理每一個畫面，穩定發布到每一台裝置", level: 1 })).toBeInTheDocument();
		expect(screen.getAllByText(/企業級雲端數位看板與媒體播放平台/).length).toBeGreaterThan(0);

		for (const heading of [
			"跨平台部署，一套內容一致呈現",
			"三個步驟，完成從內容到現場的發布流程",
			"即使網路中斷，播放仍持續運作",
			"為數位看板營運所設計的完整能力",
			"一套平台，適用多種數位顯示場景",
			"準備導入 HUAN？"
		]) {
			expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
		}

		for (const feature of ["集中式遠端管理", "彈性的多區域版面", "可預期的播放排程", "一致的多裝置發布", "本機優先的離線播放", "安全性與操作稽核"]) {
			expect(screen.getByRole("heading", { name: feature })).toBeInTheDocument();
		}

		for (const platform of ["Raspberry Pi", "Windows", "Ubuntu", "macOS"]) {
			expect(screen.getByText(platform)).toBeInTheDocument();
		}

		for (const useCase of ["餐飲菜單看板", "零售與櫥窗展示", "企業內部資訊發布", "展覽與活動導覽"]) {
			expect(screen.getByRole("heading", { name: useCase })).toBeInTheDocument();
		}
	});

	/** 首屏不該只有文字：真實的產品畫面是這一頁最重要的證據。 */
	it("用真實的產品截圖而不是示意圖", () => {
		renderWithProviders(<LandingPage />, { session: null });

		const shots = screen.getAllByRole("img");
		expect(shots.length).toBeGreaterThanOrEqual(4);
		for (const shot of shots) {
			expect(shot.getAttribute("src")).toMatch(/^\/screenshots\/.+\.png$/);
			// 沒有寬高的話，圖片載入時底下的內容會先往上擠再被推下去。
			expect(shot).toHaveAttribute("width");
			expect(shot).toHaveAttribute("height");
			expect(shot.getAttribute("alt")).not.toBe("");
		}
	});

	it("採購只提供 Email 洽詢，沒有任何付款流程", () => {
		renderWithProviders(<LandingPage />, { session: null });

		const mailLinks = screen.getAllByRole("link", { name: /contact@linyao\.tw/ });
		expect(mailLinks.length).toBeGreaterThan(0);
		expect(screen.getByText(/目前不提供線上付款/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /立即購買|線上付款|加入購物車/ })).not.toBeInTheDocument();
	});

	it("提供文件與登入的入口", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getAllByRole("link", { name: "文件" }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: "登入" }).length).toBeGreaterThan(0);
	});
});
