import { canCreateFolderUnder, folderChain, folderDepth, isDescendantOf, subtreeHeight, toFolderTree, validateFolderMove, type FolderNode } from "@/lib/media-folders";
import { MEDIA_FOLDER_MAX_DEPTH } from "@huan/protocol";
import { describe, expect, it } from "vitest";

function node(id: string, parentId: string | null): FolderNode {
	return { id, name: id, parentId };
}

/** 三層：a → b → c，另外一棵獨立的 x。 */
const tree = toFolderTree([node("a", null), node("b", "a"), node("c", "b"), node("x", null)]);

describe("folderChain", () => {
	it("由最上層往下列出完整路徑", () => {
		expect(folderChain(tree, "c").map(entry => entry.id)).toEqual(["a", "b", "c"]);
	});

	it("最上層的路徑是空的", () => {
		expect(folderChain(tree, null)).toEqual([]);
	});

	it("遇到迴圈就停下來，不會無限繞", () => {
		const looped = toFolderTree([node("p", "q"), node("q", "p")]);
		expect(folderChain(looped, "p").length).toBeLessThanOrEqual(2);
	});
});

describe("folderDepth 與 subtreeHeight", () => {
	it("深度從最上層的 0 開始算", () => {
		expect(folderDepth(tree, null)).toBe(0);
		expect(folderDepth(tree, "a")).toBe(1);
		expect(folderDepth(tree, "c")).toBe(3);
	});

	it("子樹高度不含自己", () => {
		expect(subtreeHeight(tree, "a")).toBe(2);
		expect(subtreeHeight(tree, "c")).toBe(0);
	});
});

describe("validateFolderMove", () => {
	it("搬到自己的子資料夾底下是迴圈", () => {
		expect(validateFolderMove(tree, "a", "c")).toBe("cycle");
	});

	it("搬到自己底下也是迴圈", () => {
		expect(validateFolderMove(tree, "a", "a")).toBe("cycle");
	});

	it("目標不存在時明確回報，不當成最上層", () => {
		expect(validateFolderMove(tree, "c", "nope")).toBe("not_found");
	});

	it("搬到另一棵樹是可以的", () => {
		expect(validateFolderMove(tree, "c", "x")).toBeNull();
	});

	it("搬到最上層永遠可以", () => {
		expect(validateFolderMove(tree, "c", null)).toBeNull();
	});

	it("整棵子樹都要算進深度，超過上限就擋下來", () => {
		const nodes: FolderNode[] = [];
		for (let level = 0; level < MEDIA_FOLDER_MAX_DEPTH; level += 1) {
			nodes.push(node(`level-${level}`, level === 0 ? null : `level-${level - 1}`));
		}
		nodes.push(node("moving", null), node("moving-child", "moving"));
		const deep = toFolderTree(nodes);
		// 最深的那一層底下已經沒有空間再塞兩層。
		expect(validateFolderMove(deep, "moving", `level-${MEDIA_FOLDER_MAX_DEPTH - 1}`)).toBe("too_deep");
		expect(validateFolderMove(deep, "moving", "level-0")).toBeNull();
	});
});

describe("isDescendantOf", () => {
	it("自己不算自己的後代", () => {
		expect(isDescendantOf(tree, "a", "a")).toBe(false);
	});

	it("孫層也算後代", () => {
		expect(isDescendantOf(tree, "c", "a")).toBe(true);
	});
});

describe("canCreateFolderUnder", () => {
	it("最深的一層底下不能再建", () => {
		const nodes: FolderNode[] = [];
		for (let level = 0; level < MEDIA_FOLDER_MAX_DEPTH; level += 1) {
			nodes.push(node(`level-${level}`, level === 0 ? null : `level-${level - 1}`));
		}
		const deep = toFolderTree(nodes);
		expect(canCreateFolderUnder(deep, `level-${MEDIA_FOLDER_MAX_DEPTH - 1}`)).toBe(false);
		expect(canCreateFolderUnder(deep, `level-${MEDIA_FOLDER_MAX_DEPTH - 2}`)).toBe(true);
	});
});
