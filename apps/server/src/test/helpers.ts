import { buildServer, type HuanServer } from "@/app";
import { createContext, type AppContext } from "@/context";
import { loadEnv, loadEnvFile } from "@/env";
import { hashPassword } from "@/lib/password";
import { createDatabase, mediaAssets, mediaVariants, users } from "@huan/db";
import { API_PREFIX, LayoutDocumentSchema, type LayoutDocument } from "@huan/protocol";
import { sha256Hex } from "@huan/shared/node";
import { randomUUID } from "node:crypto";

loadEnvFile();

/** 整合測試會清空資料表，因此絕對不能對著 production 的資料庫跑。 */
if (process.env.NODE_ENV === "production") {
	throw new Error("整合測試不能在 NODE_ENV=production 下執行");
}

const TABLES = [
	"audit_logs",
	"auth_challenges",
	"device_credentials",
	"device_pairing_codes",
	"layout_revisions",
	"login_attempts",
	"media_device_sync",
	"media_variants",
	"schedule_devices",
	"sessions",
	"totp_credentials",
	"totp_recovery_codes",
	"worker_jobs",
	"schedules",
	"devices",
	"layouts",
	"media_assets",
	"users"
] as const;

export interface EnvironmentStatus {
	ready: boolean;
	reason: string;
}

/**
 * 檢查測試環境是否可用。
 *
 * 缺少 PostgreSQL 或 RustFS 時測試會 `describe.skip` 並印出原因，
 * 而不是靠 mock 假裝通過——一個永遠會綠的整合測試比沒有測試更危險。
 */
export async function checkEnvironment(): Promise<EnvironmentStatus> {
	let env;
	try {
		env = loadEnv();
	} catch (error) {
		return { ready: false, reason: `環境變數不完整：${(error as Error).message}` };
	}

	const handle = createDatabase({ url: env.DATABASE_URL, max: 1 });
	try {
		await handle.sql`select 1`;
	} catch (error) {
		await handle.close().catch(() => {});
		return { ready: false, reason: `連不上 PostgreSQL（${env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@")}）：${(error as Error).message}` };
	}
	await handle.close();

	try {
		const response = await fetch(env.S3_ENDPOINT, { method: "GET" });
		/** RustFS 對匿名的根路徑請求回 403 是正常的，代表服務有在聽。 */
		if (response.status >= 500) return { ready: false, reason: `RustFS 回應 ${response.status}` };
	} catch (error) {
		return { ready: false, reason: `連不上 RustFS（${env.S3_ENDPOINT}）：${(error as Error).message}` };
	}

	return { ready: true, reason: "" };
}

export interface TestHarness {
	app: HuanServer;
	ctx: AppContext;
	url(path: string): string;
	truncate(): Promise<void>;
	close(): Promise<void>;
}

export async function createHarness(): Promise<TestHarness> {
	const env = loadEnv();
	const ctx = createContext({ env });
	const app = await buildServer({
		env,
		context: ctx,
		logger: false,
		/** 節流本身有獨立的測試；其他測試不該因為請求打得比較密就變成紅的。 */
		rateLimits: { global: 100_000, auth: 100_000, pairing: 100_000 }
	});
	await app.ready();

	return {
		app,
		ctx,
		url: path => `${API_PREFIX}${path}`,
		async truncate() {
			await ctx.sql.unsafe(`truncate table ${TABLES.join(", ")} restart identity cascade`);
		},
		async close() {
			await app.close();
			await ctx.close();
		}
	};
}

export interface SeededUser {
	id: string;
	email: string;
	username: string;
	password: string;
}

export async function createUser(
	harness: TestHarness,
	overrides: Partial<{ email: string; username: string; displayName: string; password: string; role: "super_admin" | "user"; status: "active" | "disabled" }> = {}
): Promise<SeededUser> {
	const suffix = Math.random().toString(36).slice(2, 8);
	const email = overrides.email ?? `user-${suffix}@huan.test`;
	const username = overrides.username ?? `user${suffix}`;
	const password = overrides.password ?? "integration-test-password";

	const [row] = await harness.ctx.db
		.insert(users)
		.values({
			email,
			username,
			displayName: overrides.displayName ?? `測試使用者 ${suffix}`,
			role: overrides.role ?? "user",
			status: overrides.status ?? "active",
			passwordHash: await hashPassword(password)
		})
		.returning({ id: users.id });
	if (!row) throw new Error("建立測試使用者失敗");

	return { id: row.id, email, username, password };
}

/** 登入並回傳可以直接放進 `cookie` 標頭的字串。 */
export async function login(harness: TestHarness, identifier: string, password: string): Promise<string> {
	const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier, password } });
	if (response.statusCode !== 200) throw new Error(`登入失敗（${response.statusCode}）：${response.body}`);
	const cookie = extractSessionCookie(response.headers["set-cookie"]);
	if (!cookie) throw new Error("登入回應沒有帶 session cookie");
	return cookie;
}

export function extractSessionCookie(setCookie: string | string[] | number | undefined): string | null {
	if (setCookie === undefined || typeof setCookie === "number") return null;
	const values = Array.isArray(setCookie) ? setCookie : [setCookie];
	for (const value of values) {
		const [pair] = value.split(";");
		if (pair?.startsWith("huan_session=")) return pair;
	}
	return null;
}

export interface ReadyAsset {
	assetId: string;
	variantId: string;
	sha256: string;
	sizeBytes: number;
	objectKey: string;
}

/**
 * 建立一個「已就緒」的素材，包含實際存在於 RustFS 的播放產物。
 *
 * 直接寫資料庫而不是走轉檔流程：Worker 不在這個 app 的測試範圍內，
 * 但派送需要一份雜湊對得上的真實物件，否則裝置端的驗證測試沒有意義。
 *
 * `ownerId` 是必填而不是給個預設值：素材一定屬於某個人，讓呼叫端非講不可，
 * 才不會寫出「不知道是誰的素材」這種在產品裡不存在的狀態。
 */
export async function createReadyAsset(harness: TestHarness, ownerId: string, kind: "video" | "image" = "video", name = "測試素材"): Promise<ReadyAsset> {
	const assetId = randomUUID();
	const variantId = randomUUID();
	const contentType = kind === "video" ? "video/mp4" : "image/png";
	const body = Buffer.from(`huan-test-${kind}-${variantId}`, "utf8");
	const objectKey = `test/${assetId}/${variantId}`;

	await harness.ctx.storage.put(objectKey, body, contentType);
	await harness.ctx.db.insert(mediaAssets).values({
		id: assetId,
		kind,
		name,
		originalFilename: `${name}.${kind === "video" ? "mp4" : "png"}`,
		contentType,
		sizeBytes: body.byteLength,
		status: "ready",
		ownerId,
		createdBy: ownerId
	});
	await harness.ctx.db.insert(mediaVariants).values({
		id: variantId,
		assetId,
		role: "playback",
		objectKey,
		contentType,
		sizeBytes: body.byteLength,
		sha256: sha256Hex(body),
		available: true
	});

	return { assetId, variantId, sha256: sha256Hex(body), sizeBytes: body.byteLength, objectKey };
}

/** 版面文件：單一區塊放一支影片或一張圖，剛好夠測試素材引用與派送。 */
export function singleAssetDocument(assetId: string, kind: "video" | "image" = "video"): LayoutDocument {
	return LayoutDocumentSchema.parse({
		canvas: { width: 1920, height: 1080 },
		background: { color: "#000000", imageAssetId: null, imageFit: "cover" },
		gap: 0,
		root: {
			type: "slot",
			id: "slot-root",
			content:
				kind === "video"
					? { type: "video", assetId, fit: "contain", loop: true, muted: true, volume: 1, backgroundColor: "#000000" }
					: { type: "image", assetId, fit: "contain", backgroundColor: "#000000" }
		}
	});
}

export interface PairedDevice {
	deviceId: string;
	credential: string;
	authorization: string;
}

/** 走完整的配對流程取得一台可以自我驗證的裝置。 */
export async function pairDevice(harness: TestHarness, cookie: string, deviceName = "測試裝置", defaultLayoutId: string | null = null): Promise<PairedDevice> {
	const started = await harness.app.inject({
		method: "POST",
		url: harness.url("/device/pairing/start"),
		payload: { deviceName, platform: "linux", arch: "arm64", appVersion: "0.1.0", protocolVersion: 1 }
	});
	const { code, pairingToken } = started.json();

	const confirmed = await harness.app.inject({ method: "POST", url: harness.url("/pairing/confirm"), headers: { cookie }, payload: { code, deviceName, defaultLayoutId } });
	if (confirmed.statusCode !== 201) throw new Error(`配對失敗（${confirmed.statusCode}）：${confirmed.body}`);

	const status = await harness.app.inject({ method: "GET", url: harness.url("/device/pairing/status"), headers: { "x-huan-pairing-token": pairingToken } });
	const credential: string = status.json().credential;
	return { deviceId: confirmed.json().id, credential, authorization: `Bearer ${credential}` };
}

export interface TenantFixture {
	user: SeededUser;
	cookie: string;
	asset: ReadyAsset;
	layoutId: string;
	revisionId: string;
	deviceId: string;
	scheduleId: string;
}

/**
 * 一個完整的租戶：一位一般使用者，加上他自己的素材、版面、裝置與排程。
 *
 * 隔離測試需要的是「兩份長得一樣但屬於不同人的資料」，每個測試各自手刻一遍
 * 只會讓斷言被建立資料的雜訊淹沒；而且一律走 API 建立，順便保證擁有者是
 * 伺服器自己從 session 推出來的，不是測試硬塞進資料庫的。
 */
export async function createTenant(harness: TestHarness, label: string): Promise<TenantFixture> {
	const user = await createUser(harness, { role: "user" });
	const cookie = await login(harness, user.email, user.password);
	const asset = await createReadyAsset(harness, user.id, "image", `${label}的素材`);

	const layout = await harness.app.inject({
		method: "POST",
		url: harness.url("/layouts"),
		headers: { cookie },
		payload: { name: `${label}的版面`, description: null, canvas: { width: 1920, height: 1080 } }
	});
	if (layout.statusCode !== 201) throw new Error(`建立版面失敗（${layout.statusCode}）：${layout.body}`);
	const layoutId: string = layout.json().id;

	const draft = await harness.app.inject({
		method: "PATCH",
		url: harness.url(`/layouts/${layoutId}`),
		headers: { cookie },
		payload: { draft: singleAssetDocument(asset.assetId, "image") }
	});
	if (draft.statusCode !== 200) throw new Error(`更新草稿失敗（${draft.statusCode}）：${draft.body}`);

	const published = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
	if (published.statusCode !== 201) throw new Error(`發布版面失敗（${published.statusCode}）：${published.body}`);
	const revisionId: string = published.json().id;

	const device = await pairDevice(harness, cookie, `${label}的裝置`, layoutId);

	const schedule = await harness.app.inject({
		method: "POST",
		url: harness.url("/schedules"),
		headers: { cookie },
		payload: scheduleBody({ name: `${label}的排程`, layoutId, deviceIds: [device.deviceId] })
	});
	if (schedule.statusCode !== 201) throw new Error(`建立排程失敗（${schedule.statusCode}）：${schedule.body}`);

	return { user, cookie, asset, layoutId, revisionId, deviceId: device.deviceId, scheduleId: schedule.json().id };
}

/** 排程的請求主體欄位很多且全部必填，測試只關心其中兩三個，其餘給固定值。 */
export function scheduleBody(params: { name: string; layoutId: string; deviceIds: readonly string[] }): Record<string, unknown> {
	return {
		name: params.name,
		enabled: true,
		layoutId: params.layoutId,
		timezone: "Asia/Taipei",
		priority: 100,
		startDate: null,
		endDate: null,
		daysOfWeek: [1, 2, 3, 4, 5],
		startTime: "11:00",
		endTime: "14:00",
		deviceIds: [...params.deviceIds]
	};
}
