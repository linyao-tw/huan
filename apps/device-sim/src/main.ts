#!/usr/bin/env node
import { renderPairingBanner } from "@/banner";
import { HELP_TEXT, UsageError, parseArgs, type SimOptions } from "@/cli";
import { StatusLine } from "@/status";
import { DeviceAgent, FileCredentialStore, createConsoleLogger, createNodePlatformInfoProvider, silentLogger } from "@huan/device-core";
import { formatBytes } from "@huan/shared";
import { join } from "node:path";

const APP_VERSION = "0.1.0-sim";

async function main(): Promise<number> {
	let options: SimOptions;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`參數錯誤：${error.message}\n`);
			console.error(HELP_TEXT);
			return 2;
		}
		throw error;
	}

	if (options.help) {
		console.log(HELP_TEXT);
		return 0;
	}

	const logger = options.verbose ? createConsoleLogger("debug") : silentLogger;
	const agent = new DeviceAgent({
		appDataDir: options.dataDir,
		serverUrl: options.serverUrl,
		deviceName: options.deviceName,
		appVersion: APP_VERSION,
		credentials: new FileCredentialStore(join(options.dataDir, "config", "credential"), logger),
		platform: createNodePlatformInfoProvider({
			platform: options.platform,
			arch: options.arch,
			displays: options.displays,
			// 只有 Linux 讀得到 CPU 溫度；模擬其他平台時就誠實回報 null，不要編一個數字。
			readTemperature: options.platform === "linux" ? async () => 48.5 : async () => null
		}),
		logger
	});

	const status = new StatusLine(() => renderStatus(agent, options));

	console.log(`HUAN 模擬裝置「${options.deviceName}」`);
	console.log(`  伺服器：${options.serverUrl}`);
	console.log(`  資料目錄：${options.dataDir}`);
	console.log(`  模擬硬體：${options.platform}/${options.arch}，${options.displays.map(display => `${display.width}x${display.height}`).join("、")}`);
	console.log("");

	if (options.unbind) {
		await agent.unbind();
		console.log("已在本機解除綁定：憑證、身分與播放檔都已清除。");
		console.log(agent.revokePending ? "伺服器端撤銷尚未完成，下次連線時會補做。" : "伺服器端撤銷已完成。");
		return 0;
	}

	wireEvents(agent, status, options);

	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		status.stop();
		console.log("\n收到中斷訊號，正在停止模擬裝置…");
		void agent.stop().then(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	status.start();
	await agent.start();
	// `start()` 回來之後 agent 靠計時器與 WebSocket 繼續運作，行程不會結束，
	// 直到使用者按下 Ctrl-C。
	return 0;
}

function wireEvents(agent: DeviceAgent, status: StatusLine, options: SimOptions): void {
	let lastFailure: string | null = null;

	agent.events.on("pairing_code", info => {
		status.println("");
		status.println(renderPairingBanner(info));
		status.println("");
	});

	agent.events.on("paired", info => {
		status.println(`✔ 配對完成：${info.deviceName}（${info.deviceId}）`);
		lastFailure = null;
	});

	agent.events.on("pairing_failed", info => {
		if (lastFailure === info.reason) return;
		lastFailure = info.reason;
		status.println(`✖ 配對失敗：${info.reason}`);
		status.println(`  請確認 HUAN 伺服器已啟動且可從這裡連到 ${options.serverUrl}，模擬裝置會持續重試。`);
	});

	agent.events.on("sync_failed", info => {
		if (lastFailure === info.reason) return;
		lastFailure = info.reason;
		status.println(`✖ 同步失敗：${info.reason}`);
		if (info.retryable) status.println(`  維持播放既有內容，稍後自動重試（伺服器：${options.serverUrl}）。`);
	});

	agent.events.on("sync_finished", result => {
		lastFailure = null;
		if (result.activated) status.println(`✔ 已切換到版本 ${result.desiredVersion}`);
		else if (result.failed.length > 0) status.println(`⚠ 版本 ${result.desiredVersion} 有 ${result.failed.length} 個素材尚未就緒，繼續播放既有內容`);
		if (result.storageError) status.println(`⚠ ${result.storageError}`);
	});

	agent.events.on("layout_changed", target => {
		const name = target.layout?.name ?? "待命畫面";
		const source = target.source === "schedule" ? `排程「${target.scheduleName ?? ""}」` : target.source === "default" ? "預設版面" : "無內容";
		status.println(`▶ 版面切換：${name}（${source}）`);
	});

	agent.events.on("restart_player", () => {
		status.println("↻ 收到重新啟動播放器指令（模擬裝置沒有畫面，僅記錄）");
	});

	agent.events.on("unbound", info => {
		status.println(info.reason === "local" ? "■ 已在本機解除綁定" : "■ 伺服器已撤銷這台裝置的憑證，已停止接受帳戶控制");
	});
}

async function renderStatus(agent: DeviceAgent, options: SimOptions): Promise<string> {
	const target = agent.currentTarget;
	const summary = await agent.assetSummary();
	const reported = await agent.buildReportedState();

	const connection = agent.status === "unbound" ? "已解除綁定" : agent.online ? "線上" : "離線";
	const active = agent.activeVersion ?? "—";
	const desired = agent.desiredVersion ?? "—";
	const layout = target.layout ? `${target.layout.name}（rev ${target.layout.revisionNumber}）` : "待命畫面";
	const pairing = agent.status === "pairing" ? "等待配對" : null;
	const disk = formatBytes(reported.diskFreeBytes);
	const synced = agent.lastSyncedAt ? new Date(agent.lastSyncedAt).toLocaleTimeString("zh-TW", { hour12: false }) : "—";

	const parts = [`[${connection}]`, pairing ?? `版本 ${active}/${desired}`, `素材 ${summary.readyCount}/${summary.totalCount}`, `版面 ${layout}`, `磁碟 ${disk}`, `同步 ${synced}`];
	if (options.verbose && reported.storageError) parts.push(`儲存 ${reported.storageError}`);
	return parts.join(" · ");
}

main()
	.then(code => {
		if (code !== 0) process.exitCode = code;
	})
	.catch((error: unknown) => {
		console.error(`模擬裝置啟動失敗：${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
