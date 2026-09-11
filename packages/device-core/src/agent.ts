import { PROTOCOL_VERSION, type DeviceCommandKind, type ReportedState, type ServerToDeviceMessage } from "@huan/protocol";
import { backoffDelay } from "@huan/shared";
import { join } from "node:path";
import { DeviceApiClient, DeviceApiError } from "./api-client.js";
import { FileCredentialStore, buildDeviceToken, type CredentialStore } from "./credentials.js";
import { DownloadQueue, type DownloadProgress } from "./downloader.js";
import { TypedEmitter } from "./events.js";
import { describeError, silentLogger, type Logger } from "./logger.js";
import { Reconciler, type AssetSummary, type ReconcileResult } from "./reconciler.js";
import { LayoutScheduler, type ScheduleTarget } from "./scheduler.js";
import { DeviceSocket, type SocketFactory } from "./socket.js";
import { StorageManager, type DiskUsageReader } from "./storage-manager.js";
import { DeviceStorage, type DeviceIdentity, type UnbindReason } from "./storage.js";
import { systemClock, systemSleep, type Clock, type FetchLike, type PlatformInfoProvider, type Sleep } from "./types.js";
import { UnbindManager } from "./unbind.js";

export type DeviceAgentStatus = "stopped" | "unpaired" | "pairing" | "running" | "unbound";

export type SyncReason = "startup" | "socket" | "heartbeat" | "fallback" | "command" | "manual";

export interface DeviceAgentEvents extends Record<string, unknown> {
	status: DeviceAgentStatus;
	pairing_code: { code: string; pairingUrl: string; expiresAt: string };
	pairing_failed: { reason: string };
	paired: { deviceId: string; deviceName: string };
	online: boolean;
	sync_started: { reason: SyncReason };
	sync_finished: ReconcileResult;
	sync_failed: { reason: string; retryable: boolean };
	asset_progress: DownloadProgress;
	layout_changed: ScheduleTarget;
	heartbeat: { desiredVersion: number };
	restart_player: undefined;
	unbound: { reason: UnbindReason };
}

export interface DeviceAgentOptions {
	appDataDir: string;
	serverUrl: string;
	deviceName: string;
	appVersion: string;
	platform: PlatformInfoProvider;
	credentials?: CredentialStore;
	fetch?: FetchLike;
	socketFactory?: SocketFactory;
	diskUsage?: DiskUsageReader;
	clock?: Clock;
	sleep?: Sleep;
	logger?: Logger;
	random?: () => number;
	/** 尚未配對時是否自動開始配對流程。Electron 播放器會設為 `false`，由自己的 UI 主導。 */
	autoPair?: boolean;
	schedulerTickMs?: number;
	maxDownloadAttempts?: number;
	pairingPollIntervalMs?: number;
	requestTimeoutMs?: number;
}

export interface PairOptions {
	pollIntervalMs?: number;
	signal?: AbortSignal;
}

const DEFAULT_HEARTBEAT_SECONDS = 60;
const DEFAULT_FALLBACK_SYNC_SECONDS = 300;

/**
 * 把儲存、憑證、REST、WebSocket、下載佇列、調和器與排程器接成一台可運作的裝置。
 *
 * 所有外部相依（時鐘、fetch、WebSocket 工廠、檔案根目錄、憑證保管、硬體資訊）都是注入的，
 * 因此整個引擎可以在沒有 Electron、沒有真實網路的情況下被完整測試 ——
 * 模擬裝置跑的就是這個類別本身，不是另一份「差不多」的實作。
 */
export class DeviceAgent {
	readonly events: TypedEmitter<DeviceAgentEvents>;
	readonly storage: DeviceStorage;
	readonly api: DeviceApiClient;
	readonly scheduler: LayoutScheduler;
	readonly reconciler: Reconciler;

	private readonly credentials: CredentialStore;
	private readonly storageManager: StorageManager;
	private readonly downloader: DownloadQueue;
	private readonly unbindManager: UnbindManager;
	private readonly socket: DeviceSocket;
	private readonly logger: Logger;
	private readonly clock: Clock;
	private readonly sleep: Sleep;
	private readonly random: () => number;
	private readonly platform: PlatformInfoProvider;
	private readonly options: DeviceAgentOptions;

	private state: DeviceAgentStatus = "stopped";
	private identity: DeviceIdentity | null = null;
	private loaded = false;
	private started = false;
	private operating = false;
	private lastSyncAt: string | null = null;
	private serverDesiredVersion: number | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private fallbackTimer: ReturnType<typeof setInterval> | null = null;
	private timerIntervals: { heartbeatMs: number; fallbackMs: number } | null = null;
	private syncing: Promise<ReconcileResult | null> | null = null;
	private syncQueued = false;

	constructor(options: DeviceAgentOptions) {
		this.options = options;
		this.logger = options.logger ?? silentLogger;
		this.clock = options.clock ?? systemClock;
		this.sleep = options.sleep ?? systemSleep;
		this.random = options.random ?? Math.random;
		this.platform = options.platform;
		this.events = new TypedEmitter<DeviceAgentEvents>(this.logger);

		this.storage = new DeviceStorage({ appDataDir: options.appDataDir, logger: this.logger });
		this.credentials = options.credentials ?? new FileCredentialStore(join(options.appDataDir, "config", "credential"), this.logger);
		this.api = new DeviceApiClient({
			baseUrl: options.serverUrl,
			fetch: options.fetch,
			logger: this.logger,
			timeoutMs: options.requestTimeoutMs,
			token: () => this.resolveToken()
		});
		this.storageManager = new StorageManager({ storage: this.storage, logger: this.logger, clock: this.clock, diskUsage: options.diskUsage });
		this.downloader = new DownloadQueue({
			storage: this.storage,
			api: this.api,
			fetch: options.fetch,
			logger: this.logger,
			clock: this.clock,
			sleep: this.sleep,
			random: this.random,
			maxAttempts: options.maxDownloadAttempts
		});
		this.scheduler = new LayoutScheduler({ clock: this.clock, logger: this.logger, tickMs: options.schedulerTickMs });
		this.reconciler = new Reconciler({
			storage: this.storage,
			api: this.api,
			downloader: this.downloader,
			storageManager: this.storageManager,
			scheduler: this.scheduler,
			clock: this.clock,
			logger: this.logger
		});
		this.unbindManager = new UnbindManager({ storage: this.storage, credentials: this.credentials, clock: this.clock, logger: this.logger });
		this.socket = new DeviceSocket({
			url: this.api.socketUrl,
			token: () => this.resolveToken(),
			factory: options.socketFactory,
			logger: this.logger,
			random: this.random
		});

		this.scheduler.events.on("change", target => this.events.emit("layout_changed", target));
		this.reconciler.events.on("progress", progress => this.events.emit("asset_progress", progress));
		this.socket.events.on("status", () => this.events.emit("online", this.socket.online));
		this.socket.events.on("open", () => void this.onSocketOpen());
		this.socket.events.on("message", message => void this.onSocketMessage(message));
	}

	get status(): DeviceAgentStatus {
		return this.state;
	}

	get online(): boolean {
		return this.socket.online;
	}

	get deviceIdentity(): DeviceIdentity | null {
		return this.identity;
	}

	get currentTarget(): ScheduleTarget {
		return this.scheduler.current;
	}

	get activeVersion(): number | null {
		return this.reconciler.activationVersion;
	}

	get desiredVersion(): number | null {
		return this.serverDesiredVersion ?? this.reconciler.latestDesiredVersion;
	}

	get lastSyncedAt(): string | null {
		return this.lastSyncAt;
	}

	assetSummary(): Promise<AssetSummary> {
		return this.reconciler.assetSummary();
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		await this.ensureLoaded();

		if (this.unbindManager.revoked) {
			this.setStatus("unbound");
			// 可能是離線時解除綁定、現在網路回來了：把伺服器端的撤銷補完。
			await this.tryCompleteRevoke();
			return;
		}

		if (!(await this.isPaired())) {
			this.setStatus("unpaired");
			if (this.options.autoPair === false) return;
			await this.pair();
			if (!(await this.isPaired())) return;
		}

		await this.beginOperation();
	}

	async stop(): Promise<void> {
		this.started = false;
		this.operating = false;
		this.socket.stop();
		this.scheduler.stop();
		this.stopTimers();
		this.setStatus("stopped");
	}

	/**
	 * 走完配對流程。伺服器連不上或配對碼過期都會自動重來，
	 * 因為現場的情況通常是「先開機、晚點才有人去後台輸入配對碼」。
	 */
	async pair(options: PairOptions = {}): Promise<{ deviceId: string; deviceName: string } | null> {
		await this.ensureLoaded();
		this.setStatus("pairing");
		const pollIntervalMs = options.pollIntervalMs ?? this.options.pairingPollIntervalMs ?? 3_000;
		const info = await this.platform.read();
		let attempt = 0;

		while (!options.signal?.aborted) {
			try {
				const started = await this.api.startPairing({
					deviceName: this.options.deviceName,
					platform: info.platform,
					arch: info.arch,
					appVersion: this.options.appVersion,
					protocolVersion: PROTOCOL_VERSION
				});
				attempt = 0;
				this.events.emit("pairing_code", { code: started.code, pairingUrl: started.pairingUrl, expiresAt: started.expiresAt });

				const paired = await this.pollPairing(started.pairingToken, pollIntervalMs, options.signal);
				if (!paired) continue;

				await this.credentials.set(paired.credential);
				const identity: DeviceIdentity = {
					deviceId: paired.deviceId,
					deviceName: paired.deviceName,
					serverUrl: this.options.serverUrl,
					credentialRef: "device-credential",
					pairedAt: this.clock.now().toISOString()
				};
				await this.storage.writeIdentity(identity);
				this.identity = identity;
				// 重新配對代表這是一組全新的身分，之前的解除綁定紀錄不該再擋住它。
				await this.unbindManager.reset();
				this.events.emit("paired", { deviceId: identity.deviceId, deviceName: identity.deviceName });
				// 配對成功後必須自己接上運作迴圈。autoPair=false 的 Electron 播放器是由 UI
				// 直接呼叫 pair()，start() 早已因為未配對而提前返回，若這裡不啟動，裝置就會
				// 停在「已配對卻不同步」的狀態，得重開才會動。beginOperation 具冪等保護，
				// 因此 autoPair 流程在 start() 再呼叫一次也不會重複啟動。
				await this.beginOperation();
				return { deviceId: identity.deviceId, deviceName: identity.deviceName };
			} catch (error) {
				const reason = describeError(error);
				this.events.emit("pairing_failed", { reason });
				await this.sleep(backoffDelay(attempt, { baseMs: 2_000, maxMs: 30_000 }, this.random));
				attempt += 1;
			}
		}
		return null;
	}

	async sync(reason: SyncReason = "manual"): Promise<ReconcileResult | null> {
		if (this.syncing) {
			// 同一時間只跑一輪調和。WebSocket 通知、heartbeat 與定時同步很容易撞在一起，
			// 併發跑會讓兩輪同時下載同一批檔案。
			this.syncQueued = true;
			return this.syncing;
		}
		const run = this.runSync(reason);
		this.syncing = run;
		try {
			const result = await run;
			if (this.syncQueued) {
				this.syncQueued = false;
				this.syncing = null;
				return await this.sync(reason);
			}
			return result;
		} finally {
			this.syncing = null;
		}
	}

	/** 本機主動解除綁定。離線也必須立刻生效。 */
	async unbind(): Promise<void> {
		await this.ensureLoaded();
		const token = await this.resolveToken();
		this.operating = false;
		this.socket.stop();
		this.scheduler.stop();
		this.stopTimers();
		await this.unbindManager.request("local", token);
		this.identity = null;
		this.setStatus("unbound");
		this.events.emit("unbound", { reason: "local" });
		await this.tryCompleteRevoke();
	}

	/** 補做伺服器端撤銷。回傳 `true` 代表已經沒有待辦的撤銷。 */
	tryCompleteRevoke(): Promise<boolean> {
		return this.unbindManager.completeRevoke(async token => {
			await this.api.unbindWithToken(token);
		});
	}

	get revoked(): boolean {
		return this.unbindManager.revoked;
	}

	get revokePending(): boolean {
		return this.unbindManager.revokePending;
	}

	async buildReportedState(): Promise<ReportedState> {
		const info = await this.platform.read();
		const usage = await this.storageManager.usage();
		const summary = await this.reconciler.assetSummary();
		const target = this.scheduler.current;
		return {
			desiredVersion: this.reconciler.activationVersion,
			appVersion: this.options.appVersion,
			protocolVersion: PROTOCOL_VERSION,
			platform: info.platform,
			arch: info.arch,
			osVersion: info.osVersion,
			displays: info.displays,
			currentLayoutRevisionId: target.layoutRevisionId,
			currentScheduleId: target.scheduleId,
			readyAssetIds: summary.readyAssetIds,
			pendingAssetIds: summary.pendingAssetIds,
			diskFreeBytes: usage.freeBytes,
			diskTotalBytes: usage.totalBytes,
			temperatureCelsius: info.temperatureCelsius,
			uptimeSeconds: info.uptimeSeconds,
			lastSyncAt: this.lastSyncAt,
			storageError: this.reconciler.lastStorageError
		};
	}

	/* ── 內部 ─────────────────────────────────────────────────────────── */

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		await this.storage.init();
		await this.unbindManager.load();
		this.identity = await this.storage.readIdentity();
		await this.reconciler.load();
		this.loaded = true;
	}

	private async isPaired(): Promise<boolean> {
		if (!this.identity) return false;
		return (await this.credentials.get()) !== null;
	}

	private async beginOperation(): Promise<void> {
		// 冪等：start() 的 autoPair 流程與 pair() 都可能呼叫到這裡，重複啟動會讓
		// scheduler／socket／計時器各起兩份。
		if (this.operating) return;
		this.operating = true;
		this.setStatus("running");
		this.scheduler.start();
		this.socket.start();
		this.rescheduleTimers();
		await this.sync("startup");
		this.rescheduleTimers();
	}

	private async pollPairing(pairingToken: string, pollIntervalMs: number, signal?: AbortSignal): Promise<{ deviceId: string; deviceName: string; credential: string } | null> {
		while (!signal?.aborted) {
			const status = await this.api.pairingStatus(pairingToken);
			if (status.status === "paired") return { deviceId: status.deviceId, deviceName: status.deviceName, credential: status.credential };
			if (status.status === "expired") return null;
			await this.sleep(pollIntervalMs);
		}
		return null;
	}

	private async resolveToken(): Promise<string | null> {
		// 已解除綁定就永遠不再送出憑證，即使檔案因故還在。
		if (this.unbindManager.revoked) return null;
		const identity = this.identity;
		if (!identity) return null;
		const secret = await this.credentials.get();
		if (!secret) return null;
		return buildDeviceToken(identity.deviceId, secret);
	}

	private async runSync(reason: SyncReason): Promise<ReconcileResult | null> {
		if (this.unbindManager.revoked) return null;
		this.events.emit("sync_started", { reason });
		try {
			const result = await this.reconciler.sync();
			this.lastSyncAt = this.clock.now().toISOString();
			this.serverDesiredVersion = result.desiredVersion;
			this.events.emit("sync_finished", result);
			if (result.credentialRevoked) await this.handleCredentialRevoked();
			else if (result.activated) this.rescheduleTimers();
			return result;
		} catch (error) {
			if (error instanceof DeviceApiError && error.credentialRevoked) {
				await this.handleCredentialRevoked();
				return null;
			}
			const retryable = error instanceof DeviceApiError ? error.retryable : true;
			this.events.emit("sync_failed", { reason: describeError(error), retryable });
			return null;
		}
	}

	private async onSocketOpen(): Promise<void> {
		// 斷線期間可能錯過了 desired_state_changed，所以一連上就先完整同步一次。
		await this.sync("socket");
	}

	private async onSocketMessage(message: ServerToDeviceMessage): Promise<void> {
		if (this.unbindManager.revoked) return;
		switch (message.type) {
			case "hello":
				this.serverDesiredVersion = message.desiredVersion;
				break;
			case "desired_state_changed":
				this.serverDesiredVersion = message.version;
				await this.sync("socket");
				break;
			case "command":
				await this.handleCommand(message.commandId, message.command);
				break;
			case "pong":
				break;
		}
	}

	private async handleCommand(commandId: string, command: DeviceCommandKind): Promise<void> {
		let ok = true;
		let note: string | undefined;
		try {
			switch (command) {
				case "force_sync":
					await this.sync("command");
					break;
				case "restart_player":
					this.events.emit("restart_player", undefined);
					break;
				case "unbind":
					// 後台按下解除綁定：伺服器端已經撤銷憑證，本機不必再回頭通知。
					await this.handleCredentialRevoked();
					break;
			}
		} catch (error) {
			ok = false;
			note = describeError(error);
		}
		if (commandId) this.socket.send({ type: "command_result", commandId, ok, ...(note === undefined ? {} : { message: note }) });
	}

	/**
	 * 伺服器端已經撤銷這台裝置（401/403，或後台按下解除綁定）。
	 * 本機立刻進入解除綁定狀態，且不需要再回頭通知伺服器。
	 */
	private async handleCredentialRevoked(): Promise<void> {
		if (this.unbindManager.revoked) return;
		this.logger.warn("憑證已被撤銷，進入解除綁定狀態");
		this.operating = false;
		this.socket.stop();
		this.scheduler.stop();
		this.stopTimers();
		await this.unbindManager.request("remote", null);
		this.identity = null;
		this.setStatus("unbound");
		this.events.emit("unbound", { reason: "remote" });
	}

	private async sendHeartbeat(): Promise<void> {
		if (this.unbindManager.revoked) return;
		try {
			const reported = await this.buildReportedState();
			await this.storage.writeReportedState(reported);
			const response = await this.api.heartbeat(reported);
			this.serverDesiredVersion = response.desiredVersion;
			this.events.emit("heartbeat", { desiredVersion: response.desiredVersion });
			if (response.desiredVersion !== this.reconciler.activationVersion) await this.sync("heartbeat");
		} catch (error) {
			if (error instanceof DeviceApiError && error.credentialRevoked) {
				await this.handleCredentialRevoked();
				return;
			}
			this.logger.debug("heartbeat 失敗", { error: describeError(error) });
		}
	}

	/**
	 * 依照 desired state 的設定重排計時器。
	 *
	 * 就算 WebSocket 一切正常也保留 fallback 同步：推播可能因為代理伺服器、
	 * NAT 逾時或伺服器重啟而靜靜地消失，定時輪詢是最後一道保險。
	 */
	private rescheduleTimers(): void {
		if (!this.started || this.unbindManager.revoked) {
			this.stopTimers();
			return;
		}
		const settings = this.reconciler.activeManifest?.settings;
		const heartbeatMs = (settings?.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_SECONDS) * 1000;
		const fallbackMs = (settings?.fallbackSyncIntervalSeconds ?? DEFAULT_FALLBACK_SYNC_SECONDS) * 1000;
		// 間隔沒變就不要重建計時器。內容更新頻繁時，每次啟用都重新計時會讓 heartbeat
		// 永遠等不到到期，伺服器那邊就會看到一台「明明在同步卻顯示離線」的裝置。
		if (this.heartbeatTimer && this.fallbackTimer && this.timerIntervals?.heartbeatMs === heartbeatMs && this.timerIntervals.fallbackMs === fallbackMs) return;
		this.stopTimers();
		this.timerIntervals = { heartbeatMs, fallbackMs };
		this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), heartbeatMs);
		this.fallbackTimer = setInterval(() => void this.sync("fallback"), fallbackMs);
	}

	private stopTimers(): void {
		this.timerIntervals = null;
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.fallbackTimer) {
			clearInterval(this.fallbackTimer);
			this.fallbackTimer = null;
		}
	}

	private setStatus(status: DeviceAgentStatus): void {
		if (this.state === status) return;
		this.state = status;
		this.events.emit("status", status);
	}
}
