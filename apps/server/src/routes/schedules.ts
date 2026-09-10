import { recordAudit } from "@/lib/audit";
import { clientIp, loadOwned, ownedBy, ownerOf, requireResourceOwner, sessionOf } from "@/lib/auth";
import { bumpDevices, deviceIdsOfSchedule } from "@/lib/desired-state";
import { notFound, validationFailed } from "@/lib/errors";
import { toCount } from "@/lib/pagination";
import { devices, layouts, scheduleDevices, schedules, type Database } from "@huan/db";
import { CreateScheduleRequestSchema, IdSchema, OkSchema, PaginationQuerySchema, ScheduleSchema, UpdateScheduleRequestSchema, paginatedSchema, type Schedule } from "@huan/protocol";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const ScheduleListResponseSchema = paginatedSchema(ScheduleSchema);

type ScheduleRow = typeof schedules.$inferSelect;

function serializeSchedule(row: ScheduleRow, layoutName: string, deviceIds: string[]): Schedule {
	return {
		id: row.id,
		name: row.name,
		enabled: row.enabled,
		layoutId: row.layoutId,
		layoutName,
		timezone: row.timezone,
		priority: row.priority,
		startDate: row.startDate,
		endDate: row.endDate,
		daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
		startTime: row.startTime,
		endTime: row.endTime,
		deviceIds: [...deviceIds].sort(),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

async function loadSchedule(db: Database, scheduleId: string, ownerId: string): Promise<Schedule | null> {
	const [row] = await db
		.select({ schedule: schedules, layoutName: layouts.name })
		.from(schedules)
		.innerJoin(layouts, eq(layouts.id, schedules.layoutId))
		.where(ownedBy(schedules, scheduleId, ownerId))
		.limit(1);
	if (!row) return null;
	const targets = await db.select({ deviceId: scheduleDevices.deviceId }).from(scheduleDevices).where(eq(scheduleDevices.scheduleId, scheduleId));
	return serializeSchedule(
		row.schedule,
		row.layoutName,
		targets.map(target => target.deviceId)
	);
}

/**
 * 排程指到不存在的版面或裝置時直接擋下來：外鍵錯誤的訊息對使用者毫無意義。
 *
 * 檢查的是「是不是自己的」而不只是「存不存在」：只檢查存在，使用者就能把自己的
 * 排程推到別人的螢幕上，而且完全不需要任何 IDOR，光用列表給的 id 就做得到。
 * 別人的版面與裝置在這裡的回應跟不存在一模一樣，id 才不會變成可以列舉的。
 */
async function assertReferencesOwned(db: Database, ownerId: string, layoutId: string, deviceIds: readonly string[]): Promise<void> {
	const [layout] = await db
		.select({ id: layouts.id })
		.from(layouts)
		.where(ownedBy(layouts, layoutId, ownerId))
		.limit(1);
	if (!layout) throw validationFailed("找不到指定的版面");

	if (deviceIds.length === 0) return;
	const found = await db
		.select({ id: devices.id })
		.from(devices)
		.where(and(inArray(devices.id, [...deviceIds]), eq(devices.ownerId, ownerId)));
	const missing = deviceIds.filter(deviceId => !found.some(row => row.id === deviceId));
	if (missing.length > 0) throw validationFailed("找不到指定的裝置", { deviceIds: missing });
}

export const scheduleRoutes: FastifyPluginAsyncZod = async app => {
	const ctx = app.ctx;
	const { db } = ctx;

	app.get(
		"/schedules",
		{ preHandler: requireResourceOwner, schema: { tags: ["schedules"], summary: "列出排程", querystring: PaginationQuerySchema, response: { 200: ScheduleListResponseSchema } } },
		async request => {
			const ownerId = ownerOf(request);
			const { limit, offset } = request.query;
			const rows = await db
				.select({ schedule: schedules, layoutName: layouts.name })
				.from(schedules)
				.innerJoin(layouts, eq(layouts.id, schedules.layoutId))
				.where(eq(schedules.ownerId, ownerId))
				.orderBy(desc(schedules.priority), desc(schedules.updatedAt))
				.limit(limit)
				.offset(offset);
			const [total] = await db.select({ value: count() }).from(schedules).where(eq(schedules.ownerId, ownerId));

			const scheduleIds = rows.map(row => row.schedule.id);
			const targets = scheduleIds.length > 0 ? await db.select().from(scheduleDevices).where(inArray(scheduleDevices.scheduleId, scheduleIds)) : [];
			const deviceIdsBySchedule = new Map<string, string[]>();
			for (const target of targets) {
				const list = deviceIdsBySchedule.get(target.scheduleId);
				if (list) list.push(target.deviceId);
				else deviceIdsBySchedule.set(target.scheduleId, [target.deviceId]);
			}

			return {
				items: rows.map(row => serializeSchedule(row.schedule, row.layoutName, deviceIdsBySchedule.get(row.schedule.id) ?? [])),
				total: toCount(total?.value),
				limit,
				offset
			};
		}
	);

	app.post(
		"/schedules",
		{ preHandler: requireResourceOwner, schema: { tags: ["schedules"], summary: "建立排程", body: CreateScheduleRequestSchema, response: { 201: ScheduleSchema } } },
		async (request, reply) => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const body = request.body;
			await assertReferencesOwned(db, ownerId, body.layoutId, body.deviceIds);

			const [created] = await db
				.insert(schedules)
				.values({
					name: body.name,
					enabled: body.enabled,
					layoutId: body.layoutId,
					timezone: body.timezone,
					priority: body.priority,
					startDate: body.startDate,
					endDate: body.endDate,
					daysOfWeek: body.daysOfWeek,
					startTime: body.startTime,
					endTime: body.endTime,
					ownerId,
					createdBy: actor.user.id
				})
				.returning();
			if (!created) throw new Error("建立排程失敗");

			if (body.deviceIds.length > 0) {
				await db.insert(scheduleDevices).values(body.deviceIds.map(deviceId => ({ scheduleId: created.id, deviceId, ownerId })));
			}
			await bumpDevices(ctx, body.deviceIds);

			await recordAudit(db, {
				action: "schedule.created",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "schedule",
				targetId: created.id,
				targetLabel: created.name,
				ipAddress: clientIp(request),
				metadata: { layoutId: created.layoutId, deviceCount: body.deviceIds.length }
			});

			const schedule = await loadSchedule(db, created.id, ownerId);
			if (!schedule) throw notFound("找不到剛建立的排程");
			return reply.status(201).send(schedule);
		}
	);

	app.patch(
		"/schedules/:id",
		{
			preHandler: requireResourceOwner,
			schema: { tags: ["schedules"], summary: "更新排程", params: z.object({ id: IdSchema }), body: UpdateScheduleRequestSchema, response: { 200: ScheduleSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const body = request.body;
			const existing = await loadOwned(db, schedules, request.params.id, ownerId, "找不到這個排程");
			await assertReferencesOwned(db, ownerId, body.layoutId, body.deviceIds);

			/** 被移出目標清單的裝置也要重算，否則它會一直播已經不該播的版面。 */
			const previousDeviceIds = await deviceIdsOfSchedule(db, existing.id);

			await db
				.update(schedules)
				.set({
					name: body.name,
					enabled: body.enabled,
					layoutId: body.layoutId,
					timezone: body.timezone,
					priority: body.priority,
					startDate: body.startDate,
					endDate: body.endDate,
					daysOfWeek: body.daysOfWeek,
					startTime: body.startTime,
					endTime: body.endTime,
					updatedAt: new Date()
				})
				.where(eq(schedules.id, existing.id));

			await db.delete(scheduleDevices).where(eq(scheduleDevices.scheduleId, existing.id));
			if (body.deviceIds.length > 0) {
				await db.insert(scheduleDevices).values(body.deviceIds.map(deviceId => ({ scheduleId: existing.id, deviceId, ownerId })));
			}
			await bumpDevices(ctx, [...previousDeviceIds, ...body.deviceIds]);

			await recordAudit(db, {
				action: "schedule.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "schedule",
				targetId: existing.id,
				targetLabel: body.name,
				ipAddress: clientIp(request),
				metadata: { layoutId: body.layoutId, deviceCount: body.deviceIds.length, enabled: body.enabled }
			});

			const schedule = await loadSchedule(db, existing.id, ownerId);
			if (!schedule) throw notFound("找不到這個排程");
			return schedule;
		}
	);

	app.delete(
		"/schedules/:id",
		{ preHandler: requireResourceOwner, schema: { tags: ["schedules"], summary: "刪除排程", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const existing = await loadOwned(db, schedules, request.params.id, actor.user.id, "找不到這個排程");

			const affected = await deviceIdsOfSchedule(db, existing.id);
			await db.delete(schedules).where(eq(schedules.id, existing.id));
			await bumpDevices(ctx, affected);

			await recordAudit(db, {
				action: "schedule.deleted",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "schedule",
				targetId: existing.id,
				targetLabel: existing.name,
				ipAddress: clientIp(request)
			});
			return { ok: true as const };
		}
	);
};
