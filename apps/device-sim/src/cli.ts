import { displayFromSize, toDeviceArch, toDevicePlatform } from "@huan/device-core";
import type { DeviceArch, DevicePlatform, DisplayInfo } from "@huan/protocol";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_SERVER_URL = "http://localhost:4000";

export interface SimOptions {
	serverUrl: string;
	dataDir: string;
	deviceName: string;
	platform: DevicePlatform;
	arch: DeviceArch;
	displays: DisplayInfo[];
	/** 執行解除綁定流程後結束，不進入常駐迴圈。 */
	unbind: boolean;
	verbose: boolean;
	help: boolean;
}

export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

/** 把裝置名稱轉成可以當目錄名的字串，讓同一個名字重跑時能沿用上次的配對結果。 */
export function slugify(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9一-鿿]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "device" : slug;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): SimOptions {
	let serverUrl = env.HUAN_SERVER_URL ?? DEFAULT_SERVER_URL;
	let dataDir = env.HUAN_SIM_DATA_DIR ?? null;
	let deviceName = env.HUAN_SIM_NAME ?? "模擬看板";
	let platform: DevicePlatform | null = null;
	let arch: DeviceArch | null = null;
	const displaySizes: string[] = [];
	let unbind = false;
	let verbose = false;
	let help = false;

	const next = (index: number, flag: string): string => {
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} 需要一個值`);
		return value;
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--server":
			case "--server-url":
				serverUrl = next(index, "--server");
				index += 1;
				break;
			case "--data-dir":
				dataDir = next(index, "--data-dir");
				index += 1;
				break;
			case "--name":
				deviceName = next(index, "--name");
				index += 1;
				break;
			case "--platform":
				platform = toDevicePlatform(next(index, "--platform"));
				index += 1;
				break;
			case "--arch":
				arch = toDeviceArch(next(index, "--arch"));
				index += 1;
				break;
			case "--display":
				displaySizes.push(next(index, "--display"));
				index += 1;
				break;
			case "--unbind":
				unbind = true;
				break;
			case "--verbose":
				verbose = true;
				break;
			case "--help":
			case "-h":
				help = true;
				break;
			default:
				if (arg !== undefined) throw new UsageError(`不認得的參數：${arg}`);
		}
	}

	if (displaySizes.length === 0) displaySizes.push("1920x1080");
	const displays: DisplayInfo[] = [];
	for (const [index, size] of displaySizes.entries()) {
		const display = displayFromSize(size, index);
		if (!display) throw new UsageError(`--display 的格式必須是 1920x1080，收到「${size}」`);
		displays.push(display);
	}

	if (!/^https?:\/\//.test(serverUrl)) throw new UsageError(`--server 必須是 http 或 https 網址，收到「${serverUrl}」`);

	return {
		serverUrl: serverUrl.replace(/\/+$/, ""),
		// 預設用暫存目錄下以裝置名稱命名的資料夾：同一個 --name 重跑時會沿用上次的配對，
		// 換一個名字就是一台全新的裝置。
		dataDir: dataDir ? resolve(dataDir) : join(tmpdir(), ".huan-sim", slugify(deviceName)),
		deviceName,
		platform: platform ?? "linux",
		arch: arch ?? "arm64",
		displays,
		unbind,
		verbose,
		help
	};
}

export const HELP_TEXT = `HUAN 模擬裝置

用法：
  pnpm dev:device-sim [選項]

選項：
  --server <url>       伺服器位址（預設 ${DEFAULT_SERVER_URL}，或環境變數 HUAN_SERVER_URL）
  --data-dir <path>    本機狀態目錄（預設暫存目錄下的 .huan-sim/<裝置名稱>）
  --name <name>        裝置名稱（預設「模擬看板」，或環境變數 HUAN_SIM_NAME）
  --platform <p>       模擬平台：linux、win32、darwin（預設 linux）
  --arch <a>           模擬架構：x64、arm64、arm（預設 arm64）
  --display <WxH>      模擬顯示器，可重複指定（預設 1920x1080）
  --unbind             解除綁定後結束
  --verbose            輸出詳細日誌
  -h, --help           顯示這份說明

說明：
  模擬裝置跑的是 @huan/device-core 的 DeviceAgent 本體，
  下載、雜湊驗證、原子性切換與排程判定都跟 Raspberry Pi 上完全一樣。`;
