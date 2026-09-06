import { recordAudit } from "@/lib/audit";
import { clientIp, requireRole, sessionOf } from "@/lib/auth";
import { conflict, notFound } from "@/lib/errors";
import { toCount } from "@/lib/pagination";
import { hashPassword } from "@/lib/password";
import { revokeAllUserSessions } from "@/lib/session";
import { findUserById, isTotpEnabled, serializeUser, totpEnabledMap } from "@/lib/users";
import { users } from "@huan/db";
import { CreateUserRequestSchema, IdSchema, OkSchema, PaginationQuerySchema, ResetUserPasswordRequestSchema, UpdateUserRequestSchema, UserSchema, paginatedSchema } from "@huan/protocol";
import { count, desc, eq, or } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const UserListResponseSchema = paginatedSchema(UserSchema);

export const userRoutes: FastifyPluginAsyncZod = async app => {
	const { db } = app.ctx;
	const guard = requireRole("super_admin");

	app.get("/users", { preHandler: guard, schema: { tags: ["users"], summary: "列出使用者", querystring: PaginationQuerySchema, response: { 200: UserListResponseSchema } } }, async request => {
		const { limit, offset } = request.query;
		const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
		const [total] = await db.select({ value: count() }).from(users);
		const totpMap = await totpEnabledMap(
			db,
			rows.map(row => row.id)
		);
		return {
			items: rows.map(row => serializeUser(row, totpMap.get(row.id) ?? false)),
			total: toCount(total?.value),
			limit,
			offset
		};
	});

	app.post("/users", { preHandler: guard, schema: { tags: ["users"], summary: "建立使用者", body: CreateUserRequestSchema, response: { 201: UserSchema } } }, async (request, reply) => {
		const actor = sessionOf(request);
		const { email, username, displayName, password, role } = request.body;

		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(or(eq(users.email, email), eq(users.username, username)))
			.limit(1);
		if (existing) throw conflict("這個 Email 或帳號已經被使用");

		const [created] = await db
			.insert(users)
			.values({ email, username, displayName, role, passwordHash: await hashPassword(password) })
			.returning();
		if (!created) throw new Error("建立使用者失敗");

		await recordAudit(db, {
			action: "user.created",
			actorUserId: actor.user.id,
			actorLabel: actor.user.username,
			targetType: "user",
			targetId: created.id,
			targetLabel: created.username,
			ipAddress: clientIp(request),
			metadata: { role: created.role }
		});

		return reply.status(201).send(serializeUser(created, false));
	});

	app.patch(
		"/users/:id",
		{
			preHandler: guard,
			schema: { tags: ["users"], summary: "更新使用者", params: z.object({ id: IdSchema }), body: UpdateUserRequestSchema, response: { 200: UserSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const target = await findUserById(db, request.params.id);
			if (!target) throw notFound("找不到這個使用者");

			/** 停用或降級自己會讓管理權限直接消失，而且沒有人能救回來。 */
			if (target.id === actor.user.id && (request.body.status === "disabled" || request.body.role === "user")) {
				throw conflict("不能停用或降低自己的權限");
			}

			const [updated] = await db
				.update(users)
				.set({
					...(request.body.displayName === undefined ? {} : { displayName: request.body.displayName }),
					...(request.body.role === undefined ? {} : { role: request.body.role }),
					...(request.body.status === undefined ? {} : { status: request.body.status }),
					updatedAt: new Date()
				})
				.where(eq(users.id, target.id))
				.returning();
			if (!updated) throw notFound("找不到這個使用者");

			/** 帳號被停用後留著的 session 仍然能呼叫 API，所以要一併作廢。 */
			if (updated.status === "disabled") await revokeAllUserSessions(db, updated.id);

			await recordAudit(db, {
				action: updated.status === "disabled" ? "user.disabled" : "user.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "user",
				targetId: updated.id,
				targetLabel: updated.username,
				ipAddress: clientIp(request),
				metadata: { role: updated.role, status: updated.status }
			});

			return serializeUser(updated, await isTotpEnabled(db, updated.id));
		}
	);

	app.post(
		"/users/:id/password",
		{
			preHandler: guard,
			schema: { tags: ["users"], summary: "重設使用者密碼", params: z.object({ id: IdSchema }), body: ResetUserPasswordRequestSchema, response: { 200: OkSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const target = await findUserById(db, request.params.id);
			if (!target) throw notFound("找不到這個使用者");

			await db
				.update(users)
				.set({ passwordHash: await hashPassword(request.body.password), updatedAt: new Date() })
				.where(eq(users.id, target.id));
			await revokeAllUserSessions(db, target.id);

			await recordAudit(db, {
				action: "user.password_reset",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "user",
				targetId: target.id,
				targetLabel: target.username,
				ipAddress: clientIp(request)
			});
			return { ok: true as const };
		}
	);
};
