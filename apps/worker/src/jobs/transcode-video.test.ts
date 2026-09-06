import { parseFrameRate } from "@/ffmpeg";
import { buildVideoRenditionArgs, thumbnailSeekSeconds, transcodeVideo } from "@/jobs/transcode-video";
import type { TestHarness } from "@/test-support";
import {
	announceSkip,
	createHarness,
	ffmpegAvailable,
	generateVideo,
	hasFastStart,
	loadAssetRow,
	loadVariants,
	makeTempDir,
	probeStreams,
	removeTempDir,
	runJobHandler,
	seedAsset
} from "@/test-support";
import { sha256File } from "@huan/shared/node";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let harness: TestHarness | null = null;
let workDir = "";

beforeAll(async () => {
	const result = await createHarness();
	if (!result.ok) {
		announceSkip(`跳過影片轉檔測試：${result.reason}`);
		return;
	}
	if (!(await ffmpegAvailable(result.harness.binaries))) {
		announceSkip("跳過影片轉檔測試：找不到可執行的 ffmpeg 或 ffprobe");
		await result.harness.cleanup();
		return;
	}
	harness = result.harness;
	workDir = await makeTempDir("huan-video-test-");
});

afterAll(async () => {
	if (workDir) await removeTempDir(workDir);
	if (harness) await harness.cleanup();
});

async function transcodeFixture(active: TestHarness, name: string, options: { size: string; rate: number; withAudio: boolean }): Promise<string> {
	const fixture = join(workDir, `${name}.mp4`);
	await generateVideo(active.binaries, fixture, { size: options.size, rate: options.rate, durationSeconds: 2, withAudio: options.withAudio });
	const seeded = await seedAsset(active, { kind: "video", contentType: "video/mp4", filePath: fixture, extension: ".mp4" });
	await runJobHandler(active, { kind: "transcode_video", assetId: seeded.assetId, handler: transcodeVideo });
	return seeded.assetId;
}

describe("轉檔參數", () => {
	it("沒有音軌時輸出 -an，不會硬要編碼不存在的聲音", () => {
		const args = buildVideoRenditionArgs({
			sourcePath: "in.mp4",
			outputPath: "out.mp4",
			maxWidth: 1920,
			maxHeight: 1080,
			fpsCap: 30,
			sourceFrameRate: 25,
			hasAudio: false,
			videoOptions: ["-profile:v", "high"],
			audioBitrate: "128k"
		});
		expect(args).toContain("-an");
		expect(args).not.toContain("-c:a");
		expect(args.join(" ")).not.toContain("fps=30");
		expect(args).toContain("+faststart");
	});

	it("來源超過影格上限時才加上 fps 濾鏡", () => {
		const args = buildVideoRenditionArgs({
			sourcePath: "in.mp4",
			outputPath: "out.mp4",
			maxWidth: 1920,
			maxHeight: 1080,
			fpsCap: 30,
			sourceFrameRate: 60,
			hasAudio: true,
			videoOptions: [],
			audioBitrate: "128k"
		});
		expect(args.join(" ")).toContain("fps=30,scale=");
		expect(args).toContain("-c:a");
	});

	it("很短的影片直接取第一格", () => {
		expect(thumbnailSeekSeconds(null)).toBe(0);
		expect(thumbnailSeekSeconds(1500)).toBe(0);
		expect(thumbnailSeekSeconds(30_000)).toBeCloseTo(3, 3);
	});
});

describe("transcode_video 端對端", () => {
	it("產生三種產物、刪除原始檔並把素材標成 ready", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await transcodeFixture(active, "standard", { size: "1280x720", rate: 30, withAudio: true });

		const asset = await loadAssetRow(active, assetId);
		expect(asset.status).toBe("ready");
		expect(asset.errorMessage).toBeNull();
		expect(asset.probe).toMatchObject({ width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac" });

		const variants = await loadVariants(active, assetId);
		const playback = variants.get("playback");
		const preview = variants.get("preview");
		const thumbnail = variants.get("thumbnail");
		expect(playback).toBeDefined();
		expect(preview).toBeDefined();
		expect(thumbnail).toBeDefined();

		/** 物件鍵一律是 UUID，永遠不含使用者的檔名。 */
		expect(playback?.objectKey).toMatch(/^distribution\/[0-9a-f-]{36}\.mp4$/);
		expect(preview?.objectKey).toMatch(/^preview\/[0-9a-f-]{36}\.mp4$/);
		expect(thumbnail?.objectKey).toMatch(/^thumbnail\/[0-9a-f-]{36}\.jpg$/);

		const original = variants.get("original");
		expect(original?.available).toBe(false);
		expect(original?.removedAt).not.toBeNull();
		expect(await active.storage.head(original!.objectKey)).toBeNull();

		const downloaded = join(workDir, "downloaded-playback.mp4");
		await active.storage.downloadToFile(playback!.objectKey, downloaded);
		expect(await sha256File(downloaded)).toBe(playback?.sha256);
		expect(await hasFastStart(downloaded)).toBe(true);

		const streams = await probeStreams(active.binaries, downloaded);
		const video = streams.find(stream => stream.codec_type === "video");
		const audio = streams.find(stream => stream.codec_type === "audio");
		expect(video?.codec_name).toBe("h264");
		expect(video?.pix_fmt).toBe("yuv420p");
		expect(video?.profile).toBe("High");
		expect(video?.width).toBeLessThanOrEqual(1920);
		expect(video?.height).toBeLessThanOrEqual(1080);
		expect(parseFrameRate(video?.r_frame_rate) ?? 0).toBeLessThanOrEqual(30);
		expect(audio?.codec_name).toBe("aac");

		expect(playback?.width).toBe(1280);
		expect(playback?.height).toBe(720);
		expect(playback?.durationMs ?? 0).toBeGreaterThan(1500);
		expect((thumbnail?.width ?? 0) <= 640).toBe(true);
		expect((preview?.width ?? 0) <= 854).toBe(true);
		expect((preview?.height ?? 0) <= 480).toBe(true);
	});

	it("超過上限的來源會被縮到 1080p30 並維持長寬比", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await transcodeFixture(active, "oversized", { size: "2560x1440", rate: 60, withAudio: false });

		const variants = await loadVariants(active, assetId);
		const playback = variants.get("playback");
		expect(playback?.width).toBe(1920);
		expect(playback?.height).toBe(1080);

		const downloaded = join(workDir, "downloaded-oversized.mp4");
		await active.storage.downloadToFile(playback!.objectKey, downloaded);
		const streams = await probeStreams(active.binaries, downloaded);
		const video = streams.find(stream => stream.codec_type === "video");
		expect(parseFrameRate(video?.avg_frame_rate) ?? 0).toBeLessThanOrEqual(30.1);
		/** 沒有音軌的來源不能因為 `-c:a aac` 就失敗。 */
		expect(streams.filter(stream => stream.codec_type === "audio")).toHaveLength(0);
	});

	it("小於上限的來源不會被放大", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await transcodeFixture(active, "small", { size: "640x360", rate: 24, withAudio: false });

		const variants = await loadVariants(active, assetId);
		expect(variants.get("playback")?.width).toBe(640);
		expect(variants.get("playback")?.height).toBe(360);
		/** preview 的上限是 854×480，640×360 同樣不該被放大。 */
		expect(variants.get("preview")?.width).toBe(640);
		expect(variants.get("preview")?.height).toBe(360);
	});
});
