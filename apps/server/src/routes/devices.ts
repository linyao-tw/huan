import { recordAudit } from "@/lib/audit";
import { clientIp, requireSession, sessionOf } from "@/lib/auth";
import { bumpDeviceDesiredState } from "@/lib/desired-state";
import { loadDeviceWithLayout, serializeDevice } from "@/lib/devices";
import { conflict, notFound } from "@/lib/errors";
import { toCount } from "@/lib/pagination";
import { deviceCredentials, devicePairingCodes, devices, layouts, mediaDeviceSync } from "@huan/db";
import {
	ConfirmPairingRequestSchema,
	DeviceSchema,
	IdSchema,
	OkSchema,
	PaginationQuerySchema,
	PairingCodeSchema,
	PairingLookupResponseSchema,
	UpdateDeviceRequestSchema,
	paginatedSchema
} from "@huan/protocol";
import { generateOpaqueToken, hashToken } from "@huan/shared/node";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const DeviceListResponseSchema = paginatedSchema(DeviceSchema);

export const deviceAdminRoutes: FastifyPluginAsyncZod = async app => {
	const ctx = app.ctx;
	const { db, hub } = ctx;

	async function loadOrThrow(deviceId: string) {
		const found = await loadDeviceWithLayout(db, deviceId);
		if (!found) throw notFound("找不到這個裝置");
		return found;
	}

	app.get(
		"/devices",
		{ preHandler: requireSession, schema: { tags: ["devices"], summary: "列出裝置", querystring: PaginationQuerySchema, response: { 200: DeviceListResponseSchema } } },
		async request => {
			const { limit, offset } = request.query;
			const rows = await db
				.select({ device: devices, layoutName: layouts.name })
				.from(devices)
				.leftJoin(layouts, eq(layouts.id, devices.defaultLayoutId))
				.orderBy(desc(devices.createdAt))
				.limit(limit)
				.offset(offset);
			const [total] = await db.select({ value: count() }).from(devices);
			return {
				items: rows.map(row => serializeDevice(ctx, row.device, row.layoutName ?? null)),
				total: toCount(total?.value),
				limit,
				offset
			};
		}
	);

	app.get("/devices/:id", { preHandler: requireSession, schema: { tags: ["devices"], summary: "取得裝置", params: z.object({ id: IdSchema }), response: { 200: DeviceSchema } } }, async request => {
		const { device, layoutName } = await loadOrThrow(request.params.id);
		return serializeDevice(ctx, device, layoutName);
	});

	app.patch(
		"/devices/:id",
		{
			preHandler: requireSession,
			schema: { tags: ["devices"], summary: "更新裝置", params: z.object({ id: IdSchema }), body: UpdateDeviceRequestSchema, response: { 200: DeviceSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id);
			const { name, defaultLayoutId } = request.body;

			if (defaultLayoutId) {
				const [layout] = await db.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, defaultLayoutId)).limit(1);
				if (!layout) throw notFound("找不到指定的版面");
			}

			await db
				.update(devices)
				.set({
					...(name === undefined ? {} : { name }),
					...(defaultLayoutId === undefined ? {} : { defaultLayoutId }),
					updatedAt: new Date()
				})
				.where(eq(devices.id, device.id));

			if (defaultLayoutId !== undefined) await bumpDeviceDesiredState(ctx, device.id);

			await recordAudit(db, {
				action: "device.updated",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "device",
				targetId: device.id,
				targetLabel: name ?? device.name,
				ipAddress: clientIp(request),
				metadata: { defaultLayoutId: defaultLayoutId ?? device.defaultLayoutId }
			});

			const refreshed = await loadOrThrow(device.id);
			return serializeDevice(ctx, refreshed.device, refreshed.layoutName);
		}
	);

	app.delete("/devices/:id", { preHandler: requireSession, schema: { tags: ["devices"], summary: "解除裝置綁定", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } }, async request => {
		const actor = sessionOf(request);
		const { device } = await loadOrThrow(request.params.id);
		const now = new Date();

		await db
			.update(deviceCredentials)
			.set({ revokedAt: now })
			.where(and(eq(deviceCredentials.deviceId, device.id), isNull(deviceCredentials.revokedAt)));
		await db.update(devices).set({ status: "revoked", updatedAt: now }).where(eq(devices.id, device.id));
		/** 同步紀錄留著只會讓 Worker 的回收判斷永遠等一台不會再回報的裝置。 */
		await db.delete(mediaDeviceSync).where(eq(mediaDeviceSync.deviceId, device.id));

		hub.sendCommand(device.id, "unbind");
		hub.broadcastAdmin({ type: "device_changed", deviceId: device.id });

		await recordAudit(db, {
			action: "device.unbound",
			actorUserId: actor.user.id,
			actorLabel: actor.user.username,
			targetType: "device",
			targetId: device.id,
			targetLabel: device.name,
			ipAddress: clientIp(request),
			metadata: { initiatedBy: "admin" }
		});
		return { ok: true as const };
	});

	app.post(
		"/devices/:id/force-sync",
		{ preHandler: requireSession, schema: { tags: ["devices"], summary: "強制重新同步", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id);

			/** 強制同步的重點就是「即使 Server 認為沒變也要推」，所以帶 force。 */
			await bumpDeviceDesiredState(ctx, device.id, { force: true });

			await recordAudit(db, {
				action: "device.force_sync",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "device",
				targetId: device.id,
				targetLabel: device.name,
				ipAddress: clientIp(request)
			});
			return { ok: true as const };
		}
	);

	app.post(
		"/devices/:id/restart-player",
		{ preHandler: requireSession, schema: { tags: ["devices"], summary: "重新啟動播放器", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id);
			const { commandId, delivered } = hub.sendCommand(device.id, "restart_player");

			await recordAudit(db, {
				action: "device.restart_player",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "device",
				targetId: device.id,
				targetLabel: device.name,
				ipAddress: clientIp(request),
				metadata: { commandId, delivered }
			});
			return { ok: true as const };
		}
	);

	app.get(
		"/pairing/:code",
		{ preHandler: requireSession, schema: { tags: ["pairing"], summary: "以配對碼查詢待綁定的裝置", params: z.object({ code: PairingCodeSchema }), response: { 200: PairingLookupResponseSchema } } },
		async request => {
			const [row] = await db
				.select()
				.from(devicePairingCodes)
				.where(and(eq(devicePairingCodes.code, request.params.code), isNull(devicePairingCodes.claimedAt), gt(devicePairingCodes.expiresAt, new Date())))
				.limit(1);
			if (!row) throw notFound("配對碼不存在或已失效");

			return {
				code: row.code,
				deviceName: row.deviceName,
				platform: row.platform,
				arch: row.arch,
				appVersion: row.appVersion,
				expiresAt: row.expiresAt.toISOString()
			};
		}
	);

	app.post(
		"/pairing/confirm",
		{ preHandler: requireSession, schema: { tags: ["pairing"], summary: "確認配對並建立裝置", body: ConfirmPairingRequestSchema, response: { 201: DeviceSchema } } },
		async (request, reply) => {
			const actor = sessionOf(request);
			const { code, deviceName, defaultLayoutId } = request.body;

			const [pairing] = await db
				.select()
				.from(devicePairingCodes)
				.where(and(eq(devicePairingCodes.code, code), isNull(devicePairingCodes.claimedAt), gt(devicePairingCodes.expiresAt, new Date())))
				.limit(1);
			if (!pairing) throw conflict("配對碼不存在或已失效", undefined, "pairing_expired");

			if (defaultLayoutId) {
				const [layout] = await db.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, defaultLayoutId)).limit(1);
				if (!layout) throw notFound("找不到指定的版面");
			}

			const now = new Date();
			const [device] = await db.insert(devices).values({ name: deviceName, status: "active", defaultLayoutId, pairedAt: now, pairedBy: actor.user.id }).returning();
			if (!device) throw new Error("建立裝置失敗");

			const secret = generateOpaqueToken(32);
			await db.insert(deviceCredentials).values({
				deviceId: device.id,
				secretHash: hashToken(secret),
				platform: pairing.platform,
				arch: pairing.arch,
				appVersion: pairing.appVersion
			});

			/**
			 * 明文憑證暫時存在配對碼那一列，等 Device 來領。
			 * 這是唯一能把憑證交到還沒有身分的裝置手上的方式；領走的當下就會被清掉，
			 * 資料庫裡不會長期留著任何一份可用的裝置憑證。
			 */
			await db
				.update(devicePairingCodes)
				.set({ claimedDeviceId: device.id, claimedCredential: `${device.id}.${secret}`, claimedAt: now })
				.where(eq(devicePairingCodes.id, pairing.id));

			await bumpDeviceDesiredState(ctx, device.id);
			hub.broadcastAdmin({ type: "device_changed", deviceId: device.id });

			await recordAudit(db, {
				action: "device.paired",
				actorUserId: actor.user.id,
				actorLabel: actor.user.username,
				targetType: "device",
				targetId: device.id,
				targetLabel: device.name,
				ipAddress: clientIp(request),
				metadata: { platform: pairing.platform, arch: pairing.arch, appVersion: pairing.appVersion }
			});

			const refreshed = await loadOrThrow(device.id);
			return reply.status(201).send(serializeDevice(ctx, refreshed.device, refreshed.layoutName));
		}
	);
};
