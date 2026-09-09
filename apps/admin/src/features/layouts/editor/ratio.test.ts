import { clientToDesignPoint, ratioFromClientPoint, ratioFromKeyboard, snapRatio, type CanvasProjection } from "@/features/layouts/editor/ratio";
import { collectSlots, computeLayoutGeometry, createEmptyDocument, splitNode, type DividerRect } from "@huan/layout-engine";
import { describe, expect, it } from "vitest";

function makeDivider(direction: "horizontal" | "vertical", ratio = 0.5): DividerRect {
	const base = createEmptyDocument({ width: 1920, height: 1080 });
	const rootSlotId = collectSlots(base.root)[0]?.id as string;
	const split = splitNode(base, rootSlotId, direction, ratio);
	return computeLayoutGeometry(split).dividers[0] as DividerRect;
}

/** 畫布縮到一半、置中於一個 100px 邊界的檢視區裡，用來驗證換算有把偏移一起算進去。 */
const projection: CanvasProjection = { scale: 0.5, offsetX: 20, offsetY: 10, originX: 100, originY: 200 };

describe("分隔線拖曳的座標換算", () => {
	it("把視窗座標換回設計座標時會扣掉檢視區位置與置中偏移", () => {
		const point = clientToDesignPoint(projection, 100 + 20 + 480, 200 + 10 + 270);
		expect(point.x).toBeCloseTo(960, 6);
		expect(point.y).toBeCloseTo(540, 6);
	});

	it("水平分隔線：游標落在畫布 1344 px 處對應 0.7", () => {
		const divider = makeDivider("horizontal");
		const clientX = projection.originX + projection.offsetX + 1344 * projection.scale;
		const ratio = ratioFromClientPoint({ divider, gap: 0, projection, clientX, clientY: 0, snap: false });
		expect(ratio).toBeCloseTo(0.7, 6);
	});

	it("垂直分隔線只看 Y 座標", () => {
		const divider = makeDivider("vertical");
		const clientY = projection.originY + projection.offsetY + 270 * projection.scale;
		const ratio = ratioFromClientPoint({ divider, gap: 0, projection, clientX: 99999, clientY, snap: false });
		expect(ratio).toBeCloseTo(0.25, 6);
	});

	it("間距會從可用寬度扣掉，比例以扣除後的空間計算", () => {
		const divider = makeDivider("horizontal");
		const clientX = projection.originX + projection.offsetX + 950 * projection.scale;
		const ratio = ratioFromClientPoint({ divider, gap: 20, projection, clientX, clientY: 0, snap: false });
		expect(ratio).toBeCloseTo(0.5, 6);
	});

	it("游標拖出畫布時比例被夾在合法範圍內", () => {
		const divider = makeDivider("horizontal");
		const farLeft = ratioFromClientPoint({ divider, gap: 0, projection, clientX: -100000, clientY: 0, snap: false });
		const farRight = ratioFromClientPoint({ divider, gap: 0, projection, clientX: 100000, clientY: 0, snap: false });

		expect(farLeft).toBeCloseTo(0.05, 6);
		expect(farRight).toBeCloseTo(0.95, 6);
	});

	it("接近 1/2、1/3、2/3 時吸附，離得遠就保持原值", () => {
		const divider = makeDivider("horizontal");
		// 可用寬度 1920 設計 px，縮放 0.5 → 螢幕上 960 px；門檻 6 px 約等於 0.00625 的比例。
		expect(snapRatio(0.502, divider, 0, projection.scale)).toBeCloseTo(0.5, 6);
		expect(snapRatio(1 / 3 + 0.004, divider, 0, projection.scale)).toBeCloseTo(1 / 3, 6);
		expect(snapRatio(2 / 3 - 0.004, divider, 0, projection.scale)).toBeCloseTo(2 / 3, 6);
		expect(snapRatio(0.58, divider, 0, projection.scale)).toBeCloseTo(0.58, 6);
	});

	it("按住 Alt 關閉吸附時保留原始比例", () => {
		const divider = makeDivider("horizontal");
		const clientX = projection.originX + projection.offsetX + 968 * projection.scale;
		const snapped = ratioFromClientPoint({ divider, gap: 0, projection, clientX, clientY: 0 });
		const raw = ratioFromClientPoint({ divider, gap: 0, projection, clientX, clientY: 0, snap: false });

		expect(snapped).toBeCloseTo(0.5, 6);
		expect(raw).toBeCloseTo(968 / 1920, 6);
	});
});

describe("鍵盤調整比例", () => {
	it("水平分隔線用左右方向鍵，一次 1%，按住 Shift 一次 5%", () => {
		expect(ratioFromKeyboard(0.5, "ArrowRight", false, "horizontal")).toBeCloseTo(0.51, 6);
		expect(ratioFromKeyboard(0.5, "ArrowLeft", false, "horizontal")).toBeCloseTo(0.49, 6);
		expect(ratioFromKeyboard(0.5, "ArrowRight", true, "horizontal")).toBeCloseTo(0.55, 6);
	});

	it("垂直分隔線用上下方向鍵", () => {
		expect(ratioFromKeyboard(0.5, "ArrowDown", false, "vertical")).toBeCloseTo(0.51, 6);
		expect(ratioFromKeyboard(0.5, "ArrowUp", false, "vertical")).toBeCloseTo(0.49, 6);
		expect(ratioFromKeyboard(0.5, "ArrowRight", false, "vertical")).toBeNull();
	});

	it("鍵盤調整同樣會被夾在合法範圍內", () => {
		expect(ratioFromKeyboard(0.05, "ArrowLeft", true, "horizontal")).toBeCloseTo(0.05, 6);
		expect(ratioFromKeyboard(0.95, "ArrowRight", true, "horizontal")).toBeCloseTo(0.95, 6);
	});

	it("Home 與 End 直接跳到三分之一與三分之二", () => {
		expect(ratioFromKeyboard(0.5, "Home", false, "horizontal")).toBeCloseTo(1 / 3, 6);
		expect(ratioFromKeyboard(0.5, "End", false, "horizontal")).toBeCloseTo(2 / 3, 6);
	});
});
