import type { CredentialStore } from "./credentials.js";
import { describeError, silentLogger, type Logger } from "./logger.js";
import type { DeviceStorage, UnbindReason, UnbindRecord } from "./storage.js";
import { systemClock, type Clock } from "./types.js";

export interface UnbindManagerOptions {
	storage: DeviceStorage;
	credentials: CredentialStore;
	clock?: Clock;
	logger?: Logger;
}

/**
 * 解除綁定。
 *
 * 現場的情境是：有人要把這台看板搬走或退租，而網路剛好不通。
 * 這時「等連上伺服器再說」是不能接受的答案 —— 本機必須立刻停止接受帳戶控制，
 * 憑證立刻失效、desired state 立刻清空，伺服器端的撤銷則排隊等下次連線補做。
 *
 * 反過來說，一旦標記了解除綁定，任何遲到的伺服器回應都不得把它翻回來：
 * 那些回應是在解除綁定之前就發出的，不代表使用者改變了心意。
 */
export class UnbindManager {
	private readonly storage: DeviceStorage;
	private readonly credentials: CredentialStore;
	private readonly clock: Clock;
	private readonly logger: Logger;

	private record: UnbindRecord | null = null;
	/**
	 * 待撤銷時暫留在記憶體裡的憑證。
	 *
	 * 撤銷 `/device/unbind` 需要 Bearer，但憑證已經從金鑰鏈裡清掉了。
	 * 把它寫回任何檔案等於讓「已解除綁定」的裝置留著一份可用密文，所以只留在行程記憶體：
	 * 行程重啟就放棄伺服器端撤銷，本機仍然維持解除綁定狀態。
	 */
	private retainedToken: string | null = null;

	constructor(options: UnbindManagerOptions) {
		this.storage = options.storage;
		this.credentials = options.credentials;
		this.clock = options.clock ?? systemClock;
		this.logger = options.logger ?? silentLogger;
	}

	async load(): Promise<void> {
		this.record = await this.storage.readUnbind();
	}

	/** 本機已經解除綁定：不再接受任何帳戶控制。 */
	get revoked(): boolean {
		return this.record !== null;
	}

	/** 已解除綁定，但伺服器端還沒撤銷成功。 */
	get revokePending(): boolean {
		return this.record?.revokePending === true;
	}

	get state(): UnbindRecord | null {
		return this.record;
	}

	/**
	 * 立即解除綁定。即使完全離線也必須生效。
	 *
	 * `reason === "remote"` 代表伺服器（或後台）已經撤銷過憑證，本機不必再回頭通知，
	 * 因此不留 `revokePending`。
	 */
	async request(reason: UnbindReason, token: string | null): Promise<UnbindRecord> {
		if (reason === "local" && token) this.retainedToken = token;

		const record: UnbindRecord = { revokePending: reason === "local", requestedAt: this.clock.now().toISOString(), reason };
		// 先落地旗標再清狀態：中途斷電時寧可留著「已解除綁定但還沒清乾淨」，
		// 也不要留下「清乾淨了卻沒有旗標」而在下次開機重新接受帳戶控制。
		await this.storage.writeUnbind(record);
		this.record = record;

		await this.credentials.clear();
		await this.storage.clearIdentity();
		await this.storage.clearDesiredState();
		await this.storage.clearActiveManifest();
		await this.storage.clearPendingManifest();
		await this.storage.clearActivation();
		// 回報快照裡有前一個租戶的素材與版面編號，一併清掉才算真的交還這台機器。
		await this.storage.clearReportedState();
		await this.storage.wipeMedia();

		this.logger.info("裝置已在本機解除綁定", { reason, revokePending: record.revokePending });
		return record;
	}

	/**
	 * 補做伺服器端撤銷。回傳 `false` 代表這次還沒完成，之後再試。
	 * 無論成功與否，本機的解除綁定狀態都不會被取消。
	 */
	async completeRevoke(revoke: (token: string) => Promise<void>): Promise<boolean> {
		const record = this.record;
		if (!record?.revokePending) return true;
		const token = this.retainedToken;
		if (!token) {
			this.logger.debug("沒有可用的憑證可完成伺服器端撤銷，維持本機解除綁定");
			return false;
		}
		try {
			await revoke(token);
		} catch (error) {
			this.logger.warn("伺服器端撤銷失敗，下次連線再試", { error: describeError(error) });
			return false;
		}
		const next: UnbindRecord = { ...record, revokePending: false };
		await this.storage.writeUnbind(next);
		this.record = next;
		this.retainedToken = null;
		this.logger.info("伺服器端撤銷完成");
		return true;
	}

	/** 只有重新配對成功才可以清掉解除綁定紀錄 —— 那時已經是一組全新的身分了。 */
	async reset(): Promise<void> {
		this.retainedToken = null;
		this.record = null;
		await this.storage.clearUnbind();
	}
}
