import { recordAudit } from "@/lib/audit";
import { clientIp, ownedBy, ownerOf, requireResourceOwner, sessionOf } from "@/lib/auth";
import { conflict, notFound, validationFailed } from "@/lib/errors";
import { computeMediaUsage, loadVariants, serializeMediaAsset, uploadObjectKey, usageIsEmpty, type MediaAssetRow, type MediaVariantRow } from "@/lib/media";
import { toCount } from "@/lib/pagination";
import { mediaAssets, mediaVariants, workerJobs } from "@huan/db";
import {
	CompleteUploadRequestSchema,
	CreateUploadRequestSchema,
	CreateUploadResponseSchema,
	IdSchema,
	MEDIA_ACCEPTED_CONTENT_TYPES,
	MediaAssetSchema,
	MediaListQuerySchema,
	MediaUsageSchema,
	OkSchema,
	UpdateMediaRequestSchema,
	paginatedSchema,
	type MediaKind,
	type WorkerJobKind
} from "@huan/protocol";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const MediaListResponseSchema = paginatedSchema(MediaAssetSchema);

/** 上傳完成後要排哪一種工作，完全由素材種類決定。 */
const JOB_KIND_BY_MEDIA_KIND: Record<MediaKind, WorkerJobKind> = {
	video: "transcode_video",
	image: "process_image",
	html: "process_html"
};

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
			const { kind, status, search, limit, offset } = request.query;
			/** 擁有者條件放在 filters 的第一個，`count()` 與搜尋共用同一個 where，不會有哪一邊漏掉。 */
			const filters: SQL[] = [eq(mediaAssets.ownerId, ownerOf(request))];
			if (kind) filters.push(eq(mediaAssets.kind, kind));
			if (status) filters.push(eq(mediaAssets.status, status));
			if (search) filters.push(ilike(mediaAssets.name, `%${search}%`));
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
			const { kind, name, filename, contentType, sizeBytes } = request.body;

			const normalizedContentType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
			if (!MEDIA_ACCEPTED_CONTENT_TYPES[kind].includes(normalizedContentType)) {
				throw validationFailed(`${kind} 不接受 ${contentType} 這種格式`, { accepted: [...MEDIA_ACCEPTED_CONTENT_TYPES[kind]] });
			}

			const assetId = randomUUID();
			const variantId = randomUUID();
			/** 物件鍵只由 UUID 與 content type 推得的副檔名組成，永遠不用使用者送來的檔名。 */
			const objectKey = uploadObjectKey(assetId, variantId, normalizedContentType);

			await db.insert(mediaAssets).values({
				id: assetId,
				kind,
				name,
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
};
