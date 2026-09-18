import { z } from "zod";

const booleanish = z.union([z.boolean(), z.string()]).transform(value => (typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())));

/** RustFS 以 S3 相容 API 提供服務，因此設定名稱沿用 S3 的慣例。 */
const StorageSchema = z.object({
	S3_ENDPOINT: z.url(),
	/**
	 * 瀏覽器與 Device 實際連得到的位址。
	 * Docker 內部走 `http://rustfs:9000`，但簽章網址要交給外部使用者，
	 * 這兩個值不同時就得分開設定，否則簽出來的網址在容器外連不上。
	 */
	S3_PUBLIC_ENDPOINT: z.url().optional(),
	S3_REGION: z.string().min(1).default("us-east-1"),
	S3_BUCKET: z.string().min(1).default("huan"),
	S3_ACCESS_KEY_ID: z.string().min(1),
	S3_SECRET_ACCESS_KEY: z.string().min(1),
	S3_FORCE_PATH_STYLE: booleanish.default(true)
});

const CommonSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
	DATABASE_URL: z.string().min(1, "必須設定 DATABASE_URL")
});

export const ServerEnvSchema = CommonSchema.extend(StorageSchema.shape).extend({
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().min(1).max(65535).default(4000),
	/** Admin 與 Device 看到的對外網址，用於組出配對連結與簽章網址。 */
	PUBLIC_URL: z.url().default("http://localhost:4000"),
	/** 允許的瀏覽器來源，逗號分隔。開發時 Vite 跑在另一個埠，因此預設放行 5173。 */
	CORS_ORIGINS: z
		.string()
		.default("http://localhost:5173")
		.transform(value =>
			value
				.split(",")
				.map(origin => origin.trim())
				.filter(Boolean)
		),
	/**
	 * 要信任的反向代理，決定 `request.ip` 從哪裡取。
	 *
	 * 預設 `false`：只採信實際 socket 來源，不看 `X-Forwarded-For`。速率限制與登入
	 * 節流都以這個 IP 為鍵，若無條件信任 XFF，攻擊者每次換一個假 XFF 就能重置計數。
	 * 部署在反向代理後面時，設成代理的跳數（例如 `1`）或它的 IP/CIDR，只信任那一層。
	 */
	TRUST_PROXY: z.string().default("false"),
	/**
	 * 加密 TOTP 密鑰用的金鑰，base64 編碼的 32 bytes。
	 *
	 * 其餘長期祕密都經過雜湊，但 TOTP 密鑰驗證時需要原值，只能加密而不能雜湊。金鑰
	 * 存在伺服器（環境變數 / KMS），不入庫；資料庫外洩時光有密文換不出一次性碼。
	 * production 一定要設；開發環境沒設就用一把固定的測試金鑰，並在啟動時警告。
	 */
	TOTP_SECRET_KEY: z.string().optional(),
	SESSION_COOKIE_NAME: z.string().default("huan_session"),
	SESSION_TTL_HOURS: z.coerce
		.number()
		.int()
		.min(1)
		.max(24 * 90)
		.default(24 * 14),
	/** production 一律送出 `Secure` cookie；在沒有 TLS 的本機開發環境才關閉。 */
	SESSION_COOKIE_SECURE: booleanish.optional(),
	TOTP_ISSUER: z.string().min(1).default("HUAN"),
	LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
	LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(300),
	/** 簽章下載網址的有效時間。夠 Device 下載完一支影片，又短到撿到網址也用不了多久。 */
	SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
	DEVICE_HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
	DEVICE_FALLBACK_SYNC_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
	DEVICE_MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().min(1).max(8).default(3),
	/** 設定後，Server 會直接靜態服務 Admin 的 production build。 */
	ADMIN_DIST_DIR: z.string().optional()
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export const WorkerEnvSchema = CommonSchema.extend(StorageSchema.shape).extend({
	WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
	WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
	WORKER_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
	/** Worker 沒有對外 API，這個埠只用來提供容器編排需要的存活探針。 */
	WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
	FFMPEG_PATH: z.string().default("ffmpeg"),
	FFPROBE_PATH: z.string().default("ffprobe"),
	/** 轉檔的暫存目錄。留空時使用作業系統的暫存目錄。 */
	WORKER_TMP_DIR: z.string().optional()
});
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export class EnvValidationError extends Error {
	constructor(public readonly issues: readonly string[]) {
		super(`環境變數設定不正確：\n${issues.map(issue => `  - ${issue}`).join("\n")}`);
		this.name = "EnvValidationError";
	}
}

function parseEnv<Schema extends z.ZodType>(schema: Schema, source: Record<string, string | undefined>): z.infer<Schema> {
	const result = schema.safeParse(source);
	if (!result.success) {
		throw new EnvValidationError(result.error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
	}
	return result.data;
}

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
	return parseEnv(ServerEnvSchema, source);
}

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
	return parseEnv(WorkerEnvSchema, source);
}

/** production 預設要求 Secure cookie，開發環境沒有 TLS 時才自動放行。 */
export function shouldUseSecureCookie(env: Pick<ServerEnv, "NODE_ENV" | "SESSION_COOKIE_SECURE">): boolean {
	return env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === "production";
}

/** 對外簽章網址使用的主機。沒有另外設定時就沿用內部端點。 */
export function publicStorageEndpoint(env: Pick<ServerEnv, "S3_ENDPOINT" | "S3_PUBLIC_ENDPOINT">): string {
	return env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
}
