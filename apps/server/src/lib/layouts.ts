import { layoutRevisions, layouts, mediaAssets, type Database } from "@huan/db";
import { collectAssetIds } from "@huan/layout-engine";
import type { LayoutDetail, LayoutDocument, LayoutRevision, LayoutSummary } from "@huan/protocol";
import { asc, desc, eq, inArray } from "drizzle-orm";

export type LayoutRow = typeof layouts.$inferSelect;
export type LayoutRevisionRow = typeof layoutRevisions.$inferSelect;

export function serializeRevision(row: LayoutRevisionRow): LayoutRevision {
	return {
		id: row.id,
		layoutId: row.layoutId,
		revisionNumber: row.revisionNumber,
		document: row.document,
		note: row.note,
		publishedBy: row.publishedBy,
		publishedAt: row.publishedAt.toISOString()
	};
}

export function serializeLayoutSummary(row: LayoutRow, publishedRevisionNumber: number | null): LayoutSummary {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		canvas: { width: row.canvasWidth, height: row.canvasHeight },
		publishedRevisionId: row.publishedRevisionId,
		publishedRevisionNumber,
		draftUpdatedAt: row.draftUpdatedAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

export async function loadLayoutDetail(db: Database, layoutId: string): Promise<LayoutDetail | null> {
	const [row] = await db.select().from(layouts).where(eq(layouts.id, layoutId)).limit(1);
	if (!row) return null;

	const revisions = await db.select().from(layoutRevisions).where(eq(layoutRevisions.layoutId, layoutId)).orderBy(desc(layoutRevisions.revisionNumber));
	const published = revisions.find(revision => revision.id === row.publishedRevisionId);

	return {
		...serializeLayoutSummary(row, published?.revisionNumber ?? null),
		draft: row.draft,
		revisions: revisions.map(revision => {
			const { document: _document, ...rest } = serializeRevision(revision);
			return rest;
		})
	};
}

export async function publishedRevisionNumbers(db: Database, revisionIds: readonly string[]): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	if (revisionIds.length === 0) return map;
	const rows = await db
		.select({ id: layoutRevisions.id, revisionNumber: layoutRevisions.revisionNumber })
		.from(layoutRevisions)
		.where(inArray(layoutRevisions.id, [...revisionIds]));
	for (const row of rows) map.set(row.id, row.revisionNumber);
	return map;
}

export async function nextRevisionNumber(db: Database, layoutId: string): Promise<number> {
	const [row] = await db
		.select({ revisionNumber: layoutRevisions.revisionNumber })
		.from(layoutRevisions)
		.where(eq(layoutRevisions.layoutId, layoutId))
		.orderBy(desc(layoutRevisions.revisionNumber))
		.limit(1);
	return (row?.revisionNumber ?? 0) + 1;
}

export interface AssetReadinessProblem {
	assetId: string;
	name: string | null;
	reason: "missing" | "not_ready";
	status: string | null;
}

/**
 * 發布前檢查版面引用的每個素材是不是真的可以播。
 *
 * 允許發布一個指向「還在轉檔」或「已刪除」素材的版面，等於允許把黑畫面
 * 推到現場的螢幕上；問題要在使用者還看得到編輯器的時候就講清楚。
 */
export async function findAssetProblems(db: Database, document: LayoutDocument): Promise<AssetReadinessProblem[]> {
	const assetIds = collectAssetIds(document);
	if (assetIds.length === 0) return [];

	const rows = await db.select({ id: mediaAssets.id, name: mediaAssets.name, status: mediaAssets.status }).from(mediaAssets).where(inArray(mediaAssets.id, assetIds)).orderBy(asc(mediaAssets.name));
	const byId = new Map(rows.map(row => [row.id, row]));

	const problems: AssetReadinessProblem[] = [];
	for (const assetId of assetIds) {
		const row = byId.get(assetId);
		if (!row) {
			problems.push({ assetId, name: null, reason: "missing", status: null });
			continue;
		}
		if (row.status !== "ready") problems.push({ assetId, name: row.name, reason: "not_ready", status: row.status });
	}
	return problems;
}

export function describeAssetProblems(problems: readonly AssetReadinessProblem[]): string {
	const parts = problems.map(problem => (problem.reason === "missing" ? `${problem.assetId}（素材已不存在）` : `${problem.name ?? problem.assetId}（狀態為 ${problem.status}）`));
	return `以下素材尚未就緒，無法發布：${parts.join("、")}`;
}
