import { deviceTokenFromRequest } from "@/lib/auth";
import { authenticateDeviceToken } from "@/lib/device-auth";
import type { WebSocket } from "@fastify/websocket";
import { devices } from "@huan/db";
import { DeviceToServerMessageSchema, PROTOCOL_VERSION, type ServerToDeviceMessage } from "@huan/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** 自訂的關閉碼。4000–4999 保留給應用程式，Device 端據此決定要不要重試。 */
const CLOSE_UNAUTHORIZED = 4401;

function send(socket: WebSocket, message: ServerToDeviceMessage): void {
	socket.send(JSON.stringify(message));
}

/**
 * 裝置控制通道。
 *
 * 這條通道只送通知與少數即時指令，永遠不傳素材；Device 收到 `desired_state_changed`
 * 之後仍然要回 REST 取完整狀態，REST 才是唯一的事實來源。
 */
export function registerDeviceSocket(app: FastifyInstance): void {
	const ctx = app.ctx;

	app.get("/devices/socket", { websocket: true, schema: { hide: true } }, async (socket: WebSocket, request: FastifyRequest) => {
		const token = deviceTokenFromRequest(request);
		const actor = token ? await authenticateDeviceToken(ctx.db, token) : null;
		if (!actor) {
			socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
			return;
		}

		const deviceId = actor.device.id;
		ctx.hub.attachDevice(deviceId, socket);
		ctx.hub.broadcastAdmin({ type: "device_changed", deviceId });
		send(socket, { type: "hello", serverTime: new Date().toISOString(), protocolVersion: PROTOCOL_VERSION, desiredVersion: actor.device.desiredVersion });

		socket.on("message", (raw: unknown) => {
			void handleMessage(String(raw));
		});

		socket.on("close", () => {
			ctx.hub.detachDevice(deviceId, socket);
			ctx.hub.broadcastAdmin({ type: "device_changed", deviceId });
		});

		socket.on("error", (error: Error) => {
			request.log.warn({ err: error, deviceId }, "裝置 WebSocket 發生錯誤");
		});

		/**
		 * 每一個進來的訊框都要驗證，失敗就丟掉並記錄。
		 * 對一條長連線來說，因為一個壞掉的訊框就拋例外把連線炸掉，
		 * 代價遠大於忽略它——Device 會進入重連退避，畫面反而先斷。
		 */
		async function handleMessage(payload: string): Promise<void> {
			let parsed: unknown;
			try {
				parsed = JSON.parse(payload);
			} catch {
				request.log.warn({ deviceId }, "收到無法解析的 WebSocket 訊框");
				return;
			}

			const result = DeviceToServerMessageSchema.safeParse(parsed);
			if (!result.success) {
				request.log.warn({ deviceId, issues: result.error.issues.map(issue => issue.path.join(".")) }, "收到不符合協定的 WebSocket 訊框");
				return;
			}

			const message = result.data;
			try {
				if (message.type === "ping") {
					send(socket, { type: "pong", serverTime: new Date().toISOString() });
					return;
				}

				if (message.type === "heartbeat") {
					const now = new Date();
					await ctx.db.update(devices).set({ reportedState: message.reported, lastSeenAt: now, updatedAt: now }).where(eq(devices.id, deviceId));
					ctx.hub.broadcastAdmin({ type: "device_changed", deviceId });
					return;
				}

				request.log.info({ deviceId, commandId: message.commandId, ok: message.ok, message: message.message }, "收到裝置指令結果");
			} catch (error) {
				request.log.error({ err: error, deviceId }, "處理 WebSocket 訊框失敗");
			}
		}
	});
}
