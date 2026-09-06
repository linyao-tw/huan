import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO, type LayoutDocument, type LayoutNode, type SlotContent } from "@huan/protocol";

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SlotRect extends Rect {
	nodeId: string;
	content: SlotContent | null;
}

export interface DividerRect extends Rect {
	nodeId: string;
	direction: "horizontal" | "vertical";
	ratio: number;
	/** 父分割節點在設計畫布中佔用的區域，拖曳分隔線時用來換算新的比例。 */
	container: Rect;
}

export interface LayoutGeometry {
	slots: SlotRect[];
	dividers: DividerRect[];
}

export function clampRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return 0.5;
	return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

/**
 * 把一個分割節點的區域切成兩塊。
 *
 * `gap` 是從可用空間裡扣掉的，不是加在外面：這樣不論分幾層，
 * 所有區塊的外緣永遠貼齊畫布邊界，只有區塊之間有間距。
 */
export function splitRect(rect: Rect, direction: "horizontal" | "vertical", ratio: number, gap: number): [Rect, Rect] {
	const safeRatio = clampRatio(ratio);
	if (direction === "horizontal") {
		const available = Math.max(0, rect.width - gap);
		const firstWidth = available * safeRatio;
		return [
			{ x: rect.x, y: rect.y, width: firstWidth, height: rect.height },
			{ x: rect.x + firstWidth + gap, y: rect.y, width: available - firstWidth, height: rect.height }
		];
	}
	const available = Math.max(0, rect.height - gap);
	const firstHeight = available * safeRatio;
	return [
		{ x: rect.x, y: rect.y, width: rect.width, height: firstHeight },
		{ x: rect.x, y: rect.y + firstHeight + gap, width: rect.width, height: available - firstHeight }
	];
}

/**
 * 計算版面中每個插槽與分隔線在設計畫布座標系裡的位置。
 *
 * 這是 Admin 預覽與 Device 播放唯一的幾何來源。兩邊都拿同一份結果去算繪，
 * 因此不可能出現「後台看起來 70/30、實機變成 68/32」的偏差。
 */
export function computeLayoutGeometry(document: LayoutDocument): LayoutGeometry {
	const slots: SlotRect[] = [];
	const dividers: DividerRect[] = [];
	const gap = Math.max(0, document.gap);

	const walk = (node: LayoutNode, rect: Rect): void => {
		if (node.type === "slot") {
			slots.push({ nodeId: node.id, content: node.content, ...rect });
			return;
		}
		const [first, second] = splitRect(rect, node.direction, node.ratio, gap);
		dividers.push({
			nodeId: node.id,
			direction: node.direction,
			ratio: clampRatio(node.ratio),
			container: rect,
			x: node.direction === "horizontal" ? first.x + first.width : rect.x,
			y: node.direction === "horizontal" ? rect.y : first.y + first.height,
			width: node.direction === "horizontal" ? gap : rect.width,
			height: node.direction === "horizontal" ? rect.height : gap
		});
		walk(node.first, first);
		walk(node.second, second);
	};

	walk(document.root, { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height });
	return { slots, dividers };
}

export interface FitTransform {
	scale: number;
	offsetX: number;
	offsetY: number;
	/** 縮放後畫布實際佔用的寬高，其餘區域由版面背景色填滿。 */
	width: number;
	height: number;
}

/**
 * 設計畫布對應到實體顯示器的縮放。
 *
 * 第一版一律使用 `contain`：整份畫布等比縮放並置中，長寬比不同時剩下的區域
 * 填入版面背景色。刻意不做拉伸——變形的看板比黑邊難看得多，而且客戶不會知道
 * 是自己選錯解析度還是系統壞了。
 */
export function computeFitTransform(canvas: { width: number; height: number }, viewport: { width: number; height: number }): FitTransform {
	if (canvas.width <= 0 || canvas.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
		return { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
	}
	const scale = Math.min(viewport.width / canvas.width, viewport.height / canvas.height);
	const width = canvas.width * scale;
	const height = canvas.height * scale;
	return {
		scale,
		offsetX: (viewport.width - width) / 2,
		offsetY: (viewport.height - height) / 2,
		width,
		height
	};
}

/** 拖曳分隔線時，把游標在設計畫布中的位置換算回比例。 */
export function ratioFromPointer(divider: DividerRect, pointerX: number, pointerY: number, gap: number): number {
	const { container, direction } = divider;
	if (direction === "horizontal") {
		const available = Math.max(1, container.width - gap);
		return clampRatio((pointerX - container.x) / available);
	}
	const available = Math.max(1, container.height - gap);
	return clampRatio((pointerY - container.y) / available);
}
