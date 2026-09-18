import type { MediaFolder } from "@huan/protocol";

/**
 * 從最上層到這個資料夾的路徑，麵包屑直接照著印。
 *
 * 保護迴圈是刻意的：伺服器擋得住，但這份清單也可能來自舊的快取，
 * 讓畫面在資料還沒追上時轉不出來，遠比少印一層難查。
 */
export function folderPath(folders: readonly MediaFolder[], folderId: string | null): MediaFolder[] {
	const byId = new Map(folders.map(folder => [folder.id, folder]));
	const path: MediaFolder[] = [];
	const seen = new Set<string>();
	let current = folderId;
	while (current !== null) {
		if (seen.has(current)) break;
		seen.add(current);
		const folder = byId.get(current);
		if (!folder) break;
		path.unshift(folder);
		current = folder.parentId;
	}
	return path;
}

export function childFolders(folders: readonly MediaFolder[], parentId: string | null): MediaFolder[] {
	return folders.filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

/** 這個資料夾底下的所有子孫。全選與「不能搬進自己底下」都靠它。 */
export function descendantFolderIds(folders: readonly MediaFolder[], folderId: string): string[] {
	const out: string[] = [];
	const walk = (parentId: string): void => {
		for (const folder of folders) {
			if (folder.parentId !== parentId) continue;
			out.push(folder.id);
			walk(folder.id);
		}
	};
	walk(folderId);
	return out;
}

export interface FolderOption {
	id: string | null;
	label: string;
	depth: number;
}

/**
 * 攤平成可以直接畫成選單的清單，縮排用 `depth` 表示。
 *
 * 第一筆永遠是最上層，因為「搬到最上層」和「搬到某個資料夾」是同一種操作，
 * 拆成兩個控制項只會讓人以為它們不一樣。
 */
export function folderOptions(folders: readonly MediaFolder[], rootLabel = "素材庫"): FolderOption[] {
	const options: FolderOption[] = [{ id: null, label: rootLabel, depth: 0 }];
	const walk = (parentId: string | null, depth: number): void => {
		for (const folder of childFolders(folders, parentId)) {
			options.push({ id: folder.id, label: folder.name, depth });
			walk(folder.id, depth + 1);
		}
	};
	walk(null, 1);
	return options;
}

/** 資料夾卡片上的一行摘要。沒有子資料夾就不提：卡片很窄，少一段字就少折一行。 */
export function folderSummary(folder: Pick<MediaFolder, "assetCount" | "childCount">): string {
	return folder.childCount > 0 ? `${folder.assetCount} 個素材・${folder.childCount} 個資料夾` : `${folder.assetCount} 個素材`;
}
