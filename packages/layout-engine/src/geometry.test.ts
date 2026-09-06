import type { LayoutDocument } from "@huan/protocol";
import { describe, expect, it } from "vitest";
import { computeFitTransform, computeLayoutGeometry, ratioFromPointer, splitRect } from "./geometry.js";
import { createEmptyDocument, splitNode } from "./tree.js";

function seventyThirty(gap = 0): LayoutDocument {
	const empty = createEmptyDocument({ width: 1920, height: 1080 });
	const split = splitNode({ ...empty, gap }, empty.root.id, "horizontal", 0.7);
	return split;
}

describe("splitRect", () => {
	it("水平分割產生左右兩塊", () => {
		const [first, second] = splitRect({ x: 0, y: 0, width: 1000, height: 500 }, "horizontal", 0.7, 0);
		expect(first).toEqual({ x: 0, y: 0, width: 700, height: 500 });
		expect(second).toEqual({ x: 700, y: 0, width: 300, height: 500 });
	});

	it("垂直分割產生上下兩塊", () => {
		const [first, second] = splitRect({ x: 0, y: 0, width: 1000, height: 500 }, "vertical", 0.4, 0);
		expect(first).toEqual({ x: 0, y: 0, width: 1000, height: 200 });
		expect(second).toEqual({ x: 0, y: 200, width: 1000, height: 300 });
	});

	it("間距從可用空間扣除，外緣仍貼齊容器", () => {
		const [first, second] = splitRect({ x: 0, y: 0, width: 1000, height: 500 }, "horizontal", 0.5, 20);
		expect(first).toEqual({ x: 0, y: 0, width: 490, height: 500 });
		expect(second).toEqual({ x: 510, y: 0, width: 490, height: 500 });
		expect(second.x + second.width).toBe(1000);
	});

	it("比例被夾在可操作的範圍內", () => {
		const [first] = splitRect({ x: 0, y: 0, width: 1000, height: 500 }, "horizontal", 0.001, 0);
		expect(first.width).toBe(50);
	});
});

describe("computeLayoutGeometry", () => {
	it("70/30 的水平分割在 1920×1080 上得到 1344 與 576", () => {
		const { slots } = computeLayoutGeometry(seventyThirty());
		expect(slots).toHaveLength(2);
		expect(slots[0]?.width).toBe(1344);
		expect(slots[1]?.width).toBe(576);
		expect(slots[0]?.height).toBe(1080);
	});

	it("所有插槽面積加總等於畫布面積（無間距時）", () => {
		const document = seventyThirty();
		const nested = splitNode(document, computeLayoutGeometry(document).slots[1]!.nodeId, "vertical", 0.5);
		const { slots } = computeLayoutGeometry(nested);
		const total = slots.reduce((sum, slot) => sum + slot.width * slot.height, 0);
		expect(total).toBeCloseTo(1920 * 1080, 6);
	});

	it("插槽之間不重疊", () => {
		const { slots } = computeLayoutGeometry(seventyThirty(24));
		const [left, right] = slots;
		expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
	});

	it("為每個分割回報一條分隔線", () => {
		const document = seventyThirty(16);
		const { dividers } = computeLayoutGeometry(document);
		expect(dividers).toHaveLength(1);
		expect(dividers[0]?.direction).toBe("horizontal");
		expect(dividers[0]?.width).toBe(16);
		expect(dividers[0]?.height).toBe(1080);
	});

	it.each([
		[1920, 1080],
		[1280, 720],
		[3840, 2160],
		[1080, 1920]
	])("在 %ix%i 的畫布上維持相同比例", (width, height) => {
		const empty = createEmptyDocument({ width, height });
		const document = splitNode(empty, empty.root.id, "horizontal", 0.7);
		const { slots } = computeLayoutGeometry(document);
		expect(slots[0]!.width / width).toBeCloseTo(0.7, 10);
		expect(slots[1]!.width / width).toBeCloseTo(0.3, 10);
	});
});

describe("computeFitTransform", () => {
	it("相同長寬比時填滿整個視窗", () => {
		const fit = computeFitTransform({ width: 1920, height: 1080 }, { width: 1280, height: 720 });
		expect(fit.scale).toBeCloseTo(2 / 3, 10);
		expect(fit.offsetX).toBe(0);
		expect(fit.offsetY).toBe(0);
	});

	it("長寬比不同時等比縮放並置中，不做拉伸", () => {
		const fit = computeFitTransform({ width: 1920, height: 1080 }, { width: 1000, height: 1000 });
		expect(fit.scale).toBeCloseTo(1000 / 1920, 10);
		expect(fit.width).toBeCloseTo(1000, 6);
		expect(fit.height).toBeCloseTo(562.5, 6);
		expect(fit.offsetX).toBeCloseTo(0, 6);
		expect(fit.offsetY).toBeCloseTo(218.75, 6);
	});

	it("直式畫布放進橫式螢幕時左右留白", () => {
		const fit = computeFitTransform({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
		expect(fit.height).toBeCloseTo(1080, 6);
		expect(fit.offsetX).toBeGreaterThan(0);
	});

	it("視窗尺寸為零時退回安全值", () => {
		expect(computeFitTransform({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 });
	});
});

describe("ratioFromPointer", () => {
	it("把游標位置換算回比例", () => {
		const { dividers } = computeLayoutGeometry(seventyThirty());
		const divider = dividers[0]!;
		expect(ratioFromPointer(divider, 960, 540, 0)).toBeCloseTo(0.5, 10);
	});

	it("超出範圍時夾回可操作區間", () => {
		const { dividers } = computeLayoutGeometry(seventyThirty());
		const divider = dividers[0]!;
		expect(ratioFromPointer(divider, -500, 540, 0)).toBe(0.05);
		expect(ratioFromPointer(divider, 5000, 540, 0)).toBe(0.95);
	});
});
