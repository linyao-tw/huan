import { childFolders, descendantFolderIds, folderOptions, folderPath, folderSummary } from "@/features/media/folders";
import type { MediaFolder } from "@huan/protocol";
import { describe, expect, it } from "vitest";

function folder(id: string, parentId: string | null, name = id): MediaFolder {
	return { id, name, parentId, assetCount: 0, childCount: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

/** 名稱刻意用英文：排序只需要驗「有照名稱排」，中文的定序規則不是這個模組的責任。 */
const folders = [folder("a", null, "Alpha"), folder("b", "a", "Bravo"), folder("c", "b", "Charlie"), folder("x", null, "Zulu")];

describe("folderPath", () => {
	it("由最上層往下列出整條路徑", () => {
		expect(folderPath(folders, "c").map(entry => entry.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
	});

	it("最上層沒有路徑", () => {
		expect(folderPath(folders, null)).toEqual([]);
	});

	it("資料夾已經不在清單裡時只印得出來的部分", () => {
		expect(folderPath(folders, "missing")).toEqual([]);
	});

	it("遇到迴圈就停下來，不會讓畫面轉不出去", () => {
		const looped = [folder("p", "q"), folder("q", "p")];
		expect(folderPath(looped, "p").length).toBeLessThanOrEqual(2);
	});
});

describe("childFolders", () => {
	it("只回傳直接子層，並照名稱排序", () => {
		expect(childFolders(folders, null).map(entry => entry.id)).toEqual(["a", "x"]);
		expect(childFolders(folders, "a").map(entry => entry.id)).toEqual(["b"]);
		expect(childFolders(folders, "c")).toEqual([]);
	});
});

describe("descendantFolderIds", () => {
	it("含孫層，不含自己", () => {
		expect(descendantFolderIds(folders, "a")).toEqual(["b", "c"]);
		expect(descendantFolderIds(folders, "c")).toEqual([]);
	});
});

describe("folderOptions", () => {
	it("第一筆是最上層，其餘依深度縮排", () => {
		expect(folderOptions(folders).map(option => [option.label, option.depth])).toEqual([
			["素材庫", 0],
			["Alpha", 1],
			["Bravo", 2],
			["Charlie", 3],
			["Zulu", 1]
		]);
	});
});

describe("folderSummary", () => {
	it("沒有子資料夾時只講素材數", () => {
		expect(folderSummary({ assetCount: 3, childCount: 0 })).toBe("3 個素材");
	});

	it("有子資料夾時一起講", () => {
		expect(folderSummary({ assetCount: 0, childCount: 2 })).toBe("0 個素材・2 個資料夾");
	});
});
