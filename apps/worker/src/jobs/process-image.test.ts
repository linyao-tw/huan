import { buildImageRenditionArgs, imageFormatFor, processImage } from "@/jobs/process-image";
import type { TestHarness } from "@/test-support";
import { announceSkip, createHarness, ffmpegAvailable, generateImage, loadAssetRow, loadVariants, makeTempDir, probeStreams, removeTempDir, runJobHandler, seedAsset } from "@/test-support";
import { sha256File } from "@huan/shared/node";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let harness: TestHarness | null = null;
let workDir = "";

beforeAll(async () => {
	const result = await createHarness();
	if (!result.ok) {
		announceSkip(`跳過圖片處理測試：${result.reason}`);
		return;
	}
	if (!(await ffmpegAvailable(result.harness.binaries))) {
		announceSkip("跳過圖片處理測試：找不到可執行的 ffmpeg 或 ffprobe");
		await result.harness.cleanup();
		return;
	}
	harness = result.harness;
	workDir = await makeTempDir("huan-image-test-");
});

afterAll(async () => {
	if (workDir) await removeTempDir(workDir);
	if (harness) await harness.cleanup();
});

async function processFixture(active: TestHarness, name: string, options: { size: string; alpha?: boolean }): Promise<string> {
	const fixture = join(workDir, `${name}.png`);
	await generateImage(active.binaries, fixture, { size: options.size, alpha: options.alpha });
	const seeded = await seedAsset(active, { kind: "image", contentType: "image/png", filePath: fixture, extension: ".png" });
	await runJobHandler(active, { kind: "process_image", assetId: seeded.assetId, handler: processImage });
	return seeded.assetId;
}

describe("圖片輸出格式", () => {
	it("有 alpha 才輸出 PNG，其餘一律 JPEG", () => {
		expect(imageFormatFor(true)).toEqual({ extension: ".png", contentType: "image/png", alpha: true });
		expect(imageFormatFor(false).contentType).toBe("image/jpeg");
		expect(imageFormatFor(null).contentType).toBe("image/jpeg");
	});

	it("縮放濾鏡只縮不放且維持長寬比", () => {
		const args = buildImageRenditionArgs({ sourcePath: "in.png", outputPath: "out.jpg", maxWidth: 1920, maxHeight: 1080, alpha: false });
		expect(args.join(" ")).toContain("force_original_aspect_ratio=decrease");
		expect(args.join(" ")).toContain("min(1920,iw)");
		expect(args).toContain("yuvj420p");
	});
});

describe("process_image 端對端", () => {
	it("把 4000×3000 的來源縮到 1080p 以內並維持長寬比", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await processFixture(active, "oversized", { size: "4000x3000" });

		const asset = await loadAssetRow(active, assetId);
		expect(asset.status).toBe("ready");
		expect(asset.probe).toMatchObject({ width: 4000, height: 3000, durationMs: null });

		const variants = await loadVariants(active, assetId);
		const playback = variants.get("playback");
		const preview = variants.get("preview");
		const thumbnail = variants.get("thumbnail");

		expect(playback?.width).toBe(1440);
		expect(playback?.height).toBe(1080);
		expect((playback?.width ?? 0) / (playback?.height ?? 1)).toBeCloseTo(4000 / 3000, 2);
		expect(preview?.width).toBe(1280);
		expect(preview?.height).toBe(960);
		expect(thumbnail?.width).toBe(640);
		expect(thumbnail?.height).toBe(480);
		expect(playback?.contentType).toBe("image/jpeg");
		expect(playback?.objectKey).toMatch(/^distribution\/[0-9a-f-]{36}\.jpg$/);

		const original = variants.get("original");
		expect(original?.available).toBe(false);
		expect(await active.storage.head(original!.objectKey)).toBeNull();

		const downloaded = join(workDir, "downloaded-playback.jpg");
		await active.storage.downloadToFile(playback!.objectKey, downloaded);
		expect(await sha256File(downloaded)).toBe(playback?.sha256);
		const streams = await probeStreams(active.binaries, downloaded);
		expect(streams[0].codec_name).toBe("mjpeg");
		expect(streams[0].width).toBe(1440);
	});

	it("小圖不會被放大", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await processFixture(active, "small", { size: "320x240" });

		const variants = await loadVariants(active, assetId);
		expect(variants.get("playback")?.width).toBe(320);
		expect(variants.get("playback")?.height).toBe(240);
		expect(variants.get("thumbnail")?.width).toBe(320);
	});

	it("有透明度的來源保留 alpha，不會被壓成黑底", async ({ skip }) => {
		if (!harness) return skip();
		const active = harness;
		const assetId = await processFixture(active, "alpha", { size: "800x600", alpha: true });

		const variants = await loadVariants(active, assetId);
		const playback = variants.get("playback");
		expect(playback?.contentType).toBe("image/png");
		expect(playback?.objectKey).toMatch(/\.png$/);

		const downloaded = join(workDir, "downloaded-alpha.png");
		await active.storage.downloadToFile(playback!.objectKey, downloaded);
		const streams = await probeStreams(active.binaries, downloaded);
		expect(streams[0].codec_name).toBe("png");
		expect(streams[0].pix_fmt).toMatch(/rgba|ya|argb/);
	});
});
