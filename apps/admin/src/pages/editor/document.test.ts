import { createTextContent, createUrlContent } from "@/pages/editor/content";
import { collectSlots, computeLayoutGeometry, createEmptyDocument, removeSlot, setSlotContent, setSplitRatio, splitNode, swapSlotContent } from "@huan/layout-engine";
import type { LayoutDocument } from "@huan/protocol";
import { describe, expect, it } from "vitest";

function slotIds(document: LayoutDocument): string[] {
	return collectSlots(document.root).map(slot => slot.id);
}

describe("版面編輯器的樹狀操作", () => {
	it("水平分割 70/30 在 1920x1080 的畫布上得到 1344 與 576 寬", () => {
		const base = createEmptyDocument({ width: 1920, height: 1080 });
		const rootSlotId = slotIds(base)[0];
		expect(rootSlotId).toBeDefined();

		const split = splitNode(base, rootSlotId as string, "horizontal", 0.7);
		const geometry = computeLayoutGeometry(split);

		expect(geometry.slots).toHaveLength(2);
		expect(geometry.slots[0]?.width).toBeCloseTo(1344, 6);
		expect(geometry.slots[1]?.width).toBeCloseTo(576, 6);
		expect(geometry.slots[0]?.height).toBeCloseTo(1080, 6);
		expect(geometry.slots[1]?.x).toBeCloseTo(1344, 6);
	});

	it("垂直分割 70/30 得到 756 與 324 高", () => {
		const base = createEmptyDocument({ width: 1920, height: 1080 });
		const split = splitNode(base, slotIds(base)[0] as string, "vertical", 0.7);
		const geometry = computeLayoutGeometry(split);

		expect(geometry.slots[0]?.height).toBeCloseTo(756, 6);
		expect(geometry.slots[1]?.height).toBeCloseTo(324, 6);
		expect(geometry.slots[1]?.y).toBeCloseTo(756, 6);
	});

	it("間距是從可用空間扣掉的，因此區塊外緣仍貼齊畫布", () => {
		const base = { ...createEmptyDocument({ width: 1920, height: 1080 }), gap: 20 };
		const split = splitNode(base, slotIds(base)[0] as string, "horizontal", 0.5);
		const geometry = computeLayoutGeometry(split);

		expect(geometry.slots[0]?.width).toBeCloseTo(950, 6);
		expect(geometry.slots[1]?.width).toBeCloseTo(950, 6);
		expect((geometry.slots[1]?.x ?? 0) + (geometry.slots[1]?.width ?? 0)).toBeCloseTo(1920, 6);
	});

	it("拖曳比例會被夾在 0.05 與 0.95 之間", () => {
		const base = createEmptyDocument({ width: 1000, height: 1000 });
		const split = splitNode(base, slotIds(base)[0] as string, "horizontal", 0.5);
		const dividerId = computeLayoutGeometry(split).dividers[0]?.nodeId as string;

		const tooSmall = computeLayoutGeometry(setSplitRatio(split, dividerId, -3));
		expect(tooSmall.slots[0]?.width).toBeCloseTo(50, 6);

		const tooLarge = computeLayoutGeometry(setSplitRatio(split, dividerId, 12));
		expect(tooLarge.slots[0]?.width).toBeCloseTo(950, 6);
	});

	it("刪除區塊會移除整個分割，另一半頂上來占滿整個畫布", () => {
		const base = createEmptyDocument({ width: 1920, height: 1080 });
		const split = splitNode(base, slotIds(base)[0] as string, "horizontal", 0.7);
		const [first, second] = slotIds(split);

		const removed = removeSlot(split, second as string);
		const geometry = computeLayoutGeometry(removed);

		expect(geometry.slots).toHaveLength(1);
		expect(geometry.dividers).toHaveLength(0);
		expect(geometry.slots[0]?.nodeId).toBe(first);
		expect(geometry.slots[0]?.width).toBeCloseTo(1920, 6);
		expect(geometry.slots[0]?.height).toBeCloseTo(1080, 6);
	});

	it("刪除唯一的根區塊只會清空內容，版面永遠至少保留一個區塊", () => {
		const base = setSlotContent(createEmptyDocument(), slotIds(createEmptyDocument())[0] as string, createTextContent());
		const rootId = slotIds(base)[0] as string;
		const withContent = setSlotContent(base, rootId, createTextContent());

		const removed = removeSlot(withContent, rootId);

		expect(collectSlots(removed.root)).toHaveLength(1);
		expect(collectSlots(removed.root)[0]?.content).toBeNull();
	});

	it("拖放到另一個區塊是交換內容，不是複製", () => {
		const base = createEmptyDocument({ width: 1920, height: 1080 });
		const split = splitNode(base, slotIds(base)[0] as string, "horizontal", 0.7);
		const [first, second] = slotIds(split) as [string, string];

		const text = createTextContent();
		const url = createUrlContent("https://menu.example.com");
		const filled = setSlotContent(setSlotContent(split, first, text), second, url);

		const swapped = swapSlotContent(filled, first, second);
		const slots = collectSlots(swapped.root);

		expect(slots[0]?.content).toEqual(url);
		expect(slots[1]?.content).toEqual(text);
		// 幾何不因交換而改變：交換的是內容，不是區塊。
		expect(computeLayoutGeometry(swapped).slots[0]?.width).toBeCloseTo(1344, 6);
	});

	it("把內容交換到空白區塊會把來源清空", () => {
		const base = createEmptyDocument();
		const split = splitNode(base, slotIds(base)[0] as string, "vertical", 0.5);
		const [first, second] = slotIds(split) as [string, string];
		const filled = setSlotContent(split, first, createTextContent());

		const swapped = swapSlotContent(filled, first, second);
		const slots = collectSlots(swapped.root);

		expect(slots[0]?.content).toBeNull();
		expect(slots[1]?.content?.type).toBe("text");
	});
});
