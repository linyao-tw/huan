import { recordAudit } from "@/lib/audit";
import { clientIp, loadOwned, ownerOf, requireResourceOwner, sessionOf } from "@/lib/auth";
import { bumpDeviceDesiredState } from "@/lib/desired-state";
import { loadDeviceWithLayout, serializeDevice } from "@/lib/devices";
import { conflict, notFound } from "@/lib/errors";
import { toCount } from "@/lib/pagination";
import { routeRateLimit, type RateLimitTuning } from "@/plugins/rate-limit";
import { deviceCredentials, devicePairingCodes, devices, layouts } from "@huan/db";
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

export interface DeviceAdminRouteOptions {
	rateLimits: RateLimitTuning;
}

export const deviceAdminRoutes: FastifyPluginAsyncZod<DeviceAdminRouteOptions> = async (app, options) => {
	const ctx = app.ctx;
	const { db, hub } = ctx;

	async function loadOrThrow(deviceId: string, ownerId: string) {
		const found = await loadDeviceWithLayout(db, deviceId, ownerId);
		if (!found) throw notFound("找不到這個裝置");
		return found;
	}

	/** 指定預設版面時，版面必須也是同一個人的。只檢查「存在」等於允許把別人的畫面釘上自己的螢幕。 */
	async function assertLayoutOwned(layoutId: string, ownerId: string): Promise<void> {
		await loadOwned(db, layouts, layoutId, ownerId, "找不到指定的版面");
	}

	app.get(
		"/devices",
		{ preHandler: requireResourceOwner, schema: { tags: ["devices"], summary: "列出裝置", querystring: PaginationQuerySchema, response: { 200: DeviceListResponseSchema } } },
		async request => {
			const ownerId = ownerOf(request);
			const { limit, offset } = request.query;
			const rows = await db
				.select({ device: devices, layoutName: layouts.name })
				.from(devices)
				.leftJoin(layouts, eq(layouts.id, devices.defaultLayoutId))
				.where(eq(devices.ownerId, ownerId))
				.orderBy(desc(devices.createdAt))
				.limit(limit)
				.offset(offset);
			const [total] = await db.select({ value: count() }).from(devices).where(eq(devices.ownerId, ownerId));
			return {
				items: rows.map(row => serializeDevice(ctx, row.device, row.layoutName ?? null)),
				total: toCount(total?.value),
				limit,
				offset
			};
		}
	);

	app.get(
		"/devices/:id",
		{ preHandler: requireResourceOwner, schema: { tags: ["devices"], summary: "取得裝置", params: z.object({ id: IdSchema }), response: { 200: DeviceSchema } } },
		async request => {
			const { device, layoutName } = await loadOrThrow(request.params.id, ownerOf(request));
			return serializeDevice(ctx, device, layoutName);
		}
	);

	app.patch(
		"/devices/:id",
		{
			preHandler: requireResourceOwner,
			schema: { tags: ["devices"], summary: "更新裝置", params: z.object({ id: IdSchema }), body: UpdateDeviceRequestSchema, response: { 200: DeviceSchema } }
		},
		async request => {
			const actor = sessionOf(request);
			const ownerId = actor.user.id;
			const { device } = await loadOrThrow(request.params.id, ownerId);
			const { name, defaultLayoutId } = request.body;

			if (defaultLayoutId) await assertLayoutOwned(defaultLayoutId, ownerId);

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

			const refreshed = await loadOrThrow(device.id, ownerId);
			return serializeDevice(ctx, refreshed.device, refreshed.layoutName);
		}
	);

	app.delete(
		"/devices/:id",
		{ preHandler: requireResourceOwner, schema: { tags: ["devices"], summary: "移除裝置", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id, actor.user.id);

			/** 先叫還連著的裝置停下來，再把它切掉——刪掉之後憑證失效，這個指令就送不出去了。 */
			hub.sendCommand(device.id, "unbind");

			/** 稽核在刪除前記，targetLabel 這時還拿得到裝置名稱。targetId 是純文字欄位，不受刪除影響。 */
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

			/**
			 * 直接刪掉整列，不留「已移除」的殘影。
			 *
			 * 憑證、同步紀錄、排程指派、配對碼都以 onDelete cascade 掛在 devices 上，一起
			 * 消失；稽核日誌的 actorDeviceId 是 set null，紀錄本身留著。因此不必手動一張張
			 * 清，一個 delete 就乾淨。
			 */
			await db.delete(devices).where(eq(devices.id, device.id));

			hub.broadcastAdmin(device.ownerId, { type: "device_changed", deviceId: device.id });
			return { ok: true as const };
		}
	);

	app.post(
		"/devices/:id/force-sync",
		{ preHandler: requireResourceOwner, schema: { tags: ["devices"], summary: "強制重新同步", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id, actor.user.id);

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
		{ preHandler: requireResourceOwner, schema: { tags: ["devices"], summary: "重新啟動播放器", params: z.object({ id: IdSchema }), response: { 200: OkSchema } } },
		async request => {
			const actor = sessionOf(request);
			const { device } = await loadOrThrow(request.params.id, actor.user.id);
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
		{
			/** 配對碼即祕密，套用和裝置端配對端點一樣緊的限流，壓低猜碼速率。 */
			config: routeRateLimit(options.rateLimits.pairing, options.rateLimits.timeWindow),
			preHandler: requireResourceOwner,
			schema: { tags: ["pairing"], summary: "以配對碼查詢待綁定的裝置", params: z.object({ code: PairingCodeSchema }), response: { 200: PairingLookupResponseSchema } }
		},
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
		{
			config: routeRateLimit(options.rateLimits.pairing, options.rateLimits.timeWindow),
			preHandler: requireResourceOwner,
			schema: { tags: ["pairing"], summary: "確認配對並建立裝置", body: ConfirmPairingRequestSchema, response: { 201: DeviceSchema } }
		},
		async (request, reply) => {
			const actor = sessionOf(request);
			/**
			 * 配對碼本身就是那個祕密，沒有另外記「這組碼給誰用」。
			 * 因此規則很單純：誰確認，裝置就歸誰；現場的人把碼唸給誰，那個人就是擁有者。
			 */
			const ownerId = actor.user.id;
			const { code, deviceName, defaultLayoutId } = request.body;

			const [pairing] = await db
				.select()
				.from(devicePairingCodes)
				.where(and(eq(devicePairingCodes.code, code), isNull(devicePairingCodes.claimedAt), gt(devicePairingCodes.expiresAt, new Date())))
				.limit(1);
			if (!pairing) throw conflict("配對碼不存在或已失效", undefined, "pairing_expired");

			if (defaultLayoutId) await assertLayoutOwned(defaultLayoutId, ownerId);

			const now = new Date();
			const [device] = await db.insert(devices).values({ name: deviceName, status: "active", defaultLayoutId, pairedAt: now, ownerId, pairedBy: actor.user.id }).returning();
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
			hub.broadcastAdmin(ownerId, { type: "device_changed", deviceId: device.id });

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

			const refreshed = await loadOrThrow(device.id, ownerId);
			return reply.status(201).send(serializeDevice(ctx, refreshed.device, refreshed.layoutName));
		}
	);
};
