import { mediaAssets, mediaFolders, type Database } from "@huan/db";
import { MEDIA_FOLDER_MAX_DEPTH } from "@huan/protocol";
import { and, count, eq, isNull } from "drizzle-orm";

export type MediaFolderRow = typeof mediaFolders.$inferSelect;

/** 樹狀運算只需要這三個欄位，測試因此不必湊出一整列資料庫紀錄。 */
export interface FolderNode {
	id: string;
	name: string;
	parentId: string | null;
}

export type FolderTree = ReadonlyMap<string, FolderNode>;

export function toFolderTree(rows: readonly FolderNode[]): Map<string, FolderNode> {
	return new Map(rows.map(row => [row.id, row]));
}

/**
 * 從最上層到這個資料夾的完整路徑。
 *
 * 迴圈保護不是形式上的：資料庫的外鍵擋得住跨租戶，但擋不住 A→B→A，
 * 而這個函式會被搬移驗證呼叫，剛好是最可能出現迴圈的那一刻。
 */
export function folderChain(tree: FolderTree, folderId: string | null): FolderNode[] {
	const chain: FolderNode[] = [];
	const seen = new Set<string>();
	let current = folderId;
	while (current !== null) {
		if (seen.has(current)) break;
		seen.add(current);
		const node = tree.get(current);
		if (!node) break;
		chain.unshift(node);
		current = node.parentId;
	}
	return chain;
}

/** 最上層是 0。`folderChain` 的長度就是深度，分開一個名字是因為呼叫端讀起來差很多。 */
export function folderDepth(tree: FolderTree, folderId: string | null): number {
	return folderChain(tree, folderId).length;
}

export function childrenOf(tree: FolderTree, folderId: string | null): FolderNode[] {
	return [...tree.values()].filter(node => node.parentId === folderId);
}

/** 某個資料夾底下（不含自己）最深還有幾層。搬移時要用它確認搬過去不會超過深度上限。 */
export function subtreeHeight(tree: FolderTree, folderId: string): number {
	const children = childrenOf(tree, folderId);
	if (children.length === 0) return 0;
	return 1 + Math.max(...children.map(child => subtreeHeight(tree, child.id)));
}

export function isDescendantOf(tree: FolderTree, candidateId: string, ancestorId: string): boolean {
	return folderChain(tree, candidateId).some(node => node.id === ancestorId && node.id !== candidateId);
}

export type FolderMoveRejection = "not_found" | "cycle" | "too_deep";

/**
 * 能不能把 `folderId` 搬到 `parentId` 底下。
 *
 * 三種拒絕理由分開回報，因為使用者要做的事完全不同：目標不存在是重新整理，
 * 迴圈是選錯了目標，太深則是整棵子樹都得先變淺。
 */
export function validateFolderMove(tree: FolderTree, folderId: string, parentId: string | null): FolderMoveRejection | null {
	if (parentId === null) return depthFits(tree, folderId, 0) ? null : "too_deep";
	if (!tree.has(parentId)) return "not_found";
	if (parentId === folderId || isDescendantOf(tree, parentId, folderId)) return "cycle";
	return depthFits(tree, folderId, folderDepth(tree, parentId)) ? null : "too_deep";
}

function depthFits(tree: FolderTree, folderId: string, parentDepth: number): boolean {
	return parentDepth + 1 + subtreeHeight(tree, folderId) <= MEDIA_FOLDER_MAX_DEPTH;
}

/** 新資料夾只有自己一層，所以條件比搬移單純：父層深度加上自己不能超過上限。 */
export function canCreateFolderUnder(tree: FolderTree, parentId: string | null): boolean {
	return folderDepth(tree, parentId) + 1 <= MEDIA_FOLDER_MAX_DEPTH;
}

export async function loadFolderTree(db: Database, ownerId: string): Promise<Map<string, FolderNode>> {
	const rows = await db.select({ id: mediaFolders.id, name: mediaFolders.name, parentId: mediaFolders.parentId }).from(mediaFolders).where(eq(mediaFolders.ownerId, ownerId));
	return toFolderTree(rows);
}

export interface FolderCounts {
	assets: number;
	children: number;
}

/**
 * 每個資料夾直接持有的素材數與子資料夾數。
 *
 * 兩個 group by 就夠了，不遞迴累加：列表上要回答的是「點進去會看到什麼」，
 * 遞迴總數反而會讓使用者以為刪不掉的是別的地方。
 */
export async function loadFolderCounts(db: Database, ownerId: string): Promise<Map<string, FolderCounts>> {
	const [assetRows, childRows] = await Promise.all([
		db.select({ folderId: mediaAssets.folderId, value: count() }).from(mediaAssets).where(eq(mediaAssets.ownerId, ownerId)).groupBy(mediaAssets.folderId),
		db.select({ parentId: mediaFolders.parentId, value: count() }).from(mediaFolders).where(eq(mediaFolders.ownerId, ownerId)).groupBy(mediaFolders.parentId)
	]);

	const counts = new Map<string, FolderCounts>();
	const bump = (key: string | null, patch: Partial<FolderCounts>): void => {
		if (key === null) return;
		const current = counts.get(key) ?? { assets: 0, children: 0 };
		counts.set(key, { ...current, ...patch });
	};
	for (const row of assetRows) bump(row.folderId, { assets: Number(row.value) });
	for (const row of childRows) bump(row.parentId, { children: Number(row.value) });
	return counts;
}

/** 資料夾是不是空的。刪除前問這一句，答案「否」就直接擋下來，不追問是哪一種內容。 */
export async function folderIsEmpty(db: Database, folderId: string, ownerId: string): Promise<boolean> {
	const [assets] = await db
		.select({ value: count() })
		.from(mediaAssets)
		.where(and(eq(mediaAssets.folderId, folderId), eq(mediaAssets.ownerId, ownerId)));
	if (Number(assets?.value ?? 0) > 0) return false;
	const [children] = await db
		.select({ value: count() })
		.from(mediaFolders)
		.where(and(eq(mediaFolders.parentId, folderId), eq(mediaFolders.ownerId, ownerId)));
	return Number(children?.value ?? 0) === 0;
}

/** 同一層裡名稱是否已經被用掉。資料庫沒有這條約束——`null` 的父層在唯一索引裡彼此不相等。 */
export async function folderNameTaken(db: Database, ownerId: string, parentId: string | null, name: string, exceptId?: string): Promise<boolean> {
	const rows = await db
		.select({ id: mediaFolders.id })
		.from(mediaFolders)
		.where(and(eq(mediaFolders.ownerId, ownerId), parentId === null ? isNull(mediaFolders.parentId) : eq(mediaFolders.parentId, parentId), eq(mediaFolders.name, name)));
	return rows.some(row => row.id !== exceptId);
}
