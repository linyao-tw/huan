import type { Writable } from "node:stream";

/** 回到行首並清空整行。 */
const CLEAR_LINE = "\r\u001b[2K";

/**
 * 終端機狀態列。
 *
 * TTY 下用 `\r` 原地重畫一行，讓開發者一眼看到「現在幾號版本、素材幾支好了、線上還是離線」；
 * 不是 TTY（重導到檔案、CI）時就只在內容真的變了才印一行，避免產生幾萬行一模一樣的紀錄。
 */
export class StatusLine {
	private timer: ReturnType<typeof setInterval> | null = null;
	private lastRendered = "";
	private painted = false;

	constructor(
		private readonly render: () => Promise<string>,
		private readonly stream: Writable & { isTTY?: boolean } = process.stdout
	) {}

	private get interactive(): boolean {
		return this.stream.isTTY === true;
	}

	start(intervalMs = 1_000): void {
		if (this.timer) return;
		void this.refresh();
		this.timer = setInterval(() => void this.refresh(), intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.clear();
	}

	async refresh(): Promise<void> {
		let line: string;
		try {
			line = await this.render();
		} catch {
			// 狀態列算不出來不是中止程式的理由，跳過這一次就好。
			return;
		}
		if (line === this.lastRendered && !this.interactive) return;
		this.lastRendered = line;
		if (this.interactive) {
			this.stream.write(`${CLEAR_LINE}${line}`);
			this.painted = true;
		} else {
			this.stream.write(`${line}\n`);
		}
	}

	/** 在狀態列之上印出一整行訊息，印完再把狀態列畫回來。 */
	println(text: string): void {
		this.clear();
		this.stream.write(`${text}\n`);
		if (this.interactive && this.lastRendered) {
			this.stream.write(`${CLEAR_LINE}${this.lastRendered}`);
			this.painted = true;
		}
	}

	private clear(): void {
		if (!this.interactive || !this.painted) return;
		this.stream.write(CLEAR_LINE);
		this.painted = false;
	}
}
