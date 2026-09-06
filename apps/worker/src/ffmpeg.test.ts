import { FfmpegError, buildFilterChain, downscaleFilter, ffprobe, fpsFilter, parseFrameRate, pixelFormatHasAlpha, runFfmpeg, toMediaProbe } from "@/ffmpeg";
import { announceSkip, binariesFromEnv, ffmpegAvailable, generateVideo, makeTempDir, removeTempDir } from "@/test-support";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("ffprobe 輸出解析", () => {
	it("把 r_frame_rate 的分數換成數值", () => {
		expect(parseFrameRate("30/1")).toBe(30);
		expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
		expect(parseFrameRate("0/0")).toBeNull();
		expect(parseFrameRate(undefined)).toBeNull();
	});

	it("從像素格式判斷 alpha", () => {
		expect(pixelFormatHasAlpha("yuv420p")).toBe(false);
		expect(pixelFormatHasAlpha("yuva420p")).toBe(true);
		expect(pixelFormatHasAlpha("rgba")).toBe(true);
		expect(pixelFormatHasAlpha("pal8")).toBe(true);
		expect(pixelFormatHasAlpha(undefined)).toBeNull();
	});

	it("沒有音軌時 audioCodec 是 null", () => {
		const probe = toMediaProbe({
			streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, pix_fmt: "yuv420p", r_frame_rate: "30/1" }],
			format: { duration: "2.000000" }
		});
		expect(probe.audioCodec).toBeNull();
		expect(probe.durationMs).toBe(2000);
		expect(probe.hasAlpha).toBe(false);
	});

	it("靜態圖片沒有影格率", () => {
		const probe = toMediaProbe({
			streams: [{ codec_type: "video", codec_name: "png", width: 4000, height: 3000, pix_fmt: "rgba", r_frame_rate: "0/0", avg_frame_rate: "0/0" }],
			format: {}
		});
		expect(probe.frameRate).toBeNull();
		expect(probe.width).toBe(4000);
		expect(probe.hasAlpha).toBe(true);
	});
});

describe("濾鏡組裝", () => {
	it("只縮小不放大且維持長寬比", () => {
		expect(downscaleFilter(1920, 1080)).toBe("scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
	});

	it("來源低於上限時不降影格率", () => {
		expect(fpsFilter(30, 30)).toBeNull();
		expect(fpsFilter(29.97, 30)).toBeNull();
		expect(fpsFilter(null, 30)).toBeNull();
		expect(fpsFilter(60, 30)).toBe("fps=30");
	});

	it("略過空的濾鏡", () => {
		expect(buildFilterChain(["fps=30", null, "scale=1:1"])).toBe("fps=30,scale=1:1");
	});
});

const binaries = binariesFromEnv();
let ffmpegReady = false;
let workDir = "";

beforeAll(async () => {
	ffmpegReady = await ffmpegAvailable(binaries);
	if (!ffmpegReady) {
		announceSkip("跳過 FFmpeg 整合測試：找不到可執行的 ffmpeg 或 ffprobe");
		return;
	}
	workDir = await makeTempDir("huan-ffmpeg-test-");
});

afterAll(async () => {
	if (workDir) await removeTempDir(workDir);
});

describe("FFmpeg 實際執行", () => {
	it("正確讀出生成檔案的規格", async ({ skip }) => {
		if (!ffmpegReady) return skip();
		const fixture = join(workDir, "probe.mp4");
		await generateVideo(binaries, fixture, { size: "1280x720", rate: 30, durationSeconds: 2, withAudio: true });

		const probe = await ffprobe(binaries, fixture);
		expect(probe.width).toBe(1280);
		expect(probe.height).toBe(720);
		expect(probe.videoCodec).toBe("h264");
		expect(probe.audioCodec).toBe("aac");
		expect(probe.frameRate).toBeCloseTo(30, 1);
		expect(probe.durationMs).toBeGreaterThanOrEqual(1900);
		expect(probe.durationMs).toBeLessThanOrEqual(2200);
		expect(probe.hasAlpha).toBe(false);
	});

	it("失敗時帶回 stderr 尾端，但訊息本身不含路徑", async ({ skip }) => {
		if (!ffmpegReady) return skip();
		const missing = join(workDir, "does-not-exist.mp4");
		const output = join(workDir, "never.mp4");

		const error = await runFfmpeg(binaries, ["-hide_banner", "-loglevel", "error", "-y", "-i", missing, output]).catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(FfmpegError);
		const ffmpegError = error as FfmpegError;
		expect(ffmpegError.stderrTail.length).toBeGreaterThan(0);
		expect(ffmpegError.message).not.toContain(workDir);
	});

	it("檔名裡的 shell 特殊字元不會被執行", async ({ skip }) => {
		if (!ffmpegReady) return skip();
		const hostile = join(workDir, "a; touch pwned.mp4");
		await generateVideo(binaries, hostile, { size: "160x120", rate: 10, durationSeconds: 1, withAudio: false });

		const probe = await ffprobe(binaries, hostile);
		expect(probe.width).toBe(160);

		const entries = await readdir(workDir);
		expect(entries).not.toContain("pwned.mp4");
	});
});
