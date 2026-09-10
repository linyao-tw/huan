import type { FfmpegBinaries } from "@/ffmpeg";
import { runFfmpeg } from "@/ffmpeg";
import type { JobHandler } from "@/jobs/types";
import type { WorkerLogger } from "@/logger";
import { createLogger } from "@/logger";
import { ObjectStorage } from "@/storage";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "@huan/config";
import { loadWorkerEnv } from "@huan/config";
import type { Database } from "@huan/db";
import { createDatabase, mediaAssets, mediaVariants, users, workerJobs } from "@huan/db";
import type { MediaKind, WorkerJobKind } from "@huan/protocol";
import { sql } from "drizzle-orm";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

type Connection = ReturnType<typeof createDatabase>;

export interface TestHarness {
	env: WorkerEnv;
	db: Database;
	sql: Connection["sql"];
	storage: ObjectStorage;
	logger: WorkerLogger;
	binaries: FfmpegBinaries;
	trackAsset: (assetId: string) => void;
	trackDevice: (deviceId: string) => void;
	/**
	 * 測試素材與裝置的擁有者。
	 *
	 * 資源表的 `ownerId` 是 NOT NULL，所以連 worker 的測試夾具都得先有一個帳號。
	 * 每個 harness 建一個自己的，測試之間才不會互相看到對方的東西。
	 */
	ownerId: string;
	cleanup: () => Promise<void>;
}

export type HarnessResult = { ok: true; harness: TestHarness } | { ok: false; reason: string };

async function commandWorks(binary: string, args: readonly string[]): Promise<boolean> {
	return new Promise(resolve => {
		const child = spawn(binary, [...args], { shell: false, stdio: "ignore" });
		child.on("error", () => resolve(false));
		child.on("close", code => resolve(code === 0));
	});
}

/** 缺 FFmpeg 時測試要跳過而不是失敗，但必須印出原因，不能假裝通過。 */
export async function ffmpegAvailable(binaries: FfmpegBinaries): Promise<boolean> {
	const [ffmpeg, ffprobe] = await Promise.all([commandWorks(binaries.ffmpegPath, ["-version"]), commandWorks(binaries.ffprobePath, ["-version"])]);
	return ffmpeg && ffprobe;
}

export function binariesFromEnv(): FfmpegBinaries {
	return { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe" };
}

/**
 * 建立整合測試需要的環境。
 *
 * 任何一項外部服務缺席就回傳 `ok: false` 與可讀的原因；原因字串刻意不含
 * `DATABASE_URL` 或金鑰，測試輸出同樣不該外洩憑證。
 */
export async function createHarness(): Promise<HarnessResult> {
	let env: WorkerEnv;
	try {
		env = loadWorkerEnv();
	} catch {
		return { ok: false, reason: "Worker 環境變數不完整（需要 DATABASE_URL 與 S3_* 設定）" };
	}

	let connection: Connection;
	try {
		connection = createDatabase({ url: env.DATABASE_URL, max: 6 });
		await connection.sql`select 1`;
	} catch {
		return { ok: false, reason: "無法連線 PostgreSQL，請先執行 pnpm docker:up" };
	}

	const admin = new S3Client({
		endpoint: env.S3_ENDPOINT,
		region: env.S3_REGION,
		forcePathStyle: env.S3_FORCE_PATH_STYLE,
		credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
	});
	try {
		await admin.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
	} catch {
		try {
			await admin.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
		} catch {
			admin.destroy();
			await connection.close();
			return { ok: false, reason: "無法連線 RustFS，請先執行 pnpm docker:up" };
		}
	}
	admin.destroy();

	const storage = new ObjectStorage(env);
	const assets: string[] = [];
	const devices: string[] = [];

	/* 密碼雜湊欄位不能是 null，但這個帳號永遠不會登入，放一個明顯不是雜湊的字串。 */
	const suffix = randomUUID();
	const owner = await connection.db
		.insert(users)
		.values({
			email: `worker-fixture+${suffix}@huan.invalid`,
			username: `worker-fixture-${suffix}`,
			displayName: "Worker 測試夾具",
			passwordHash: "not-a-login-account"
		})
		.returning({ id: users.id });
	const ownerId = owner[0]!.id;

	const harness: TestHarness = {
		env,
		db: connection.db,
		sql: connection.sql,
		storage,
		logger: createLogger("silent"),
		binaries: binariesFromEnv(),
		trackAsset: assetId => assets.push(assetId),
		trackDevice: deviceId => devices.push(deviceId),
		ownerId,
		cleanup: async () => {
			for (const assetId of assets) {
				const keys = await connection.db
					.select({ objectKey: mediaVariants.objectKey })
					.from(mediaVariants)
					.where(sql`${mediaVariants.assetId} = ${assetId}`);
				for (const { objectKey } of keys) await storage.deleteObject(objectKey).catch(() => {});
				await connection.db.delete(mediaAssets).where(sql`${mediaAssets.id} = ${assetId}`);
			}
			for (const deviceId of devices) await connection.db.execute(sql`delete from devices where id = ${deviceId}`);
			/* 擁有者最後刪：ownerId 是 restrict，名下還有資料的帳號刪不掉。 */
			await connection.db.delete(users).where(sql`${users.id} = ${ownerId}`);
			storage.destroy();
			await connection.close();
		}
	};

	return { ok: true, harness };
}

/**
 * 印出跳過的原因。
 *
 * 直接寫 stderr 而不是用 `console.warn`：vitest 的 console 攔截在這個設定下不會把
 * hook 裡的輸出印出來，而「缺環境就安靜地全部跳過」跟假裝通過沒有兩樣。
 */
export function announceSkip(reason: string): void {
	process.stderr.write(`SKIP: ${reason}\n`);
}

export async function makeTempDir(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

export interface GeneratedVideoOptions {
	size: string;
	rate: number;
	durationSeconds: number;
	withAudio: boolean;
	pattern?: "testsrc" | "smptebars";
}

/** 測試素材一律當場用 lavfi 產生，repository 裡不放任何二進位媒體檔。 */
export async function generateVideo(binaries: FfmpegBinaries, outputPath: string, options: GeneratedVideoOptions): Promise<void> {
	const pattern = options.pattern ?? "testsrc";
	const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `${pattern}=duration=${options.durationSeconds}:size=${options.size}:rate=${options.rate}`];
	if (options.withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${options.durationSeconds}`);
	args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
	if (options.withAudio) args.push("-c:a", "aac", "-b:a", "96k", "-shortest");
	args.push("-f", "mp4", outputPath);
	await runFfmpeg(binaries, args);
}

export async function generateImage(binaries: FfmpegBinaries, outputPath: string, options: { size: string; color?: string; alpha?: boolean }): Promise<void> {
	const color = options.color ?? "red";
	const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=${options.size}`, "-frames:v", "1"];
	if (options.alpha) args.push("-vf", "format=yuva420p,colorchannelmixer=aa=0.5", "-pix_fmt", "rgba");
	args.push(outputPath);
	await runFfmpeg(binaries, args);
}

export interface SeededAsset {
	assetId: string;
	originalKey: string;
}

export async function seedAsset(harness: TestHarness, options: { kind: MediaKind; contentType: string; filePath: string; filename?: string; extension: string }): Promise<SeededAsset> {
	const originalKey = harness.storage.objectKeyFor("original", options.extension);
	await harness.storage.uploadFile(originalKey, options.filePath, options.contentType);
	const info = await stat(options.filePath);

	const inserted = await harness.db
		.insert(mediaAssets)
		.values({
			kind: options.kind,
			name: `測試素材 ${options.kind}`,
			originalFilename: options.filename ?? `fixture${options.extension}`,
			contentType: options.contentType,
			sizeBytes: info.size,
			status: "uploaded",
			ownerId: harness.ownerId
		})
		.returning({ id: mediaAssets.id });

	const assetId = inserted[0]!.id;
	harness.trackAsset(assetId);

	await harness.db.insert(mediaVariants).values({
		assetId,
		role: "original",
		objectKey: originalKey,
		contentType: options.contentType,
		sizeBytes: info.size,
		available: true
	});

	return { assetId, originalKey };
}

export async function enqueueJob(harness: TestHarness, options: { kind: WorkerJobKind; assetId?: string; maxAttempts?: number }): Promise<string> {
	const rows = await harness.db
		.insert(workerJobs)
		.values({
			kind: options.kind,
			assetId: options.assetId ?? null,
			maxAttempts: options.maxAttempts ?? 3
		})
		.returning({ id: workerJobs.id });
	return rows[0]!.id;
}

export interface VariantSnapshot {
	id: string;
	role: string;
	objectKey: string;
	contentType: string;
	sizeBytes: number;
	sha256: string | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
	available: boolean;
	removedAt: Date | null;
}

export async function loadVariants(harness: TestHarness, assetId: string): Promise<Map<string, VariantSnapshot>> {
	const rows = await harness.db
		.select({
			id: mediaVariants.id,
			role: mediaVariants.role,
			objectKey: mediaVariants.objectKey,
			contentType: mediaVariants.contentType,
			sizeBytes: mediaVariants.sizeBytes,
			sha256: mediaVariants.sha256,
			width: mediaVariants.width,
			height: mediaVariants.height,
			durationMs: mediaVariants.durationMs,
			available: mediaVariants.available,
			removedAt: mediaVariants.removedAt
		})
		.from(mediaVariants)
		.where(sql`${mediaVariants.assetId} = ${assetId}`);
	return new Map(rows.map(row => [row.role, row]));
}

export async function loadAssetRow(harness: TestHarness, assetId: string): Promise<{ status: string; errorMessage: string | null; probe: unknown }> {
	const rows = await harness.db
		.select({ status: mediaAssets.status, errorMessage: mediaAssets.errorMessage, probe: mediaAssets.probe })
		.from(mediaAssets)
		.where(sql`${mediaAssets.id} = ${assetId}`);
	return rows[0];
}

/** 直接執行 handler，不經過 runner。個別 job 的行為與佇列的重試邏輯要能分開驗證。 */
export async function runJobHandler(harness: TestHarness, options: { kind: WorkerJobKind; assetId: string | null; handler: JobHandler }): Promise<void> {
	const workDir = await makeTempDir("huan-job-test-");
	try {
		await options.handler({
			db: harness.db,
			storage: harness.storage,
			binaries: harness.binaries,
			env: harness.env,
			logger: harness.logger,
			job: { id: randomUUID(), kind: options.kind, assetId: options.assetId, payload: {}, attempt: 1, maxAttempts: 3 },
			workDir
		});
	} finally {
		await removeTempDir(workDir);
	}
}

const RawStreamSchema = z.object({
	codec_type: z.string().optional(),
	codec_name: z.string().optional(),
	profile: z.string().optional(),
	level: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	pix_fmt: z.string().optional(),
	r_frame_rate: z.string().optional(),
	avg_frame_rate: z.string().optional()
});

export type RawStream = z.infer<typeof RawStreamSchema>;

/** 斷言需要看到 pix_fmt、profile 這些 `MediaProbe` 沒有保留的欄位。 */
export async function probeStreams(binaries: FfmpegBinaries, filePath: string): Promise<RawStream[]> {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn(binaries.ffprobePath, ["-v", "quiet", "-print_format", "json", "-show_streams", filePath], { shell: false, stdio: ["ignore", "pipe", "ignore"] });
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", reject);
		child.on("close", () => resolve(stdout));
	});
	return z.object({ streams: z.array(RawStreamSchema).default([]) }).parse(JSON.parse(output)).streams;
}

/**
 * `-movflags +faststart` 會把 moov box 搬到 mdat 前面，播放端才不用先下載整支影片。
 * 直接看兩個 box 在檔案裡的先後順序就能驗證。
 */
export async function hasFastStart(filePath: string): Promise<boolean> {
	const content = await readFile(filePath);
	const moov = content.indexOf("moov", 0, "latin1");
	const mdat = content.indexOf("mdat", 0, "latin1");
	return moov >= 0 && mdat >= 0 && moov < mdat;
}

export async function seedDevice(harness: TestHarness, name: string): Promise<string> {
	const rows = await harness.db.execute<{ id: string }>(sql`insert into devices (name, owner_id) values (${name}, ${harness.ownerId}) returning id`);
	const deviceId = rows[0]!.id;
	harness.trackDevice(deviceId);
	return deviceId;
}
