import { clampRatio, ratioFromPointer, type DividerRect } from "@huan/layout-engine";

/** 拖曳時會吸附的比例。三分之一與三分之二是實務上最常出現、又最難用滑鼠對準的值。 */
export const SNAP_RATIOS = [1 / 3, 1 / 2, 2 / 3] as const;

export interface CanvasProjection {
	/** 設計 px 對應到畫面 px 的倍率。 */
	scale: number;
	/** 縮放後畫布在檢視區內的左上角位移（畫面 px）。 */
	offsetX: number;
	offsetY: number;
	/** 檢視區本身在視窗座標系的左上角。 */
	originX: number;
	originY: number;
}

export interface DesignPoint {
	x: number;
	y: number;
}

/** 把視窗座標換算回設計畫布座標。所有拖曳計算都在設計座標系進行，縮放才不會影響結果。 */
export function clientToDesignPoint(projection: CanvasProjection, clientX: number, clientY: number): DesignPoint {
	if (projection.scale <= 0) return { x: 0, y: 0 };
	return {
		x: (clientX - projection.originX - projection.offsetX) / projection.scale,
		y: (clientY - projection.originY - projection.offsetY) / projection.scale
	};
}

/**
 * 吸附。
 *
 * 門檻是畫面上的 px，不是比例：同樣是 6 px，在 3840 寬的畫布上代表的比例遠小於 1280 的畫布，
 * 用比例當門檻會讓大畫布幾乎吸不到，小畫布又黏得動不了。
 */
export function snapRatio(ratio: number, divider: DividerRect, gap: number, scale: number, thresholdPx = 6): number {
	const available = Math.max(1, (divider.direction === "horizontal" ? divider.container.width : divider.container.height) - gap);
	const screenAvailable = available * scale;
	if (screenAvailable <= 0) return ratio;
	const threshold = thresholdPx / screenAvailable;
	for (const target of SNAP_RATIOS) {
		if (Math.abs(ratio - target) <= threshold) return target;
	}
	return ratio;
}

export interface RatioFromPointerOptions {
	divider: DividerRect;
	gap: number;
	projection: CanvasProjection;
	clientX: number;
	clientY: number;
	snap?: boolean;
	snapThresholdPx?: number;
}

/** 分隔線拖曳的唯一入口：視窗座標 → 設計座標 → 比例 → 吸附 → 夾在合法範圍內。 */
export function ratioFromClientPoint({ divider, gap, projection, clientX, clientY, snap = true, snapThresholdPx = 6 }: RatioFromPointerOptions): number {
	const point = clientToDesignPoint(projection, clientX, clientY);
	const raw = ratioFromPointer(divider, point.x, point.y, gap);
	const snapped = snap ? snapRatio(raw, divider, gap, projection.scale, snapThresholdPx) : raw;
	return clampRatio(snapped);
}

/** 方向鍵微調。按住 Shift 一次走 5%，讓鍵盤也能在合理的次數內橫跨整個範圍。 */
export function ratioFromKeyboard(current: number, key: string, shiftKey: boolean, direction: "horizontal" | "vertical"): number | null {
	const step = shiftKey ? 0.05 : 0.01;
	const decreaseKeys = direction === "horizontal" ? ["ArrowLeft"] : ["ArrowUp"];
	const increaseKeys = direction === "horizontal" ? ["ArrowRight"] : ["ArrowDown"];

	if (decreaseKeys.includes(key)) return clampRatio(current - step);
	if (increaseKeys.includes(key)) return clampRatio(current + step);
	if (key === "Home") return clampRatio(1 / 3);
	if (key === "End") return clampRatio(2 / 3);
	if (key === "Enter" || key === " ") return 0.5;
	return null;
}
