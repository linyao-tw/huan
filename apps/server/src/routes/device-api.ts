import type { AppContext } from "@/context";
import { recordAudit } from "@/lib/audit";
import { clientIp, deviceOf, requireDevice } from "@/lib/auth";
import { bumpDeviceDesiredState } from "@/lib/desired-state";
import { ApiProblem, conflict, forbidden, notFound, unauthorized } from "@/lib/errors";
import { routeRateLimit, type RateLimitTuning } from "@/plugins/rate-limit";
import { deviceCredentials, devicePairingCodes, devices, mediaAssets, mediaDeviceSync, mediaVariants } from "@huan/db";
import {
	AssetAckRequestSchema,
	DesiredStateSchema,
	DesiredStateVersionSchema,
	DeviceDownloadUrlResponseSchema,
	HeartbeatRequestSchema,
	HeartbeatResponseSchema,
	IdSchema,
	OkSchema,
	PairingStatusResponseSchema,
	StartPairingRequestSchema,
	StartPairingResponseSchema,
	type DesiredState
} from "@huan/protocol";
import { generateOpaqueToken, generatePairingCode, hashToken } from "@huan/shared/node";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export interface DeviceApiRouteOptions {
	rateLimits: RateLimitTuning;
}

/** 配對碼十分鐘內有效。夠現場的人走到後台輸入，又短到抄在便條紙上也沒有價值。 */
const PAIRING_TTL_SECONDS = 600;
const PAIRING_TOKEN_HEADER = "x-huan-pairing-token";

async function loadDesiredState(ctx: AppContext, deviceId: string): Promise<DesiredState> {
	const [row] = await ctx.db.select({ desiredState: devices.desiredState }).from(devices).where(eq(devices.id, deviceId)).limit(1);
	if (row?.desiredState) return row.desiredState;

	/** 還沒算過就現算一次，之後就走快取的那一份。 */
	await bumpDeviceDesiredState(ctx, deviceId);
	const [refreshed] = await ctx.db.select({ desiredState: devices.desiredState }).from(devices).where(eq(devices.id, deviceId)).limit(1);
	if (!refreshed?.desiredState) throw notFound("找不到這個裝置的目標狀態");
	return refreshed.desiredState;
}

export const deviceApiRoutes: FastifyPluginAsyncZod<DeviceApiRouteOptions> = async (app, options) => {
	const ctx = app.ctx;
	const { db, env, storage, hub } = ctx;

	app.post(
		"/device/pairing/start",
		{
			config: routeRateLimit(options.rateLimits.pairing, options.rateLimits.timeWindow),
			schema: { tags: ["device"], summary: "裝置索取配對碼", body: StartPairingRequestSchema, response: { 201: StartPairingResponseSchema } }
		},
		async (request, reply) => {
			const body = request.body;
			const pairingToken = generateOpaqueToken(32);
			const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000);

			/** 配對碼只有 8 個字元，碰撞雖然罕見但不是不可能，撞到就換一組再試。 */
			let code: string | null = null;
			for (let attempt = 0; attempt < 10 && code === null; attempt += 1) {
				const candidate = generatePairingCode();
				const [existing] = await db.select({ id: devicePairingCodes.id }).from(devicePairingCodes).where(eq(devicePairingCodes.code, candidate)).limit(1);
				if (!existing) code = candidate;
			}
			if (!code) throw new Error("無法產生不重複的配對碼");

			await db.insert(devicePairingCodes).values({
				code,
				pairingTokenHash: hashToken(pairingToken),
				deviceName: body.deviceName,
				platform: body.platform,
				arch: body.arch,
				appVersion: body.appVersion,
				protocolVersion: body.protocolVersion,
				expiresAt
			});

			return reply.status(201).send({
				code,
				pairingToken,
				expiresAt: expiresAt.toISOString(),
				pairingUrl: `${env.PUBLIC_URL}/pair?code=${code}`
			});
		}
	);

	app.get(
		"/device/pairing/status",
		{
			config: routeRateLimit(options.rateLimits.pairing, options.rateLimits.timeWindow),
			schema: { tags: ["device"], summary: "裝置輪詢配對結果", response: { 200: PairingStatusResponseSchema } }
		},
		async request => {
			const header = request.headers[PAIRING_TOKEN_HEADER];
			const token = Array.isArray(header) ? header[0] : header;
			if (!token) throw unauthorized("缺少配對 token");

			const [row] = await db
				.select()
				.from(devicePairingCodes)
				.where(eq(devicePairingCodes.pairingTokenHash, hashToken(token)))
				.limit(1);
			if (!row) throw notFound("配對紀錄不存在");

			if (row.claimedAt && row.claimedDeviceId) {
				/**
				 * 憑證只交付一次。
				 *
				 * 第二次呼叫回 410 而不是再給一次，是因為「同一組憑證被領走兩次」只有兩種
				 * 可能：裝置自己重試（它已經存好了，不需要第二份），或有人拿到了 pairing
				 * token 想補領一份。後者才是要防的，所以寧可讓前者走重新配對流程。
				 */
				if (row.deliveredAt || !row.claimedCredential) {
					throw new ApiProblem(410, "pairing_expired", "這組配對憑證已經領取過，請重新配對");
				}
				const credential = row.claimedCredential;
				await db.update(devicePairingCodes).set({ deliveredAt: new Date(), claimedCredential: null }).where(eq(devicePairingCodes.id, row.id));

				const [device] = await db.select({ name: devices.name }).from(devices).where(eq(devices.id, row.claimedDeviceId)).limit(1);
				return { status: "paired" as const, deviceId: row.claimedDeviceId, deviceName: device?.name ?? row.deviceName, credential };
			}

			if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" as const };
			return { status: "pending" as const, expiresAt: row.expiresAt.toISOString() };
		}
	);

	app.get("/device/state", { preHandler: requireDevice, schema: { tags: ["device"], summary: "取得完整目標狀態", response: { 200: DesiredStateSchema } } }, async request =>
		loadDesiredState(ctx, deviceOf(request).device.id)
	);

	app.get("/device/state/version", { preHandler: requireDevice, schema: { tags: ["device"], summary: "只取目標狀態版本", response: { 200: DesiredStateVersionSchema } } }, async request => ({
		version: deviceOf(request).device.desiredVersion
	}));

	app.post(
		"/device/heartbeat",
		{ preHandler: requireDevice, schema: { tags: ["device"], summary: "回報實際狀態", body: HeartbeatRequestSchema, response: { 200: HeartbeatResponseSchema } } },
		async request => {
			const { device } = deviceOf(request);
			const now = new Date();
			await db.update(devices).set({ reportedState: request.body.reported, lastSeenAt: now, updatedAt: now }).where(eq(devices.id, device.id));
			hub.broadcastAdmin(device.ownerId, { type: "device_changed", deviceId: device.id });
			return { desiredVersion: device.desiredVersion, serverTime: now.toISOString() };
		}
	);

	app.get(
		"/device/assets/:variantId/url",
		{
			preHandler: requireDevice,
			schema: { tags: ["device"], summary: "換取素材的簽章下載網址", params: z.object({ variantId: IdSchema }), response: { 200: DeviceDownloadUrlResponseSchema } }
		},
		async request => {
			const { device } = deviceOf(request);
			const { variantId } = request.params;

			/** 只能下載自己目標狀態裡列出的檔案，避免一台裝置拿著有效憑證掃過整個素材庫。 */
			const desired = await loadDesiredState(ctx, device.id);
			const entry = desired.assets.find(asset => asset.variantId === variantId);
			if (!entry) throw forbidden("這個檔案不在這台裝置的目標狀態中");

			const [variant] = await db.select().from(mediaVariants).where(eq(mediaVariants.id, variantId)).limit(1);
			if (!variant) throw notFound("找不到這個素材產物");
			if (!variant.available || !variant.sha256) {
				throw conflict("這份產物已經被回收，素材需要重新上傳", { assetId: variant.assetId }, "asset_unavailable");
			}

			const url = await storage.presignGet(variant.objectKey, env.SIGNED_URL_TTL_SECONDS, entry.filename);
			return {
				url,
				expiresAt: new Date(Date.now() + env.SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
				sha256: variant.sha256,
				sizeBytes: variant.sizeBytes
			};
		}
	);

	app.post("/device/assets/ack", { preHandler: requireDevice, schema: { tags: ["device"], summary: "回報檔案下載完成", body: AssetAckRequestSchema, response: { 200: OkSchema } } }, async request => {
		const { device } = deviceOf(request);
		const { assetId, variantId, sha256, sizeBytes } = request.body;

		const [variant] = await db.select().from(mediaVariants).where(eq(mediaVariants.id, variantId)).limit(1);
		if (!variant || variant.assetId !== assetId) throw notFound("找不到這個素材產物");

		/**
		 * 雜湊不符一律拒絕。
		 * ACK 的意思是「這台裝置手上有一份正確的檔案」，接受一個雜湊對不上的回報
		 * 等於讓 Server 以為派送完成，之後回收原始檔時就再也救不回來了。
		 */
		if (variant.sha256 && variant.sha256 !== sha256) {
			await db
				.update(mediaDeviceSync)
				.set({ status: "failed", error: "sha256 與伺服器紀錄不符", updatedAt: new Date() })
				.where(and(eq(mediaDeviceSync.deviceId, device.id), eq(mediaDeviceSync.variantId, variantId)));
			throw conflict("檔案雜湊與伺服器紀錄不符，請重新下載", { variantId }, "checksum_mismatch");
		}

		const now = new Date();
		const updated = await db
			.update(mediaDeviceSync)
			.set({ status: "ready", sha256, sizeBytes, error: null, downloadedAt: now, updatedAt: now })
			.where(and(eq(mediaDeviceSync.deviceId, device.id), eq(mediaDeviceSync.variantId, variantId)))
			.returning({ deviceId: mediaDeviceSync.deviceId });
		if (updated.length === 0) throw forbidden("這個檔案不在這台裝置的目標狀態中");

		/**
		 * 所有需要這份 playback 產物的裝置都回報完成時，保留期才開始計時。
		 * 真正的刪除交給 Worker 的回收工作，Server 只負責記下「從什麼時候開始算」。
		 */
		if (variant.role === "playback" && !variant.distributionSettledAt) {
			const outstanding = await db
				.select({ deviceId: mediaDeviceSync.deviceId })
				.from(mediaDeviceSync)
				.where(and(eq(mediaDeviceSync.variantId, variantId), ne(mediaDeviceSync.status, "ready")))
				.limit(1);
			if (outstanding.length === 0) {
				await db.update(mediaVariants).set({ distributionSettledAt: now }).where(eq(mediaVariants.id, variantId));
			}
		}

		/**
		 * 事件送給素材的擁有者，而不是裝置的擁有者。
		 * 兩者在正常情況下是同一個人（派送本身就只會送同一個擁有者的素材），
		 * 但「誰的素材變了」這件事的答案只能由素材自己回答。
		 */
		const [owner] = await db.select({ ownerId: mediaAssets.ownerId }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
		if (owner) hub.broadcastAdmin(owner.ownerId, { type: "media_changed", assetId });
		return { ok: true as const };
	});

	app.post("/device/unbind", { preHandler: requireDevice, schema: { tags: ["device"], summary: "裝置主動解除綁定", response: { 200: OkSchema } } }, async request => {
		const { device, credentialId } = deviceOf(request);
		const now = new Date();

		await db.update(deviceCredentials).set({ revokedAt: now }).where(eq(deviceCredentials.id, credentialId));
		await db.update(devices).set({ status: "revoked", updatedAt: now }).where(eq(devices.id, device.id));
		await db.delete(mediaDeviceSync).where(eq(mediaDeviceSync.deviceId, device.id));

		hub.broadcastAdmin(device.ownerId, { type: "device_changed", deviceId: device.id });
		await recordAudit(db, {
			action: "device.unbound",
			actorDeviceId: device.id,
			actorLabel: device.name,
			targetType: "device",
			targetId: device.id,
			targetLabel: device.name,
			ipAddress: clientIp(request),
			metadata: { initiatedBy: "device" }
		});
		return { ok: true as const };
	});
};
