import { createContext } from "@/context";
import { loadEnv, loadEnvFile } from "@/env";
import { bumpDeviceDesiredState } from "@/lib/desired-state";
import { hashPassword } from "@/lib/password";
import { deviceCredentials, devices, layoutRevisions, layouts, mediaAssets, mediaVariants, scheduleDevices, schedules, users, workerJobs } from "@huan/db";
import { LayoutDocumentSchema, type LayoutDocument, type MediaProbe, type ReportedState } from "@huan/protocol";
import { hashToken, sha256Hex } from "@huan/shared/node";
import { eq, sql, type SQL } from "drizzle-orm";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 開發用的示範資料。
 *
 * 目標是「打開 Admin 就有東西可以看」：素材有各種狀態、裝置有線上與離線、
 * 版面有草稿與已發布的差異、排程涵蓋早餐與午餐兩個時段。
 * 可以重複執行，每一列都以固定的 UUID upsert，不會愈跑愈多。
 *
 * 資料刻意分給兩個一般使用者，而最高管理員什麼都不擁有：
 * 這樣 seed 本身就是「每個人只看得到自己的東西」這條規則的示範，
 * 拿最高管理員登入會看到資源頁面直接回 403，而不是一張空表格。
 */

/**
 * `on conflict do update` 時取用「本來要插入的那一列」的值。
 *
 * 欄位名稱在這個檔案裡全部是常數字面量，因此用 `sql.raw` 組出 `excluded."col"`
 * 不會有注入問題；drizzle 目前沒有提供對應的型別化輔助函式。
 */
function excluded(columnName: string): SQL {
	return sql.raw(`excluded."${columnName}"`);
}

const ID = {
	adminUser: "00000000-0000-4000-8000-000000000001",
	editorUser: "00000000-0000-4000-8000-000000000002",
	partnerUser: "00000000-0000-4000-8000-000000000003",

	assetVideoReady: "00000000-0000-4000-8000-000000000101",
	assetImageReady: "00000000-0000-4000-8000-000000000102",
	assetVideoProcessing: "00000000-0000-4000-8000-000000000103",
	assetImageFailed: "00000000-0000-4000-8000-000000000104",
	assetVideoNeedsReupload: "00000000-0000-4000-8000-000000000105",
	assetPartnerPoster: "00000000-0000-4000-8000-000000000106",

	variantVideoReadyPlayback: "00000000-0000-4000-8000-000000000111",
	variantVideoReadyThumbnail: "00000000-0000-4000-8000-000000000112",
	variantVideoReadyPreview: "00000000-0000-4000-8000-000000000113",
	variantImageReadyPlayback: "00000000-0000-4000-8000-000000000114",
	variantImageReadyThumbnail: "00000000-0000-4000-8000-000000000115",
	variantImageReadyPreview: "00000000-0000-4000-8000-000000000116",
	variantVideoProcessingOriginal: "00000000-0000-4000-8000-000000000117",
	variantImageFailedOriginal: "00000000-0000-4000-8000-000000000118",
	variantNeedsReuploadPlayback: "00000000-0000-4000-8000-000000000119",
	variantNeedsReuploadThumbnail: "00000000-0000-4000-8000-00000000011a",
	variantPartnerPlayback: "00000000-0000-4000-8000-00000000011b",
	variantPartnerThumbnail: "00000000-0000-4000-8000-00000000011c",

	layoutMain: "00000000-0000-4000-8000-000000000201",
	layoutBreakfast: "00000000-0000-4000-8000-000000000202",
	layoutLunch: "00000000-0000-4000-8000-000000000203",
	layoutPartner: "00000000-0000-4000-8000-000000000204",
	revisionMain: "00000000-0000-4000-8000-000000000211",
	revisionBreakfast: "00000000-0000-4000-8000-000000000212",
	revisionLunch: "00000000-0000-4000-8000-000000000213",
	revisionPartner: "00000000-0000-4000-8000-000000000214",

	deviceLobby: "00000000-0000-4000-8000-000000000301",
	deviceCounter: "00000000-0000-4000-8000-000000000302",
	deviceSpare: "00000000-0000-4000-8000-000000000303",
	credentialLobby: "00000000-0000-4000-8000-000000000311",
	credentialCounter: "00000000-0000-4000-8000-000000000312",

	scheduleBreakfast: "00000000-0000-4000-8000-000000000401",
	scheduleLunch: "00000000-0000-4000-8000-000000000402",

	jobProcessing: "00000000-0000-4000-8000-000000000501"
} as const;

const FALLBACK_ADMIN_PASSWORD = "huan-dev-admin-2024";
const FALLBACK_USER_PASSWORD = "huan-dev-editor-2024";
const FALLBACK_DEVICE_SECRET_PREFIX = "huan-dev-device";

const adminPassword = process.env.HUAN_SEED_ADMIN_PASSWORD ?? FALLBACK_ADMIN_PASSWORD;
const userPassword = process.env.HUAN_SEED_USER_PASSWORD ?? FALLBACK_USER_PASSWORD;
const deviceSecretPrefix = process.env.HUAN_SEED_DEVICE_SECRET ?? FALLBACK_DEVICE_SECRET_PREFIX;
const usingFallbackSecrets = !process.env.HUAN_SEED_ADMIN_PASSWORD || !process.env.HUAN_SEED_USER_PASSWORD || !process.env.HUAN_SEED_DEVICE_SECRET;

/** 1×1 的透明 PNG。縮圖與預覽用它就夠了，不需要在 repository 裡放任何真實素材。 */
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function placeholderBytes(label: string, sizeBytes: number): Buffer {
	const seed = Buffer.from(`HUAN seed placeholder: ${label}\n`, "utf8");
	return Buffer.alloc(sizeBytes, seed);
}

/**
 * 用 FFmpeg 的 testsrc 產生一段真的可以解碼的短片。
 *
 * 「轉檔中」那筆示範素材如果放的是佔位位元組，Worker 取到工作後只會反覆
 * ffprobe 失敗然後變成「轉檔失敗」——示範資料就示範不到成功的那條路徑。
 * 系統上沒有 FFmpeg 時回傳 `null`，呼叫端會改成不排入工作。
 */
async function generateSampleVideo(): Promise<Buffer | null> {
	const output = join(tmpdir(), `huan-seed-${randomUUID()}.mp4`);
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"testsrc=duration=3:size=640x360:rate=15",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=3",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		"-movflags",
		"+faststart",
		output
	];
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: "ignore" });
			child.once("error", reject);
			child.once("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg 以代碼 ${code} 結束`))));
		});
		const bytes = await readFile(output);
		await rm(output, { force: true });
		return bytes;
	} catch {
		await rm(output, { force: true }).catch(() => {});
		return null;
	}
}

function banner(): void {
	console.log("");
	console.log("┌────────────────────────────────────────────────────────────────┐");
	console.log("│  HUAN 開發用示範資料                                            │");
	console.log("│  以下帳號、密碼與裝置憑證僅供本機開發使用。                      │");
	console.log("│  絕對不要把這份資料或這些憑證帶到正式環境。                      │");
	console.log("└────────────────────────────────────────────────────────────────┘");
	console.log("");
}

function mainDocument(published: boolean): LayoutDocument {
	return LayoutDocumentSchema.parse({
		canvas: { width: 1920, height: 1080 },
		background: { color: "#050505", imageAssetId: null, imageFit: "cover" },
		gap: 8,
		root: {
			type: "split",
			id: "split-main",
			direction: "horizontal",
			/** 70 / 30：主視覺放影片，右側細長欄放跑馬燈與公告。 */
			ratio: 0.7,
			first: {
				type: "slot",
				id: "slot-video",
				content: { type: "video", assetId: ID.assetVideoReady, fit: "cover", loop: true, muted: true, volume: 1, backgroundColor: "#000000" }
			},
			second: {
				type: "split",
				id: "split-side",
				direction: "vertical",
				ratio: 0.6,
				first: {
					type: "slot",
					id: "slot-notice",
					content: {
						type: "text",
						text: published ? "本日推薦\n手沖單品 買一送一" : "本日推薦\n手沖單品 買一送一（草稿：改版中）",
						align: "center",
						verticalAlign: "center",
						color: "#ffffff",
						backgroundColor: "#101010",
						fontSize: 64,
						fontWeight: 700,
						padding: 32
					}
				},
				second: {
					type: "slot",
					id: "slot-ticker",
					content: {
						type: "ticker",
						text: "營業時間 07:00 – 21:00 ・ 內用請於櫃檯點餐 ・ 感謝支持",
						direction: "left",
						speed: 120,
						gap: 200,
						color: "#ffd166",
						backgroundColor: "#000000",
						fontSize: 40,
						fontWeight: 500,
						padding: 16
					}
				}
			}
		}
	});
}

function mealDocument(params: { title: string; subtitle: string; accent: string; assetId: string }): LayoutDocument {
	return LayoutDocumentSchema.parse({
		canvas: { width: 1920, height: 1080 },
		background: { color: "#0b0b0b", imageAssetId: null, imageFit: "cover" },
		gap: 12,
		root: {
			type: "split",
			id: "split-meal",
			direction: "vertical",
			ratio: 0.65,
			first: {
				type: "slot",
				id: "slot-meal-image",
				content: { type: "image", assetId: params.assetId, fit: "cover", backgroundColor: "#000000" }
			},
			second: {
				type: "slot",
				id: "slot-meal-text",
				content: {
					type: "text",
					text: `${params.title}\n${params.subtitle}`,
					align: "center",
					verticalAlign: "center",
					color: params.accent,
					backgroundColor: "#111111",
					fontSize: 72,
					fontWeight: 700,
					padding: 40
				}
			}
		}
	});
}

const READY_VIDEO_PROBE: MediaProbe = {
	durationMs: 32_000,
	width: 1920,
	height: 1080,
	videoCodec: "h264",
	audioCodec: "aac",
	frameRate: 30,
	hasAlpha: false
};

const READY_IMAGE_PROBE: MediaProbe = {
	durationMs: null,
	width: 2560,
	height: 1440,
	videoCodec: null,
	audioCodec: null,
	frameRate: null,
	hasAlpha: false
};

function reportedState(params: { desiredVersion: number; revisionId: string; scheduleId: string | null; readyAssetIds: string[]; online: boolean }): ReportedState {
	return {
		desiredVersion: params.desiredVersion,
		appVersion: "0.1.0",
		protocolVersion: 1,
		platform: "linux",
		arch: "arm64",
		osVersion: "Debian GNU/Linux 12 (bookworm)",
		displays: [{ id: "HDMI-1", label: "HDMI-1", width: 1920, height: 1080, scaleFactor: 1, orientation: "landscape", primary: true }],
		currentLayoutRevisionId: params.revisionId,
		currentScheduleId: params.scheduleId,
		readyAssetIds: params.readyAssetIds,
		pendingAssetIds: [],
		diskFreeBytes: params.online ? 18_432_000_000 : 4_096_000_000,
		diskTotalBytes: 31_138_512_896,
		temperatureCelsius: params.online ? 48.2 : null,
		uptimeSeconds: params.online ? 432_000 : 0,
		lastSyncAt: new Date(Date.now() - (params.online ? 45_000 : 2 * 86_400_000)).toISOString(),
		storageError: null
	};
}

banner();

loadEnvFile();
const env = loadEnv();

/**
 * 絕不對正式資料庫下 seed。
 *
 * 這支腳本會塞入密碼公開已知的帳號與裝置憑證。誤指向 production 就等於在正式環境
 * 放了一組後門，因此在 `NODE_ENV=production` 直接中止。示範資料本來就只給本機開發。
 */
if (env.NODE_ENV === "production") {
	console.error("✗ 拒絕在 NODE_ENV=production 執行 seed：這會建立密碼公開已知的帳號與裝置憑證。");
	console.error("  seed 只給本機開發環境。");
	process.exit(1);
}

const ctx = createContext({ env });
const { db, storage } = ctx;

try {
	try {
		await storage.ensureBucket();
	} catch (error) {
		console.error("✗ 無法連上物件儲存（RustFS）。示範素材需要真實的物件才能被下載與驗證。");
		console.error("  請先執行 pnpm docker:up，再重新跑一次 seed。");
		throw error;
	}

	/* ── 使用者 ───────────────────────────────────────────────────────── */

	const adminHash = await hashPassword(adminPassword);
	const editorHash = await hashPassword(userPassword);
	const partnerHash = await hashPassword(userPassword);

	/**
	 * 三個帳號，對應三種角色關係：
	 * `admin` 只管帳號，不擁有任何資源；`editor` 是主要的示範租戶；
	 * `partner` 存在的唯一目的，是證明 `editor` 看不到別人的東西。
	 */
	await db
		.insert(users)
		.values([
			{ id: ID.adminUser, email: "admin@huan.local", username: "admin", displayName: "示範管理員", role: "super_admin", status: "active", passwordHash: adminHash },
			{ id: ID.editorUser, email: "editor@huan.local", username: "editor", displayName: "示範編輯", role: "user", status: "active", passwordHash: editorHash },
			{ id: ID.partnerUser, email: "partner@huan.local", username: "partner", displayName: "示範夥伴門市", role: "user", status: "active", passwordHash: partnerHash }
		])
		.onConflictDoUpdate({
			target: users.id,
			set: {
				email: excluded("email"),
				username: excluded("username"),
				displayName: excluded("display_name"),
				role: excluded("role"),
				status: excluded("status"),
				passwordHash: excluded("password_hash"),
				updatedAt: new Date()
			}
		});

	/* ── 素材 ─────────────────────────────────────────────────────────── */

	interface SeedVariant {
		id: string;
		assetId: string;
		role: "original" | "thumbnail" | "preview" | "playback";
		contentType: string;
		body: Buffer;
		available: boolean;
		width: number | null;
		height: number | null;
		durationMs: number | null;
	}

	/** 有 FFmpeg 時放一段真的能解碼的短片，讓「轉檔中」這筆示範素材會真的轉檔成功。 */
	const sampleVideo = await generateSampleVideo();

	const seedVariants: SeedVariant[] = [
		{
			id: ID.variantVideoReadyPlayback,
			assetId: ID.assetVideoReady,
			role: "playback",
			contentType: "video/mp4",
			body: placeholderBytes("店內形象影片 playback", 96 * 1024),
			available: true,
			width: 1920,
			height: 1080,
			durationMs: 32_000
		},
		{ id: ID.variantVideoReadyThumbnail, assetId: ID.assetVideoReady, role: "thumbnail", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{ id: ID.variantVideoReadyPreview, assetId: ID.assetVideoReady, role: "preview", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{ id: ID.variantImageReadyPlayback, assetId: ID.assetImageReady, role: "playback", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{ id: ID.variantImageReadyThumbnail, assetId: ID.assetImageReady, role: "thumbnail", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{ id: ID.variantImageReadyPreview, assetId: ID.assetImageReady, role: "preview", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{
			id: ID.variantVideoProcessingOriginal,
			assetId: ID.assetVideoProcessing,
			role: "original",
			contentType: "video/mp4",
			body: sampleVideo ?? placeholderBytes("轉檔中的影片 original", 48 * 1024),
			available: true,
			width: null,
			height: null,
			durationMs: null
		},
		{ id: ID.variantImageFailedOriginal, assetId: ID.assetImageFailed, role: "original", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: null, height: null, durationMs: null },
		/** 產物已回收：資料列留著，但 `available` 是 false，UI 才能解釋為什麼要重新上傳。 */
		{
			id: ID.variantNeedsReuploadPlayback,
			assetId: ID.assetVideoNeedsReupload,
			role: "playback",
			contentType: "video/mp4",
			body: placeholderBytes("已回收", 1024),
			available: false,
			width: 1920,
			height: 1080,
			durationMs: 15_000
		},
		{
			id: ID.variantNeedsReuploadThumbnail,
			assetId: ID.assetVideoNeedsReupload,
			role: "thumbnail",
			contentType: "image/png",
			body: ONE_PIXEL_PNG,
			available: true,
			width: 1,
			height: 1,
			durationMs: null
		},
		{ id: ID.variantPartnerPlayback, assetId: ID.assetPartnerPoster, role: "playback", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null },
		{ id: ID.variantPartnerThumbnail, assetId: ID.assetPartnerPoster, role: "thumbnail", contentType: "image/png", body: ONE_PIXEL_PNG, available: true, width: 1, height: 1, durationMs: null }
	];

	await db
		.insert(mediaAssets)
		.values([
			{
				id: ID.assetVideoReady,
				kind: "video",
				name: "店內形象影片",
				originalFilename: "brand-loop.mp4",
				contentType: "video/mp4",
				sizeBytes: 96 * 1024,
				status: "ready",
				probe: READY_VIDEO_PROBE,
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.assetImageReady,
				kind: "image",
				name: "季節餐點主視覺",
				originalFilename: "seasonal.png",
				contentType: "image/png",
				sizeBytes: ONE_PIXEL_PNG.byteLength,
				status: "ready",
				probe: READY_IMAGE_PROBE,
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.assetVideoProcessing,
				kind: "video",
				name: "新品上市預告",
				originalFilename: "teaser.mp4",
				contentType: "video/mp4",
				sizeBytes: 48 * 1024,
				status: "processing",
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.assetImageFailed,
				kind: "image",
				name: "活動海報（轉檔失敗）",
				originalFilename: "poster.png",
				contentType: "image/png",
				sizeBytes: ONE_PIXEL_PNG.byteLength,
				status: "failed",
				errorMessage: "圖片解析失敗，請確認檔案沒有損毀後重新上傳",
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.assetVideoNeedsReupload,
				kind: "video",
				name: "去年節慶影片",
				originalFilename: "festival.mp4",
				contentType: "video/mp4",
				sizeBytes: 1024,
				status: "needs_reupload",
				errorMessage: "播放版本已回收，需要重新上傳原始檔",
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.assetPartnerPoster,
				kind: "image",
				name: "夥伴門市海報",
				originalFilename: "partner-poster.png",
				contentType: "image/png",
				sizeBytes: ONE_PIXEL_PNG.byteLength,
				status: "ready",
				probe: READY_IMAGE_PROBE,
				ownerId: ID.partnerUser,
				createdBy: ID.partnerUser
			}
		])
		.onConflictDoUpdate({
			target: mediaAssets.id,
			set: {
				kind: excluded("kind"),
				name: excluded("name"),
				originalFilename: excluded("original_filename"),
				contentType: excluded("content_type"),
				sizeBytes: excluded("size_bytes"),
				status: excluded("status"),
				errorMessage: excluded("error_message"),
				probe: excluded("probe"),
				ownerId: excluded("owner_id"),
				updatedAt: new Date()
			}
		});

	for (const variant of seedVariants) {
		const objectKey = `seed/${variant.assetId}/${variant.id}`;
		if (variant.available) await storage.put(objectKey, variant.body, variant.contentType);
		await db
			.insert(mediaVariants)
			.values({
				id: variant.id,
				assetId: variant.assetId,
				role: variant.role,
				objectKey,
				contentType: variant.contentType,
				sizeBytes: variant.body.byteLength,
				sha256: sha256Hex(variant.body),
				width: variant.width,
				height: variant.height,
				durationMs: variant.durationMs,
				available: variant.available,
				removedAt: variant.available ? null : new Date()
			})
			.onConflictDoUpdate({
				target: mediaVariants.id,
				set: {
					objectKey: excluded("object_key"),
					contentType: excluded("content_type"),
					sizeBytes: excluded("size_bytes"),
					sha256: excluded("sha256"),
					width: excluded("width"),
					height: excluded("height"),
					durationMs: excluded("duration_ms"),
					available: excluded("available"),
					removedAt: excluded("removed_at")
				}
			});
	}

	/* ── 版面 ─────────────────────────────────────────────────────────── */

	/** 每個版面只引用自己擁有者的素材：發布前的檢查會把引用別人素材的版面當成「素材不存在」擋下來。 */
	const breakfastDocument = mealDocument({ title: "早餐時段", subtitle: "07:00 – 11:00　套餐現點現做", accent: "#ffd166", assetId: ID.assetImageReady });
	const lunchDocument = mealDocument({ title: "午餐時段", subtitle: "11:00 – 14:00　主餐附湯與飲品", accent: "#8ecae6", assetId: ID.assetImageReady });
	const partnerDocument = mealDocument({ title: "夥伴門市", subtitle: "另一個租戶的畫面　彼此看不到", accent: "#a0e7a0", assetId: ID.assetPartnerPoster });

	await db
		.insert(layouts)
		.values([
			{
				id: ID.layoutMain,
				name: "門市主畫面",
				description: "預設輪播：形象影片與公告",
				canvasWidth: 1920,
				canvasHeight: 1080,
				draft: mainDocument(false),
				publishedRevisionId: ID.revisionMain,
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.layoutBreakfast,
				name: "早餐時段",
				description: "上午的餐點主視覺",
				canvasWidth: 1920,
				canvasHeight: 1080,
				draft: breakfastDocument,
				publishedRevisionId: ID.revisionBreakfast,
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.layoutLunch,
				name: "午餐時段",
				description: "中午的餐點主視覺",
				canvasWidth: 1920,
				canvasHeight: 1080,
				draft: lunchDocument,
				publishedRevisionId: ID.revisionLunch,
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.layoutPartner,
				name: "夥伴門市主畫面",
				description: "另一個租戶的版面",
				canvasWidth: 1920,
				canvasHeight: 1080,
				draft: partnerDocument,
				publishedRevisionId: ID.revisionPartner,
				ownerId: ID.partnerUser,
				createdBy: ID.partnerUser
			}
		])
		.onConflictDoUpdate({
			target: layouts.id,
			set: {
				name: excluded("name"),
				description: excluded("description"),
				draft: excluded("draft"),
				publishedRevisionId: excluded("published_revision_id"),
				ownerId: excluded("owner_id"),
				updatedAt: new Date()
			}
		});

	await db
		.insert(layoutRevisions)
		.values([
			{ id: ID.revisionMain, layoutId: ID.layoutMain, revisionNumber: 1, document: mainDocument(true), note: "初版", publishedBy: ID.editorUser },
			{ id: ID.revisionBreakfast, layoutId: ID.layoutBreakfast, revisionNumber: 1, document: breakfastDocument, note: "初版", publishedBy: ID.editorUser },
			{ id: ID.revisionLunch, layoutId: ID.layoutLunch, revisionNumber: 1, document: lunchDocument, note: "初版", publishedBy: ID.editorUser },
			{ id: ID.revisionPartner, layoutId: ID.layoutPartner, revisionNumber: 1, document: partnerDocument, note: "初版", publishedBy: ID.partnerUser }
		])
		.onConflictDoUpdate({ target: layoutRevisions.id, set: { document: excluded("document"), note: excluded("note") } });

	/* ── 裝置 ─────────────────────────────────────────────────────────── */

	const now = new Date();
	const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000);

	/** 裝置全部屬於 `editor`：誰確認配對碼誰就是擁有者，而最高管理員連配對都不能做。 */
	await db
		.insert(devices)
		.values([
			{
				id: ID.deviceLobby,
				name: "門市 A ・ 大廳主螢幕",
				status: "active",
				defaultLayoutId: ID.layoutMain,
				lastSeenAt: now,
				pairedAt: new Date(now.getTime() - 30 * 86_400_000),
				ownerId: ID.editorUser,
				pairedBy: ID.editorUser
			},
			{
				id: ID.deviceCounter,
				name: "門市 B ・ 櫃檯螢幕",
				status: "active",
				defaultLayoutId: ID.layoutMain,
				lastSeenAt: twoDaysAgo,
				pairedAt: new Date(now.getTime() - 20 * 86_400_000),
				ownerId: ID.editorUser,
				pairedBy: ID.editorUser
			},
			{
				id: ID.deviceSpare,
				name: "倉庫備品機（已解除綁定）",
				status: "revoked",
				defaultLayoutId: null,
				lastSeenAt: new Date(now.getTime() - 45 * 86_400_000),
				pairedAt: new Date(now.getTime() - 60 * 86_400_000),
				ownerId: ID.editorUser,
				pairedBy: ID.editorUser
			}
		])
		.onConflictDoUpdate({
			target: devices.id,
			set: {
				name: excluded("name"),
				status: excluded("status"),
				defaultLayoutId: excluded("default_layout_id"),
				lastSeenAt: excluded("last_seen_at"),
				pairedAt: excluded("paired_at"),
				ownerId: excluded("owner_id"),
				pairedBy: excluded("paired_by"),
				updatedAt: new Date()
			}
		});

	const lobbySecret = `${deviceSecretPrefix}-lobby`;
	const counterSecret = `${deviceSecretPrefix}-counter`;
	await db
		.insert(deviceCredentials)
		.values([
			{ id: ID.credentialLobby, deviceId: ID.deviceLobby, secretHash: hashToken(lobbySecret), platform: "linux", arch: "arm64", appVersion: "0.1.0", lastUsedAt: now },
			{ id: ID.credentialCounter, deviceId: ID.deviceCounter, secretHash: hashToken(counterSecret), platform: "linux", arch: "arm64", appVersion: "0.1.0", lastUsedAt: twoDaysAgo }
		])
		.onConflictDoUpdate({
			target: deviceCredentials.id,
			set: { secretHash: excluded("secret_hash"), platform: excluded("platform"), arch: excluded("arch"), appVersion: excluded("app_version"), lastUsedAt: excluded("last_used_at"), revokedAt: null }
		});

	/* ── 排程 ─────────────────────────────────────────────────────────── */

	/**
	 * 排程的 `updatedAt` 刻意不在重跑時更新。
	 * 它會出現在 desired state 的排程清單裡，跟著重跑而改變會讓每一次 seed 都
	 * 推一個「其實什麼都沒變」的新版本給所有裝置。
	 */
	await db
		.insert(schedules)
		.values([
			{
				id: ID.scheduleBreakfast,
				name: "早餐時段",
				enabled: true,
				layoutId: ID.layoutBreakfast,
				timezone: "Asia/Taipei",
				priority: 100,
				startDate: null,
				endDate: null,
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: "08:00",
				endTime: "11:00",
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			},
			{
				id: ID.scheduleLunch,
				name: "午餐時段",
				enabled: true,
				layoutId: ID.layoutLunch,
				timezone: "Asia/Taipei",
				priority: 100,
				startDate: null,
				endDate: null,
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: "11:00",
				endTime: "14:00",
				ownerId: ID.editorUser,
				createdBy: ID.editorUser
			}
		])
		.onConflictDoUpdate({
			target: schedules.id,
			set: {
				name: excluded("name"),
				enabled: excluded("enabled"),
				layoutId: excluded("layout_id"),
				timezone: excluded("timezone"),
				priority: excluded("priority"),
				daysOfWeek: excluded("days_of_week"),
				startTime: excluded("start_time"),
				endTime: excluded("end_time"),
				ownerId: excluded("owner_id")
			}
		});

	await db.delete(scheduleDevices).where(eq(scheduleDevices.scheduleId, ID.scheduleBreakfast));
	await db.delete(scheduleDevices).where(eq(scheduleDevices.scheduleId, ID.scheduleLunch));
	/** 排程與裝置同屬 `editor`；`ownerId` 同時參與兩條複合外鍵，跨擁有者的指派在資料庫層就寫不進去。 */
	await db.insert(scheduleDevices).values([
		{ scheduleId: ID.scheduleBreakfast, deviceId: ID.deviceLobby, ownerId: ID.editorUser },
		{ scheduleId: ID.scheduleBreakfast, deviceId: ID.deviceCounter, ownerId: ID.editorUser },
		{ scheduleId: ID.scheduleLunch, deviceId: ID.deviceLobby, ownerId: ID.editorUser },
		{ scheduleId: ID.scheduleLunch, deviceId: ID.deviceCounter, ownerId: ID.editorUser }
	]);

	/* ── 背景工作 ─────────────────────────────────────────────────────── */

	/**
	 * 只有在放進去的是真的影片時才排入轉檔工作。
	 *
	 * 對佔位位元組排工作，Worker 只會 ffprobe 失敗三次然後把素材標成「轉檔失敗」；
	 * 那不是示範，那是製造一筆看起來像故障的資料。
	 */
	if (sampleVideo) {
		await db
			.insert(workerJobs)
			.values({ id: ID.jobProcessing, kind: "transcode_video", status: "pending", assetId: ID.assetVideoProcessing, payload: { assetId: ID.assetVideoProcessing }, maxAttempts: 3 })
			.onConflictDoUpdate({ target: workerJobs.id, set: { status: "pending", attempt: 0, error: null, updatedAt: new Date() } });
	} else {
		await db.delete(workerJobs).where(eq(workerJobs.id, ID.jobProcessing));
	}

	/* ── 目標狀態 ─────────────────────────────────────────────────────── */

	const lobbyBump = await bumpDeviceDesiredState(ctx, ID.deviceLobby);
	const counterBump = await bumpDeviceDesiredState(ctx, ID.deviceCounter);

	await db
		.update(devices)
		.set({ reportedState: reportedState({ desiredVersion: lobbyBump.version, revisionId: ID.revisionMain, scheduleId: null, readyAssetIds: [ID.assetVideoReady, ID.assetImageReady], online: true }) })
		.where(eq(devices.id, ID.deviceLobby));
	await db
		.update(devices)
		.set({ reportedState: reportedState({ desiredVersion: Math.max(0, counterBump.version - 1), revisionId: ID.revisionMain, scheduleId: null, readyAssetIds: [ID.assetVideoReady], online: false }) })
		.where(eq(devices.id, ID.deviceCounter));

	console.log("✓ 示範資料已寫入。");
	console.log("");
	console.log("  使用者");
	console.log(`    admin@huan.local    / ${adminPassword}   （super_admin：只管帳號與稽核紀錄，不擁有任何資源）`);
	console.log(`    editor@huan.local   / ${userPassword}   （user：5 個涵蓋各種狀態的素材、3 個版面、3 台裝置、2 個排程）`);
	console.log(`    partner@huan.local  / ${userPassword}   （user：另一個租戶，只有 1 個素材與 1 個版面）`);
	console.log("");
	console.log("  用 admin 登入時，素材、版面、排程與裝置都會回 403；那是預期行為，不是壞掉。");
	console.log("  用 editor 或 partner 登入，各自只會看到自己的那一份。");
	console.log("");
	console.log("  裝置憑證（Authorization: Bearer <deviceId>.<secret>），兩台都屬於 editor");
	console.log(`    大廳主螢幕：${ID.deviceLobby}.${lobbySecret}`);
	console.log(`    櫃檯螢幕：  ${ID.deviceCounter}.${counterSecret}`);
	console.log("");
	if (sampleVideo) {
		console.log("  「轉檔中」的示範影片是 FFmpeg 產生的真實短片，Worker 啟動後會真的完成轉檔。");
	} else {
		console.log("  系統上找不到 FFmpeg，因此沒有排入轉檔工作，該筆素材會停在「處理中」。");
	}
	console.log("  已就緒的影片素材在 RustFS 裡是佔位檔：可以完成下載與 SHA-256 驗證，但不是真的能播放的影片。");
	console.log("  需要真實影片時請從 Admin 上傳，走完整的轉檔流程。");
	if (usingFallbackSecrets) {
		console.log("");
		console.log("  ⚠ 有部分密碼或憑證使用內建的開發預設值。");
		console.log("    設定 HUAN_SEED_ADMIN_PASSWORD、HUAN_SEED_USER_PASSWORD 與 HUAN_SEED_DEVICE_SECRET 可以覆蓋。");
		console.log("    這份資料只能用在本機開發環境。");
	}
	console.log("");
} finally {
	await ctx.close();
}
