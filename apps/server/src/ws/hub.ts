import type { AdminEvent, DeviceCommandKind, ServerToDeviceMessage } from "@huan/protocol";
import { randomUUID } from "node:crypto";

/**
 * 只描述 hub 真正用到的 WebSocket 介面。
 *
 * 直接相依 `ws` 的型別會讓這個模組跟傳輸層綁死，測試也得偽造整個 `WebSocket`；
 * 這裡只需要「送得出去」與「關得掉」兩件事。
 */
export interface SocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

const SOCKET_OPEN = 1;

/**
 * 行程內的連線登記簿。
 *
 * HUAN 只跑單一 Server 行程，連線狀態沒有跨行程共享的需求，因此刻意不引入
 * Redis 之類的外部元件。WebSocket 只送通知，斷線期間漏掉的變更會被 Device
 * 的定期完整同步補上，所以這份狀態即使隨行程重啟消失也不影響正確性。
 */
export class SocketHub {
	private readonly deviceSockets = new Map<string, Set<SocketLike>>();
	private readonly adminSockets = new Set<SocketLike>();

	attachDevice(deviceId: string, socket: SocketLike): void {
		let sockets = this.deviceSockets.get(deviceId);
		if (!sockets) {
			sockets = new Set();
			this.deviceSockets.set(deviceId, sockets);
		}
		sockets.add(socket);
	}

	detachDevice(deviceId: string, socket: SocketLike): void {
		const sockets = this.deviceSockets.get(deviceId);
		if (!sockets) return;
		sockets.delete(socket);
		if (sockets.size === 0) this.deviceSockets.delete(deviceId);
	}

	isDeviceOnline(deviceId: string): boolean {
		const sockets = this.deviceSockets.get(deviceId);
		if (!sockets) return false;
		for (const socket of sockets) {
			if (socket.readyState === SOCKET_OPEN) return true;
		}
		return false;
	}

	onlineDeviceIds(): string[] {
		return [...this.deviceSockets.keys()].filter(deviceId => this.isDeviceOnline(deviceId));
	}

	sendToDevice(deviceId: string, message: ServerToDeviceMessage): number {
		const sockets = this.deviceSockets.get(deviceId);
		if (!sockets) return 0;
		const payload = JSON.stringify(message);
		let delivered = 0;
		for (const socket of sockets) {
			if (socket.readyState !== SOCKET_OPEN) continue;
			socket.send(payload);
			delivered += 1;
		}
		return delivered;
	}

	notifyDesiredStateChanged(deviceId: string, version: number): number {
		return this.sendToDevice(deviceId, { type: "desired_state_changed", version });
	}

	sendCommand(deviceId: string, command: DeviceCommandKind): { commandId: string; delivered: number } {
		const commandId = randomUUID();
		return { commandId, delivered: this.sendToDevice(deviceId, { type: "command", commandId, command }) };
	}

	attachAdmin(socket: SocketLike): void {
		this.adminSockets.add(socket);
	}

	detachAdmin(socket: SocketLike): void {
		this.adminSockets.delete(socket);
	}

	broadcastAdmin(event: AdminEvent): number {
		const payload = JSON.stringify(event);
		let delivered = 0;
		for (const socket of this.adminSockets) {
			if (socket.readyState !== SOCKET_OPEN) continue;
			socket.send(payload);
			delivered += 1;
		}
		return delivered;
	}

	closeAll(): void {
		for (const sockets of this.deviceSockets.values()) {
			for (const socket of sockets) socket.close(1001, "server shutdown");
		}
		this.deviceSockets.clear();
		for (const socket of this.adminSockets) socket.close(1001, "server shutdown");
		this.adminSockets.clear();
	}
}
