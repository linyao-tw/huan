import { describe, expect, it } from "vitest";
import { computeLayoutGeometry } from "./geometry.js";
import {
	collectAssetIds,
	collectSlots,
	createEmptyDocument,
	createNodeId,
	findParentSplit,
	layoutDocumentsEqual,
	parseLayoutDocument,
	removeSlot,
	serializeLayoutDocument,
	setSlotContent,
	setSplitRatio,
	splitNode,
	swapSlotContent
} from "./tree.js";

describe("createNodeId", () => {
	it("每次都產生不同的識別字", () => {
		const ids = new Set(Array.from({ length: 200 }, () => createNodeId()));
		expect(ids.size).toBe(200);
	});
});

describe("createEmptyDocument", () => {
	it("以單一空插槽起始", () => {
		const document = createEmptyDocument();
		expect(document.root.type).toBe("slot");
		expect(collectSlots(document.root)).toHaveLength(1);
		expect(document.canvas).toEqual({ width: 1920, height: 1080 });
	});
});

describe("splitNode", () => {
	it("把插槽換成含兩個插槽的分割節點", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.7);
		expect(document.root.type).toBe("split");
		expect(collectSlots(document.root)).toHaveLength(2);
	});

	it("保留原本插槽的內容於第一塊", () => {
		const empty = createEmptyDocument();
		const withText = setSlotContent(empty, empty.root.id, {
			type: "text",
			text: "你好",
			backgroundColor: "#00000000",
			color: "#ffffff",
			fontSize: 48,
			fontWeight: 500,
			padding: 24,
			align: "center",
			verticalAlign: "center"
		});
		const document = splitNode(withText, empty.root.id, "vertical", 0.5);
		const slots = collectSlots(document.root);
		expect(slots[0]?.content?.type).toBe("text");
		expect(slots[1]?.content).toBeNull();
	});

	it("不改動輸入的文件", () => {
		const empty = createEmptyDocument();
		const snapshot = serializeLayoutDocument(empty);
		splitNode(empty, empty.root.id, "horizontal", 0.5);
		expect(serializeLayoutDocument(empty)).toBe(snapshot);
	});
});

describe("setSplitRatio", () => {
	it("更新比例並夾在合法範圍內", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.5);
		const adjusted = setSplitRatio(document, document.root.id, 0.0001);
		expect(computeLayoutGeometry(adjusted).slots[0]?.width).toBe(1920 * 0.05);
	});
});

describe("removeSlot", () => {
	it("移除插槽後，兄弟節點頂替父分割的位置", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.7);
		const slots = collectSlots(document.root);
		const reduced = removeSlot(document, slots[1]!.id);
		expect(reduced.root.type).toBe("slot");
		expect(reduced.root.id).toBe(slots[0]!.id);
	});

	it("只剩一個插槽時改為清空內容", () => {
		const empty = createEmptyDocument();
		const withText = setSlotContent(empty, empty.root.id, {
			type: "text",
			text: "只有我",
			backgroundColor: "#00000000",
			color: "#ffffff",
			fontSize: 48,
			fontWeight: 500,
			padding: 24,
			align: "center",
			verticalAlign: "center"
		});
		const cleared = removeSlot(withText, empty.root.id);
		expect(cleared.root.type).toBe("slot");
		expect(collectSlots(cleared.root)[0]?.content).toBeNull();
	});
});

describe("findParentSplit", () => {
	it("找得到插槽的父分割與所在側", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "vertical", 0.5);
		const slots = collectSlots(document.root);
		expect(findParentSplit(document.root, slots[1]!.id)?.side).toBe("second");
	});

	it("根節點沒有父分割", () => {
		const empty = createEmptyDocument();
		expect(findParentSplit(empty.root, empty.root.id)).toBeNull();
	});
});

describe("swapSlotContent", () => {
	it("交換兩個插槽的內容而不是複製", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.5);
		const slots = collectSlots(document.root);
		const withVideo = setSlotContent(document, slots[0]!.id, {
			type: "video",
			assetId: "11111111-1111-4111-8111-111111111111",
			fit: "contain",
			loop: true,
			muted: true,
			volume: 1,
			backgroundColor: "#000000"
		});
		const swapped = swapSlotContent(withVideo, slots[0]!.id, slots[1]!.id);
		const result = collectSlots(swapped.root);
		expect(result[0]?.content).toBeNull();
		expect(result[1]?.content?.type).toBe("video");
	});

	it("拖到自己身上時不做任何事", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.5);
		const slots = collectSlots(document.root);
		expect(layoutDocumentsEqual(swapSlotContent(document, slots[0]!.id, slots[0]!.id), document)).toBe(true);
	});
});

describe("collectAssetIds", () => {
	it("收集插槽與背景引用到的素材", () => {
		const empty = createEmptyDocument();
		const document = splitNode(empty, empty.root.id, "horizontal", 0.5);
		const slots = collectSlots(document.root);
		let next = setSlotContent(document, slots[0]!.id, {
			type: "video",
			assetId: "11111111-1111-4111-8111-111111111111",
			fit: "contain",
			loop: true,
			muted: true,
			volume: 1,
			backgroundColor: "#000000"
		});
		next = setSlotContent(next, slots[1]!.id, { type: "image", assetId: "22222222-2222-4222-8222-222222222222", fit: "cover", backgroundColor: "#00000000" });
		next = { ...next, background: { ...next.background, imageAssetId: "33333333-3333-4333-8333-333333333333" } };
		expect(collectAssetIds(next).sort()).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
	});

	it("文字與網址不佔用素材", () => {
		const empty = createEmptyDocument();
		const withUrl = setSlotContent(empty, empty.root.id, { type: "url", url: "https://example.com" });
		expect(collectAssetIds(withUrl)).toEqual([]);
	});

	it("輪播裡的每一則素材都要收集到，否則發布時漏派", () => {
		const empty = createEmptyDocument();
		const withPlaylist = setSlotContent(empty, empty.root.id, {
			type: "playlist",
			items: [
				{ assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "image", durationMs: 5000 },
				{ assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "video", durationMs: 8000 }
			],
			fit: "contain",
			backgroundColor: "#000000"
		});
		expect(collectAssetIds(withPlaylist).sort()).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
	});
});

describe("序列化", () => {
	it("往返之後內容完全相同", () => {
		const empty = createEmptyDocument({ width: 1080, height: 1920 });
		const document = splitNode(empty, empty.root.id, "vertical", 0.35);
		const restored = parseLayoutDocument(serializeLayoutDocument(document));
		expect(layoutDocumentsEqual(document, restored)).toBe(true);
	});

	it("拒絕結構不合法的文件", () => {
		expect(() => parseLayoutDocument({ canvas: { width: 10, height: 10 }, background: {}, gap: 0, root: { type: "slot", id: "a", content: null } })).toThrow();
	});

	it("拒絕超出範圍的分割比例", () => {
		const empty = createEmptyDocument();
		const broken = { ...empty, root: { type: "split", id: "d1", direction: "horizontal", ratio: 0.001, first: empty.root, second: { type: "slot", id: "s2", content: null } } };
		expect(() => parseLayoutDocument(broken)).toThrow();
	});
});
