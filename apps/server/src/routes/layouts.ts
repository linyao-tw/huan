import { recordAudit } from "@/lib/audit";
import { clientIp, requireSession, sessionOf } from "@/lib/auth";
import { bumpDevices, deviceIdsAffectedByLayout } from "@/lib/desired-state";
import { conflict, notFound } from "@/lib/errors";
import { describeAssetProblems, findAssetProblems, loadLayoutDetail, nextRevisionNumber, publishedRevisionNumbers, serializeLayoutSummary, serializeRevision } from "@/lib/layouts";
import { toCount } from "@/lib/pagination";
import { devices, layoutRevisions, layouts, schedules } from "@huan/db";
import { createEmptyDocument } from "@huan/layout-engine";
import {
	CreateLayoutRequestSchema,
	IdSchema,
	LayoutDetailSchema,
	LayoutRevisionSchema,
	LayoutSummarySchema,
	OkSchema,
	PaginationQuerySchema,
	PublishLayoutRequestSchema,
	UpdateLayoutDraftRequestSchema,
	paginatedSchema
} from "@huan/protocol";
import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const LayoutListResponseSchema = paginatedSchema(LayoutSummarySchema);

export const layoutRoutes: FastifyPluginAsyncZod = async app => {
	const ctx = app.ctx;
	const { db } = ctx;

	app.get(
		"/layouts",
		{ preHandler: requireSession, schema: { tags: ["layouts"], summary: "列出版面", querystring: PaginationQuerySchema, response: { 200: LayoutListResponseSchema } } },
		async request => {
			const { limit, offset } = request.query;
			const rows = await db.select().from(layouts).orderBy(desc(layouts.updatedAt)).limit(limit).offset(offset);
			const [total] = await db.select({ value: count() }).from(layouts);
			const numbers = await publishedRevisionNumbers(
				db,
				rows.map(row => row.publishedRevisionId).filter((value): value is string => value !== null)
			);
			return {
				items: rows.map(row => serializeLayoutSummary(row, row.publishedRevisionId ? (numbers.get(row.publishedRevisionId) ?? null) : null)),
				total: toCount(total?.value),
				limit,
				offset
			};
		}
	);

	app.post(
		"/layouts",
		{ preHandler: requireSession, schema: { tags: ["layouts"], summary: "建立版面", body: CreateLayoutRequestSchema, response: { 201: LayoutDetailSchema } } },
		async (request, reply) => {
			const actor = sessionOf(request);
			const { name, description, canvas } = request.body;

			const [created] = await db
				.insert(layouts)
				.values({
					name,
					description,
					canvasWidth: canvas.width,
					canvasHeight: canvas.height,
					draft: createEmptyDocument(canvas),
					createdBy: actor.user.id
				})
				.returning();
			if (!created) throw new Error("建立版面失敗");

			await recordAudit(db, {
				action: "layout.created",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "layout",
				targetId: created.id,
				targetLabel: created.name,
				ipAddress: clientIp(request)
			});

			const detail = await loadLayoutDetail(db, created.id);
			if (!detail) throw notFound("找不到剛建立的版面");
			return reply.status(201).send(detail);
		}
	);

	app.get(
		"/layouts/:id",
		{ preHandler: requireSession, schema: { tags: ["layouts"], summary: "取得版面", params: z.object({ id: IdSchema }), response: { 200: LayoutDetailSchema } } },
		async request => {
			const detail = await loadLayoutDetail(db, request.params.id);
			if (!detail) throw notFound("找不到這個版面");
			return detail;
		}
	);

	app.patch(
		"/layouts/:id",
		{
			preHandler: requireSession,
			schema: { tags: ["layouts"], summary: "更新草稿", params: z.object({ id: IdSchema }), body: UpdateLayoutDraftRequestSchema, response: { 200: LayoutDetailSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const [existing] = await db.select().from(layouts).where(eq(layouts.id, request.params.id)).limit(1);
			if (!existing) throw notFound("找不到這個版面");

			const now = new Date();
			const { name, description, draft } = request.body;
			await db
				.update(layouts)
				.set({
					...(name === undefined ? {} : { name }),
					...(description === undefined ? {} : { description }),
					...(draft === undefined ? {} : { draft, canvasWidth: draft.canvas.width, canvasHeight: draft.canvas.height, draftUpdatedAt: now }),
					updatedAt: now
				})
				.where(eq(layouts.id, existing.id));

			await recordAudit(db, {
				action: "layout.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "layout",
				targetId: existing.id,
				targetLabel: name ?? existing.name,
				ipAddress: clientIp(request),
				metadata: { draftChanged: draft !== undefined }
			});

			const detail = await loadLayoutDetail(db, existing.id);
			if (!detail) throw notFound("找不到這個版面");
			return detail;
		}
	);

	app.post(
		"/layouts/:id/publish",
		{
			preHandler: requireSession,
			schema: { tags: ["layouts"], summary: "發布草稿為新的修訂", params: z.object({ id: IdSchema }), body: PublishLayoutRequestSchema, response: { 201: LayoutRevisionSchema } }
		},
		async (request, reply) => {
			const actor = sessionOf(request);
			const [existing] = await db.select().from(layouts).where(eq(layouts.id, request.params.id)).limit(1);
			if (!existing) throw notFound("找不到這個版面");

			const problems = await findAssetProblems(db, existing.draft);
			if (problems.length > 0) {
				throw conflict(describeAssetProblems(problems), { assets: problems });
			}

			const revisionNumber = await nextRevisionNumber(db, existing.id);
			const [revision] = await db.insert(layoutRevisions).values({ layoutId: existing.id, revisionNumber, document: existing.draft, note: request.body.note, publishedBy: actor.user.id }).returning();
			if (!revision) throw new Error("建立版面修訂失敗");

			await db.update(layouts).set({ publishedRevisionId: revision.id, updatedAt: new Date() }).where(eq(layouts.id, existing.id));

			/** 發布之後才輪到派送：把每一台會用到這個版面的裝置重算一次目標狀態。 */
			await bumpDevices(ctx, await deviceIdsAffectedByLayout(db, existing.id));

			await recordAudit(db, {
				action: "layout.published",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "layout",
				targetId: existing.id,
				targetLabel: existing.name,
				ipAddress: clientIp(request),
				metadata: { revisionNumber, revisionId: revision.id }
			});

			return reply.status(201).send(serializeRevision(revision));
		}
	);

	app.get(
		"/layouts/:id/revisions/:revisionId",
		{
			preHandler: requireSession,
			schema: { tags: ["layouts"], summary: "取得指定修訂", params: z.object({ id: IdSchema, revisionId: IdSchema }), response: { 200: LayoutRevisionSchema } }
		},
		async request => {
			const [revision] = await db
				.select()
				.from(layoutRevisions)
				.where(and(eq(layoutRevisions.id, request.params.revisionId), eq(layoutRevisions.layoutId, request.params.id)))
				.limit(1);
			if (!revision) throw notFound("找不到這個版面修訂");
			return serializeRevision(revision);
		}
	);

	app.delete("/layouts/:id", { preHandler: requireSession, schema: { tags: ["layouts"], summary: "刪除版面", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } }, async request => {
		const actor = sessionOf(request);
		const [existing] = await db.select().from(layouts).where(eq(layouts.id, request.params.id)).limit(1);
		if (!existing) throw notFound("找不到這個版面");

		const usingSchedules = await db.select({ id: schedules.id, name: schedules.name }).from(schedules).where(eq(schedules.layoutId, existing.id));
		const usingDevices = await db.select({ id: devices.id, name: devices.name }).from(devices).where(eq(devices.defaultLayoutId, existing.id));
		if (usingSchedules.length > 0 || usingDevices.length > 0) {
			throw conflict("這個版面正在被排程或裝置使用，請先移除引用再刪除", { schedules: usingSchedules, devices: usingDevices });
		}

		await db.delete(layouts).where(eq(layouts.id, existing.id));
		await recordAudit(db, {
			action: "layout.deleted",
			actorUserId: actor.user.id,
			actorLabel: actor.user.username,
			targetType: "layout",
			targetId: existing.id,
			targetLabel: existing.name,
			ipAddress: clientIp(request)
		});
		return { ok: true as const };
	});
};
