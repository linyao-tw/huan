import { ownedBy } from "@/lib/auth";
import { layoutRevisions, layouts, mediaAssets, type Database } from "@huan/db";
import { collectAssetIds } from "@huan/layout-engine";
import { LayoutDocumentSchema, type LayoutDetail, type LayoutDocument, type LayoutRevision, type LayoutSummary } from "@huan/protocol";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

export type LayoutRow = typeof layouts.$inferSelect;
export type LayoutRevisionRow = typeof layoutRevisions.$inferSelect;

/**
 * 從資料庫讀出來的版面文件，先用 schema 解析一次再往外送。
 *
 * JSONB 存的是寫入當下的格式，協定演進之後舊資料會缺欄位（例如輪播改成共用的
 * `imageDurationMs`）。回應序列化走的是 zod 的 encode 方向，**不會補預設值**，
 * 缺一個欄位就是整個請求 500；在讀出的邊界 parse 一次，舊資料才會被補成現在的形狀。
 */
export function storedLayoutDocument(value: LayoutDocument): LayoutDocument {
	return LayoutDocumentSchema.parse(value);
}

export function serializeRevision(row: LayoutRevisionRow): LayoutRevision {
	return {
		id: row.id,
		layoutId: row.layoutId,
		revisionNumber: row.revisionNumber,
		document: storedLayoutDocument(row.document),
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

export async function loadLayoutDetail(db: Database, layoutId: string, ownerId: string): Promise<LayoutDetail | null> {
	const [row] = await db
		.select()
		.from(layouts)
		.where(ownedBy(layouts, layoutId, ownerId))
		.limit(1);
	if (!row) return null;

	const revisions = await db.select().from(layoutRevisions).where(eq(layoutRevisions.layoutId, layoutId)).orderBy(desc(layoutRevisions.revisionNumber));
	const published = revisions.find(revision => revision.id === row.publishedRevisionId);

	return {
		...serializeLayoutSummary(row, published?.revisionNumber ?? null),
		draft: storedLayoutDocument(row.draft),
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
 *
 * 查詢連 `ownerId` 一起帶：版面文件是 JSONB，沒有外鍵能阻止它引用別人的素材，
 * 因此別人的素材在這裡必須被當成「不存在」，發布才不會把別人的檔案派送出去。
 */
export async function findAssetProblems(db: Database, document: LayoutDocument, ownerId: string): Promise<AssetReadinessProblem[]> {
	const assetIds = collectAssetIds(document);
	if (assetIds.length === 0) return [];

	const rows = await db
		.select({ id: mediaAssets.id, name: mediaAssets.name, status: mediaAssets.status })
		.from(mediaAssets)
		.where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.ownerId, ownerId)))
		.orderBy(asc(mediaAssets.name));
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
