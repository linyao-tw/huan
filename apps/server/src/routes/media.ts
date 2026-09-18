import { recordAudit } from "@/lib/audit";
import { clientIp, loadOwned, ownedBy, ownerOf, requireResourceOwner, sessionOf } from "@/lib/auth";
import { conflict, notFound, validationFailed } from "@/lib/errors";
import { computeMediaUsage, loadVariants, serializeMediaAsset, uploadObjectKey, usageIsEmpty, type MediaAssetRow, type MediaVariantRow } from "@/lib/media";
import { canCreateFolderUnder, folderIsEmpty, folderNameTaken, loadFolderCounts, loadFolderTree, validateFolderMove, type MediaFolderRow } from "@/lib/media-folders";
import { toCount } from "@/lib/pagination";
import { mediaAssets, mediaFolders, mediaVariants, workerJobs } from "@huan/db";
import {
	CompleteUploadRequestSchema,
	CreateMediaFolderRequestSchema,
	CreateUploadRequestSchema,
	CreateUploadResponseSchema,
	IdSchema,
	MEDIA_ACCEPTED_CONTENT_TYPES,
	MEDIA_FOLDER_MAX_DEPTH,
	MEDIA_MAX_UPLOAD_BYTES,
	MEDIA_ROOT_FOLDER,
	MediaAssetSchema,
	MediaFolderSchema,
	MediaListQuerySchema,
	MediaUsageSchema,
	MoveMediaRequestSchema,
	OkSchema,
	UpdateMediaFolderRequestSchema,
	UpdateMediaRequestSchema,
	paginatedSchema,
	type MediaFolder,
	type MediaKind,
	type WorkerJobKind
} from "@huan/protocol";
import { and, count, desc, eq, ilike, inArray, isNull, type SQL } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const MediaListResponseSchema = paginatedSchema(MediaAssetSchema);
const MediaFolderListResponseSchema = z.object({ items: z.array(MediaFolderSchema) });

/** 上傳完成後要排哪一種工作，完全由素材種類決定。 */
const JOB_KIND_BY_MEDIA_KIND: Record<MediaKind, WorkerJobKind> = {
	video: "transcode_video",
	image: "process_image",
	html: "process_html"
};

/** 把 LIKE 的特殊字元轉義成字面值，配合預設的 `\` escape 字元。 */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, char => `\\${char}`);
}

export const mediaRoutes: FastifyPluginAsyncZod = async app => {
	const { db, env, storage, hub } = app.ctx;

	async function serialize(asset: MediaAssetRow, variants: readonly MediaVariantRow[]) {
		return serializeMediaAsset(asset, variants, storage, env.SIGNED_URL_TTL_SECONDS);
	}

	/** 產物沒有自己的擁有者，它的歸屬完全跟著素材，所以只要素材這一關查對了就夠。 */
	async function loadAsset(id: string, ownerId: string): Promise<{ asset: MediaAssetRow; variants: MediaVariantRow[] }> {
		const [asset] = await db
			.select()
			.from(mediaAssets)
			.where(ownedBy(mediaAssets, id, ownerId))
			.limit(1);
		if (!asset) throw notFound("找不到這個素材");
		const variants = await db.select().from(mediaVariants).where(eq(mediaVariants.assetId, id));
		return { asset, variants };
	}

	app.get(
		"/media",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "列出素材", querystring: MediaListQuerySchema, response: { 200: MediaListResponseSchema } } },
		async request => {
			const { kind, status, search, folderId, limit, offset } = request.query;
			/** 擁有者條件放在 filters 的第一個，`count()` 與搜尋共用同一個 where，不會有哪一邊漏掉。 */
			const filters: SQL[] = [eq(mediaAssets.ownerId, ownerOf(request))];
			if (kind) filters.push(eq(mediaAssets.kind, kind));
			if (status) filters.push(eq(mediaAssets.status, status));
			/** 省略 `folderId` 是「整個素材庫」，那是搜尋要的行為；瀏覽資料夾時一定會帶值。 */
			if (folderId === MEDIA_ROOT_FOLDER) filters.push(isNull(mediaAssets.folderId));
			else if (folderId) filters.push(eq(mediaAssets.folderId, folderId));
			/** 跳脫 LIKE 的 % _ \，否則使用者可用萬用字元擴大掃描範圍（LIKE 層級的效能濫用）。 */
			if (search) filters.push(ilike(mediaAssets.name, `%${escapeLike(search)}%`));
			const where = and(...filters);

			const rows = await db.select().from(mediaAssets).where(where).orderBy(desc(mediaAssets.createdAt)).limit(limit).offset(offset);
			const [total] = await db.select({ value: count() }).from(mediaAssets).where(where);
			const variantMap = await loadVariants(
				db,
				rows.map(row => row.id)
			);

			return {
				items: await Promise.all(rows.map(row => serialize(row, variantMap.get(row.id) ?? []))),
				total: toCount(total?.value),
				limit,
				offset
			};
		}
	);

	app.get(
		"/media/:id",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "取得素材", params: z.object({ id: IdSchema }), response: { 200: MediaAssetSchema } } },
		async request => {
			const { asset, variants } = await loadAsset(request.params.id, ownerOf(request));
			return serialize(asset, variants);
		}
	);

	app.get(
		"/media/:id/usage",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "查詢素材被誰引用", params: z.object({ id: IdSchema }), response: { 200: MediaUsageSchema } } },
		async request => {
			const ownerId = ownerOf(request);
			await loadAsset(request.params.id, ownerId);
			return computeMediaUsage(db, request.params.id, ownerId);
		}
	);

	app.post(
		"/media/uploads",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "取得直傳授權", body: CreateUploadRequestSchema, response: { 201: CreateUploadResponseSchema } } },
		async (request, reply) => {
			const actor = sessionOf(request);
			const { kind, name, filename, contentType, sizeBytes, folderId } = request.body;

			const normalizedContentType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
			if (!MEDIA_ACCEPTED_CONTENT_TYPES[kind].includes(normalizedContentType)) {
				throw validationFailed(`${kind} 不接受 ${contentType} 這種格式`, { accepted: [...MEDIA_ACCEPTED_CONTENT_TYPES[kind]] });
			}

			/** 複合外鍵擋得住跨租戶，但錯誤會是資料庫層的；先查一次才能回「找不到這個資料夾」。 */
			if (folderId) await loadOwned(db, mediaFolders, folderId, actor.user.id, "找不到這個資料夾");

			const assetId = randomUUID();
			const variantId = randomUUID();
			/** 物件鍵只由 UUID 與 content type 推得的副檔名組成，永遠不用使用者送來的檔名。 */
			const objectKey = uploadObjectKey(assetId, variantId, normalizedContentType);

			await db.insert(mediaAssets).values({
				id: assetId,
				kind,
				name,
				folderId,
				originalFilename: filename,
				contentType: normalizedContentType,
				sizeBytes,
				status: "uploading",
				ownerId: actor.user.id,
				createdBy: actor.user.id
			});
			await db.insert(mediaVariants).values({
				id: variantId,
				assetId,
				role: "original",
				objectKey,
				contentType: normalizedContentType,
				sizeBytes: 0
			});

			const uploadUrl = await storage.presignPut(objectKey, normalizedContentType, env.SIGNED_URL_TTL_SECONDS);
			return reply.status(201).send({
				assetId,
				uploadUrl,
				headers: { "Content-Type": normalizedContentType },
				expiresAt: new Date(Date.now() + env.SIGNED_URL_TTL_SECONDS * 1000).toISOString()
			});
		}
	);

	app.post(
		"/media/uploads/complete",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "回報直傳完成", body: CompleteUploadRequestSchema, response: { 200: MediaAssetSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { asset, variants } = await loadAsset(request.body.assetId, actor.user.id);
			if (asset.status !== "uploading") throw conflict("這個素材已經完成上傳");

			const original = variants.find(variant => variant.role === "original");
			if (!original) throw conflict("這個素材沒有原始檔紀錄，請重新建立上傳");

			/**
			 * 一定要親自確認物件存在。
			 * 只信任前端說「我傳好了」，會讓素材庫出現一堆指向空氣的資料列，
			 * 而問題要等到 Worker 或 Device 取檔失敗時才會浮現。
			 */
			const head = await storage.head(original.objectKey);
			if (!head) throw conflict("找不到已上傳的檔案，請重新上傳", { assetId: asset.id }, "upload_missing");

			/**
			 * 直傳用的是預簽 PUT，簽章裡沒有綁大小，所以真正上傳的檔案可能比建立時宣告的
			 * 還大。這裡以物件的實際大小為準再擋一次，避免有人繞過宣告值塞超大檔進轉檔佇列。
			 */
			if (head.sizeBytes > MEDIA_MAX_UPLOAD_BYTES) {
				await storage.remove([original.objectKey]).catch(() => {});
				await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
				throw validationFailed(`檔案超過上限 ${MEDIA_MAX_UPLOAD_BYTES} bytes`);
			}

			const now = new Date();
			await db.update(mediaVariants).set({ sizeBytes: head.sizeBytes }).where(eq(mediaVariants.id, original.id));
			const [updated] = await db.update(mediaAssets).set({ status: "uploaded", sizeBytes: head.sizeBytes, errorMessage: null, updatedAt: now }).where(eq(mediaAssets.id, asset.id)).returning();
			if (!updated) throw notFound("找不到這個素材");

			await db.insert(workerJobs).values({
				kind: JOB_KIND_BY_MEDIA_KIND[asset.kind],
				assetId: asset.id,
				payload: { assetId: asset.id },
				maxAttempts: 3
			});

			await recordAudit(db, {
				action: "media.uploaded",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "media_asset",
				targetId: asset.id,
				targetLabel: asset.name,
				ipAddress: clientIp(request),
				metadata: { kind: asset.kind, sizeBytes: head.sizeBytes }
			});
			hub.broadcastAdmin(asset.ownerId, { type: "media_changed", assetId: asset.id });

			const refreshed = await db.select().from(mediaVariants).where(eq(mediaVariants.assetId, asset.id));
			return serialize(updated, refreshed);
		}
	);

	app.patch(
		"/media/:id",
		{
			preHandler: requireResourceOwner,
			schema: { tags: ["media"], summary: "重新命名素材", params: z.object({ id: IdSchema }), body: UpdateMediaRequestSchema, response: { 200: MediaAssetSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const { asset, variants } = await loadAsset(request.params.id, actor.user.id);
			const [updated] = await db.update(mediaAssets).set({ name: request.body.name, updatedAt: new Date() }).where(eq(mediaAssets.id, asset.id)).returning();
			if (!updated) throw notFound("找不到這個素材");

			await recordAudit(db, {
				action: "media.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "media_asset",
				targetId: updated.id,
				targetLabel: updated.name,
				ipAddress: clientIp(request)
			});
			hub.broadcastAdmin(updated.ownerId, { type: "media_changed", assetId: updated.id });
			return serialize(updated, variants);
		}
	);

	app.delete("/media/:id", { preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "刪除素材", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } }, async request => {
		const actor = sessionOf(request);
		const { asset, variants } = await loadAsset(request.params.id, actor.user.id);

		/**
		 * 先算引用再刪。
		 * 刪掉一個還在播的素材，現場的螢幕會直接開天窗，而且沒有任何一步能還原；
		 * 因此寧可擋下來並告訴使用者是哪個版面、排程或裝置正在用。
		 */
		const usage = await computeMediaUsage(db, asset.id, asset.ownerId);
		if (!usageIsEmpty(usage)) {
			throw conflict("這個素材正在被使用，請先移除引用再刪除", { ...usage }, "asset_in_use");
		}

		await storage.remove(variants.map(variant => variant.objectKey));
		await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));

		await recordAudit(db, {
			action: "media.deleted",
			actorUserId: actor.user.id,
			actorLabel: actor.user.username,
			targetType: "media_asset",
			targetId: asset.id,
			targetLabel: asset.name,
			ipAddress: clientIp(request),
			metadata: { kind: asset.kind, variants: variants.length }
		});
		hub.broadcastAdmin(asset.ownerId, { type: "media_changed", assetId: asset.id });
		return { ok: true as const };
	});
	/* ── 資料夾 ───────────────────────────────────────────────────────── */

	function serializeFolder(row: MediaFolderRow, counts: { assets: number; children: number } | undefined): MediaFolder {
		return {
			id: row.id,
			name: row.name,
			parentId: row.parentId,
			assetCount: counts?.assets ?? 0,
			childCount: counts?.children ?? 0,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString()
		};
	}

	/**
	 * 一次回整棵樹，不分頁也不只回某一層。
	 *
	 * 資料夾是人手建出來的，數量跟版面同一個等級；讓前端一次拿到全部，麵包屑、
	 * 搬移對話框與側邊樹就都讀同一份資料，不會出現三個地方各自看到不同的樹。
	 */
	app.get("/media/folders", { preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "列出素材資料夾", response: { 200: MediaFolderListResponseSchema } } }, async request => {
		const ownerId = ownerOf(request);
		const [rows, counts] = await Promise.all([db.select().from(mediaFolders).where(eq(mediaFolders.ownerId, ownerId)).orderBy(mediaFolders.name), loadFolderCounts(db, ownerId)]);
		return { items: rows.map(row => serializeFolder(row, counts.get(row.id))) };
	});

	app.post(
		"/media/folders",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "建立素材資料夾", body: CreateMediaFolderRequestSchema, response: { 201: MediaFolderSchema } } },
		async (request, reply) => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const { name, parentId } = request.body;

			if (parentId) await loadOwned(db, mediaFolders, parentId, ownerId, "找不到上層資料夾");

			const tree = await loadFolderTree(db, ownerId);
			if (!canCreateFolderUnder(tree, parentId)) throw conflict(`資料夾最多 ${MEDIA_FOLDER_MAX_DEPTH} 層`, { maxDepth: MEDIA_FOLDER_MAX_DEPTH }, "folder_too_deep");
			if (await folderNameTaken(db, ownerId, parentId, name)) throw conflict("同一層裡已經有同名的資料夾", { name }, "folder_name_taken");

			const [created] = await db.insert(mediaFolders).values({ name, parentId, ownerId, createdBy: ownerId }).returning();
			if (!created) throw new Error("建立資料夾失敗");

			await recordAudit(db, {
				action: "media_folder.created",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "media_folder",
				targetId: created.id,
				targetLabel: created.name,
				ipAddress: clientIp(request),
				metadata: { parentId }
			});
			hub.broadcastAdmin(ownerId, { type: "media_changed", assetId: null });
			return reply.status(201).send(serializeFolder(created, undefined));
		}
	);

	app.patch(
		"/media/folders/:id",
		{
			preHandler: requireResourceOwner,
			schema: { tags: ["media"], summary: "重新命名或搬移資料夾", params: z.object({ id: IdSchema }), body: UpdateMediaFolderRequestSchema, response: { 200: MediaFolderSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const folder = await loadOwned(db, mediaFolders, request.params.id, ownerId, "找不到這個資料夾");
			const { name, parentId } = request.body;

			if (parentId !== undefined) {
				const tree = await loadFolderTree(db, ownerId);
				const rejection = validateFolderMove(tree, folder.id, parentId);
				if (rejection === "not_found") throw notFound("找不到目標資料夾");
				if (rejection === "cycle") throw conflict("不能把資料夾搬進它自己底下", undefined, "folder_cycle");
				if (rejection === "too_deep") throw conflict(`資料夾最多 ${MEDIA_FOLDER_MAX_DEPTH} 層`, { maxDepth: MEDIA_FOLDER_MAX_DEPTH }, "folder_too_deep");
			}

			const nextParentId = parentId === undefined ? folder.parentId : parentId;
			const nextName = name ?? folder.name;
			if (await folderNameTaken(db, ownerId, nextParentId, nextName, folder.id)) throw conflict("同一層裡已經有同名的資料夾", { name: nextName }, "folder_name_taken");

			const [updated] = await db.update(mediaFolders).set({ name: nextName, parentId: nextParentId, updatedAt: new Date() }).where(eq(mediaFolders.id, folder.id)).returning();
			if (!updated) throw notFound("找不到這個資料夾");

			await recordAudit(db, {
				action: "media_folder.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "media_folder",
				targetId: updated.id,
				targetLabel: updated.name,
				ipAddress: clientIp(request),
				metadata: { parentId: nextParentId }
			});
			hub.broadcastAdmin(ownerId, { type: "media_changed", assetId: null });

			const counts = await loadFolderCounts(db, ownerId);
			return serializeFolder(updated, counts.get(updated.id));
		}
	);

	app.delete(
		"/media/folders/:id",
		{ preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "刪除素材資料夾", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const folder = await loadOwned(db, mediaFolders, request.params.id, ownerId, "找不到這個資料夾");

			/**
			 * 只刪空資料夾。
			 *
			 * 連同內容一起刪太容易把整批素材帶走，而素材刪除本身還有「正在被使用」這一關；
			 * 要求先清空，使用者就一定會經過那一關，不會有東西靜靜消失。
			 */
			if (!(await folderIsEmpty(db, folder.id, ownerId))) {
				throw conflict("資料夾裡還有東西，請先搬走或刪除", { folderId: folder.id }, "folder_not_empty");
			}

			await db.delete(mediaFolders).where(eq(mediaFolders.id, folder.id));

			await recordAudit(db, {
				action: "media_folder.deleted",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "media_folder",
				targetId: folder.id,
				targetLabel: folder.name,
				ipAddress: clientIp(request)
			});
			hub.broadcastAdmin(ownerId, { type: "media_changed", assetId: null });
			return { ok: true as const };
		}
	);

	app.post("/media/move", { preHandler: requireResourceOwner, schema: { tags: ["media"], summary: "把素材搬到資料夾", body: MoveMediaRequestSchema, response: { 200: OkSchema } } }, async request => {
		const actor = sessionOf(request);
		const ownerId = actor.user.id;
		const { assetIds, folderId } = request.body;

		if (folderId) await loadOwned(db, mediaFolders, folderId, ownerId, "找不到這個資料夾");

		/** 先確認每一筆都是自己的：少一筆就整批不動，不要出現搬一半的結果。 */
		const owned = await db
			.select({ id: mediaAssets.id })
			.from(mediaAssets)
			.where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.ownerId, ownerId)));
		if (owned.length !== new Set(assetIds).size) throw notFound("有素材不存在或不屬於你");

		await db
			.update(mediaAssets)
			.set({ folderId, updatedAt: new Date() })
			.where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.ownerId, ownerId)));

		await recordAudit(db, {
			action: "media.moved",
			actorUserId: actor.user.id,
			actorLabel: actor.user.username,
			targetType: "media_folder",
			targetId: folderId,
			targetLabel: null,
			ipAddress: clientIp(request),
			metadata: { assetIds, count: owned.length }
		});
		hub.broadcastAdmin(ownerId, { type: "media_changed", assetId: null });
		return { ok: true as const };
	});
};
