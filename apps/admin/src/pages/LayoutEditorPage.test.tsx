import { LayoutEditorPage } from "@/pages/LayoutEditorPage";
import { makeUser, renderWithProviders } from "@/test/render";
import { collectSlots, createEmptyDocument, splitNode } from "@huan/layout-engine";
import { LayoutDetailSchema } from "@huan/protocol";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LAYOUT_ID = "33333333-3333-4333-8333-333333333333";

function makeLayoutDetail() {
	const base = createEmptyDocument({ width: 1920, height: 1080 });
	const draft = splitNode(base, collectSlots(base.root)[0]?.id as string, "horizontal", 0.7);
	return LayoutDetailSchema.parse({
		id: LAYOUT_ID,
		name: "櫥窗主畫面",
		description: null,
		canvas: draft.canvas,
		publishedRevisionId: null,
		publishedRevisionNumber: null,
		draftUpdatedAt: "2026-09-01T00:00:00.000Z",
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		draft,
		revisions: []
	});
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("版面編輯器畫面", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
				if (url.includes(`/layouts/${LAYOUT_ID}`)) return json(makeLayoutDetail());
				return json({ items: [], total: 0, limit: 50, offset: 0 });
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("載入草稿後渲染三個面板與畫布上的區塊與分隔線", async () => {
		renderWithProviders(
			<Routes>
				<Route path="/app/layouts/:layoutId" element={<LayoutEditorPage />} />
			</Routes>,
			{ initialEntries: [`/app/layouts/${LAYOUT_ID}`], session: { user: makeUser() } }
		);

		const canvas = await screen.findByRole("group", { name: "版面畫布 1920 × 1080" });
		expect(within(canvas).getAllByRole("button", { name: /^區塊：/ })).toHaveLength(2);

		const divider = within(canvas).getByRole("separator");
		expect(divider).toHaveAttribute("aria-valuenow", "70");
		expect(divider).toHaveAttribute("aria-orientation", "vertical");

		expect(screen.getByRole("heading", { name: "內容來源" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "區塊" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "版面" })).toBeInTheDocument();
	});

	it("分隔線可以用鍵盤調整比例，不必依賴拖曳", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<Routes>
				<Route path="/app/layouts/:layoutId" element={<LayoutEditorPage />} />
			</Routes>,
			{ initialEntries: [`/app/layouts/${LAYOUT_ID}`], session: { user: makeUser() } }
		);

		const canvas = await screen.findByRole("group", { name: "版面畫布 1920 × 1080" });
		const divider = within(canvas).getByRole("separator");
		divider.focus();
		await user.keyboard("{ArrowLeft}");

		expect(within(canvas).getByRole("separator")).toHaveAttribute("aria-valuenow", "69");
	});

	it("選取區塊後可以用按鈕分割，畫布多出一個區塊", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<Routes>
				<Route path="/app/layouts/:layoutId" element={<LayoutEditorPage />} />
			</Routes>,
			{ initialEntries: [`/app/layouts/${LAYOUT_ID}`], session: { user: makeUser() } }
		);

		const canvas = await screen.findByRole("group", { name: "版面畫布 1920 × 1080" });
		await user.click(within(canvas).getAllByRole("button", { name: /^區塊：/ })[0] as HTMLElement);
		await user.click(screen.getByRole("button", { name: "垂直分割" }));

		expect(within(canvas).getAllByRole("button", { name: /^區塊：/ })).toHaveLength(3);
		expect(within(canvas).getAllByRole("separator")).toHaveLength(2);
	});
});
