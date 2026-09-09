import { LandingPage } from "@/features/marketing/LandingPage";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("官網首頁", () => {
	it("呈現品牌、產品說明與主要區塊", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getAllByText("HUAN").length).toBeGreaterThan(0);
		expect(screen.getAllByText("讙").length).toBeGreaterThan(0);
		expect(screen.getByRole("heading", { name: "排好畫面，看板自己接手", level: 1 })).toBeInTheDocument();
		expect(screen.getAllByText(/跨平台的雲端媒體播放與數位看板系統/).length).toBeGreaterThan(0);

		for (const heading of [
			"同一份內容，四種平台",
			"三個步驟，從素材到現場",
			"網路斷了，看板還在播",
			"只做這條路上該做的事",
			"同一套系統，四種完全不同的現場",
			"離線做得到什麼，做不到什麼",
			"想導入 HUAN？"
		]) {
			expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
		}

		for (const feature of ["遠端集中管理", "遞迴分割排版", "時段排程", "離線續播", "多裝置同步", "安全與稽核"]) {
			expect(screen.getByRole("heading", { name: feature })).toBeInTheDocument();
		}

		for (const platform of ["Raspberry Pi", "Windows", "Ubuntu", "macOS"]) {
			expect(screen.getByText(platform)).toBeInTheDocument();
		}

		for (const useCase of ["餐飲點餐看板", "零售櫥窗", "辦公室公告", "展場導覽"]) {
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

	it("誠實說明離線播放做不到的事", () => {
		renderWithProviders(<LandingPage />, { session: null });

		expect(screen.getByRole("heading", { name: "斷線期間發布的內容不會生效" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "網頁內容需要連線" })).toBeInTheDocument();
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
