import type { MediaProbe } from "@huan/protocol";
import { spawn } from "node:child_process";
import { z } from "zod";

/** 只保留最後這幾行 stderr。FFmpeg 失敗時前面幾百行都是版本與設定，沒有診斷價值。 */
const STDERR_TAIL_LINES = 40;

/**
 * 單一 FFmpeg 程序的上限。
 *
 * 沒有這個上限時，一支讓 FFmpeg 卡死的來源檔會永久佔住一個併發位置，
 * 而且因為 process 還活著，stale job 回收也救不了它。
 */
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export interface FfmpegBinaries {
	readonly ffmpegPath: string;
	readonly ffprobePath: string;
}

export class FfmpegError extends Error {
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	/** 最後幾行 stderr。只給日誌看，永遠不會出現在使用者訊息裡。 */
	readonly stderrTail: string;

	constructor(message: string, details: { exitCode: number | null; signal: NodeJS.Signals | null; stderrTail: string; cause?: unknown }) {
		super(message, { cause: details.cause });
		this.name = "FfmpegError";
		this.exitCode = details.exitCode;
		this.signal = details.signal;
		this.stderrTail = details.stderrTail;
	}
}

interface SpawnResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

/**
 * 以參數陣列啟動子程序。
 *
 * `shell: false` 是硬性安全要求：素材檔名、物件鍵與暫存路徑都源自使用者輸入，
 * 一旦組成 shell 字串，`;` 或 `$(...)` 就會變成可執行的指令。
 */
function spawnCapture(binary: string, args: readonly string[], timeoutMs: number): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, [...args], { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

		let stdout = "";
		const stderrLines: string[] = [];
		let stderrCarry = "";
		let settled = false;

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, timeoutMs);
		timer.unref();

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			const parts = (stderrCarry + chunk).split(/\r?\n|\r/);
			stderrCarry = parts.pop() ?? "";
			for (const line of parts) {
				stderrLines.push(line);
				if (stderrLines.length > STDERR_TAIL_LINES) stderrLines.shift();
			}
		});

		child.on("error", error => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new FfmpegError(`無法啟動 ${binary}`, { exitCode: null, signal: null, stderrTail: stderrLines.join("\n"), cause: error }));
		});

		child.on("close", (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (stderrCarry) stderrLines.push(stderrCarry);
			resolve({ exitCode: code, signal, stdout, stderr: stderrLines.slice(-STDERR_TAIL_LINES).join("\n") });
		});
	});
}

export interface RunFfmpegOptions {
	timeoutMs?: number;
}

/** 執行一次轉檔。失敗時丟出的 `FfmpegError` 帶著 stderr 尾端，只供日誌使用。 */
export async function runFfmpeg(binaries: FfmpegBinaries, args: readonly string[], options: RunFfmpegOptions = {}): Promise<void> {
	const result = await spawnCapture(binaries.ffmpegPath, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	if (result.exitCode !== 0) {
		throw new FfmpegError(`ffmpeg 以代碼 ${result.exitCode ?? "null"} 結束`, { exitCode: result.exitCode, signal: result.signal, stderrTail: result.stderr });
	}
}

const FfprobeStreamSchema = z.object({
	codec_type: z.string().optional(),
	codec_name: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	pix_fmt: z.string().optional(),
	r_frame_rate: z.string().optional(),
	avg_frame_rate: z.string().optional(),
	duration: z.string().optional(),
	nb_frames: z.string().optional()
});

const FfprobeOutputSchema = z.object({
	streams: z.array(FfprobeStreamSchema).default([]),
	format: z
		.object({
			duration: z.string().optional(),
			format_name: z.string().optional(),
			size: z.string().optional()
		})
		.default({})
});

export type FfprobeStream = z.infer<typeof FfprobeStreamSchema>;

/**
 * 解析 `r_frame_rate` 這種 `30000/1001` 的分數字串。
 *
 * 靜態圖片會回 `0/0`，那不是「0 fps」而是「沒有影格率」，因此回 `null` 而不是 0。
 */
export function parseFrameRate(value: string | undefined): number | null {
	if (!value) return null;
	const [numerator, denominator] = value.split("/");
	const top = Number(numerator);
	const bottom = denominator === undefined ? 1 : Number(denominator);
	if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0 || top === 0) return null;
	return top / bottom;
}

/**
 * 從像素格式判斷有沒有 alpha 通道。
 *
 * `pal8` 也算進來：PNG 的調色盤搭配 tRNS 區塊一樣會有透明度，
 * 判斷錯的代價是把透明背景壓成黑色，寧可保守一點輸出 PNG。
 */
export function pixelFormatHasAlpha(pixelFormat: string | undefined): boolean | null {
	if (!pixelFormat) return null;
	return /^(yuva|ya8|ya16|rgba|argb|abgr|bgra|gbrap|pal8)/.test(pixelFormat);
}

function parseSeconds(value: string | undefined): number | null {
	if (value === undefined) return null;
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function toMediaProbe(raw: unknown): MediaProbe {
	const parsed = FfprobeOutputSchema.parse(raw);
	const video = parsed.streams.find(stream => stream.codec_type === "video");
	const audio = parsed.streams.find(stream => stream.codec_type === "audio");
	const seconds = parseSeconds(parsed.format.duration) ?? parseSeconds(video?.duration);

	return {
		durationMs: seconds === null ? null : Math.round(seconds * 1000),
		width: video?.width ?? null,
		height: video?.height ?? null,
		videoCodec: video?.codec_name ?? null,
		audioCodec: audio?.codec_name ?? null,
		frameRate: parseFrameRate(video?.r_frame_rate) ?? parseFrameRate(video?.avg_frame_rate),
		hasAlpha: pixelFormatHasAlpha(video?.pix_fmt)
	};
}

/** 執行 ffprobe 並回傳 HUAN 的 `MediaProbe`。 */
export async function ffprobe(binaries: FfmpegBinaries, filePath: string): Promise<MediaProbe> {
	const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];
	const result = await spawnCapture(binaries.ffprobePath, args, DEFAULT_TIMEOUT_MS);
	if (result.exitCode !== 0) {
		throw new FfmpegError(`ffprobe 以代碼 ${result.exitCode ?? "null"} 結束`, { exitCode: result.exitCode, signal: result.signal, stderrTail: result.stderr });
	}
	let raw: unknown;
	try {
		raw = JSON.parse(result.stdout) as unknown;
	} catch (error) {
		throw new FfmpegError("ffprobe 輸出不是有效的 JSON", { exitCode: result.exitCode, signal: result.signal, stderrTail: result.stderr, cause: error });
	}
	return toMediaProbe(raw);
}

/**
 * 只會縮小、不會放大的 scale 濾鏡。
 *
 * `min(max,iw)` 讓小於上限的來源維持原尺寸，`force_original_aspect_ratio=decrease`
 * 保證長寬比不變，`force_divisible_by=2` 則是因為 yuv420p 的色度取樣需要偶數邊長。
 */
export function downscaleFilter(maxWidth: number, maxHeight: number): string {
	return `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

/** 只有在來源真的超過上限時才降影格率；容差是為了避免 29.97 被誤判成超過 30。 */
export function fpsFilter(sourceFrameRate: number | null, cap: number): string | null {
	if (sourceFrameRate === null || sourceFrameRate <= cap + 0.05) return null;
	return `fps=${cap}`;
}

export function buildFilterChain(parts: readonly (string | null)[]): string {
	return parts.filter((part): part is string => part !== null).join(",");
}
