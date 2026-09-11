import { LayoutDocumentSchema, type Canvas, type LayoutDocument, type LayoutNode, type SlotContent, type SlotNode, type SplitDirection, type SplitNode } from "@huan/protocol";
import { clampRatio } from "./geometry.js";

let nodeCounter = 0;

/**
 * 節點識別字只需要在同一份版面裡唯一。
 *
 * 用時間戳加計數器而不是 UUID，是因為這個值會出現在編輯器的 DOM id 與拖放
 * payload 裡，短一點比較好讀，也不需要在瀏覽器端多帶一個相依套件。
 */
export function createNodeId(prefix = "n"): string {
	nodeCounter += 1;
	return `${prefix}${Date.now().toString(36)}${nodeCounter.toString(36)}`;
}

export function createSlot(content: SlotContent | null = null): SlotNode {
	return { type: "slot", id: createNodeId("s"), content };
}

export const DEFAULT_CANVAS: Canvas = { width: 1920, height: 1080 };

export function createEmptyDocument(canvas: Canvas = DEFAULT_CANVAS): LayoutDocument {
	return LayoutDocumentSchema.parse({
		canvas,
		background: { color: "#000000", imageAssetId: null, imageFit: "cover" },
		gap: 0,
		root: createSlot()
	});
}

export function findNode(root: LayoutNode, nodeId: string): LayoutNode | null {
	if (root.id === nodeId) return root;
	if (root.type === "slot") return null;
	return findNode(root.first, nodeId) ?? findNode(root.second, nodeId);
}

export function collectSlots(root: LayoutNode): SlotNode[] {
	if (root.type === "slot") return [root];
	return [...collectSlots(root.first), ...collectSlots(root.second)];
}

export function countSlots(root: LayoutNode): number {
	return collectSlots(root).length;
}

/** 版面實際引用到的素材。派送與刪除前的相依性檢查都以這份清單為準。 */
export function collectAssetIds(document: LayoutDocument): string[] {
	const ids = new Set<string>();
	if (document.background.imageAssetId) ids.add(document.background.imageAssetId);
	for (const slot of collectSlots(document.root)) {
		const content = slot.content;
		if (!content) continue;
		if (content.type === "image" || content.type === "video" || content.type === "html") ids.add(content.assetId);
		if (content.type === "playlist") for (const item of content.items) ids.add(item.assetId);
	}
	return [...ids];
}

/** 純函式的樹狀改寫：回傳新的樹，不改動輸入，讓 React 的狀態比較維持可靠。 */
function mapNode(root: LayoutNode, nodeId: string, replace: (node: LayoutNode) => LayoutNode): LayoutNode {
	if (root.id === nodeId) return replace(root);
	if (root.type === "slot") return root;
	const first = mapNode(root.first, nodeId, replace);
	const second = mapNode(root.second, nodeId, replace);
	if (first === root.first && second === root.second) return root;
	return { ...root, first, second };
}

export function splitNode(document: LayoutDocument, nodeId: string, direction: SplitDirection, ratio = 0.5): LayoutDocument {
	const root = mapNode(document.root, nodeId, node => {
		const split: SplitNode = {
			type: "split",
			id: createNodeId("d"),
			direction,
			ratio: clampRatio(ratio),
			first: node,
			second: createSlot()
		};
		return split;
	});
	return { ...document, root };
}

export function setSplitRatio(document: LayoutDocument, nodeId: string, ratio: number): LayoutDocument {
	const root = mapNode(document.root, nodeId, node => (node.type === "split" ? { ...node, ratio: clampRatio(ratio) } : node));
	return { ...document, root };
}

export function setSplitDirection(document: LayoutDocument, nodeId: string, direction: SplitDirection): LayoutDocument {
	const root = mapNode(document.root, nodeId, node => (node.type === "split" ? { ...node, direction } : node));
	return { ...document, root };
}

export function setSlotContent(document: LayoutDocument, nodeId: string, content: SlotContent | null): LayoutDocument {
	const root = mapNode(document.root, nodeId, node => (node.type === "slot" ? { ...node, content } : node));
	return { ...document, root };
}

/**
 * 移除一個分割：保留指定的子節點，另一半連同其內容一起消失。
 *
 * 這是刪除區塊的唯一途徑。直接刪掉插槽會留下只有一個孩子的分割節點，
 * 那種樹沒有幾何意義，也無法序列化回 schema。
 */
export function removeSplit(document: LayoutDocument, splitId: string, keep: "first" | "second"): LayoutDocument {
	const root = mapNode(document.root, splitId, node => (node.type === "split" ? node[keep] : node));
	return { ...document, root };
}

/** 找出某個節點的父分割節點，讓「刪除這個區塊」可以換算成「移除父分割」。 */
export function findParentSplit(root: LayoutNode, nodeId: string): { parent: SplitNode; side: "first" | "second" } | null {
	if (root.type === "slot") return null;
	if (root.first.id === nodeId) return { parent: root, side: "first" };
	if (root.second.id === nodeId) return { parent: root, side: "second" };
	return findParentSplit(root.first, nodeId) ?? findParentSplit(root.second, nodeId);
}

/** 把某個插槽連同它所在的分割一起移除，父分割的另一半會頂上來。 */
export function removeSlot(document: LayoutDocument, slotId: string): LayoutDocument {
	const parent = findParentSplit(document.root, slotId);
	if (!parent) {
		// 根節點就是這個插槽：版面至少要有一個區塊，因此只清空內容。
		return setSlotContent(document, slotId, null);
	}
	return removeSplit(document, parent.parent.id, parent.side === "first" ? "second" : "first");
}

/** 交換兩個插槽的內容。拖放時的預設行為是搬移，不是複製。 */
export function swapSlotContent(document: LayoutDocument, sourceSlotId: string, targetSlotId: string): LayoutDocument {
	if (sourceSlotId === targetSlotId) return document;
	const source = findNode(document.root, sourceSlotId);
	const target = findNode(document.root, targetSlotId);
	if (!source || source.type !== "slot" || !target || target.type !== "slot") return document;

	const sourceContent = source.content;
	const targetContent = target.content;
	const withSource = setSlotContent(document, sourceSlotId, targetContent);
	return setSlotContent(withSource, targetSlotId, sourceContent);
}

/**
 * 版面文件的正規化序列化。
 *
 * 內容以 schema 走一遍，補齊預設值並拒絕多餘欄位，因此存進資料庫與送到 Device
 * 的內容一定是同一個形狀；比較兩份版面是否相同時也不會被欄位順序影響。
 */
export function serializeLayoutDocument(document: LayoutDocument): string {
	return JSON.stringify(LayoutDocumentSchema.parse(document));
}

export function parseLayoutDocument(raw: unknown): LayoutDocument {
	return LayoutDocumentSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
}

export function layoutDocumentsEqual(a: LayoutDocument, b: LayoutDocument): boolean {
	return serializeLayoutDocument(a) === serializeLayoutDocument(b);
}
