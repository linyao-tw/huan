import type { AuditAction, DesiredState, LayoutDocument, MediaProbe, ReportedState } from "@huan/protocol";
import { relations, sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const now = sql`now()`;

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now)
};

/* ── 帳號與登入 ───────────────────────────────────────────────────────── */

export const users = pgTable(
	"users",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		email: text("email").notNull(),
		username: text("username").notNull(),
		displayName: text("display_name").notNull(),
		/** Argon2id 的 PHC 字串。系統中沒有任何地方保存明文密碼。 */
		passwordHash: text("password_hash").notNull(),
		role: text("role").$type<"super_admin" | "user">().notNull().default("user"),
		status: text("status").$type<"active" | "disabled">().notNull().default("active"),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		...timestamps
	},
	table => [uniqueIndex("users_email_key").on(table.email), uniqueIndex("users_username_key").on(table.username)]
);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/**
		 * Session token 的 SHA-256。資料庫外洩時拿不到可用的 token，
		 * 而且 cookie 裡的值本身不帶任何資訊，撤銷只要刪掉這一列。
		 */
		tokenHash: text("token_hash").notNull(),
		userAgent: text("user_agent"),
		ipAddress: text("ip_address"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [uniqueIndex("sessions_token_hash_key").on(table.tokenHash), index("sessions_user_id_idx").on(table.userId)]
);

/** 通過密碼但還沒完成 2FA 的中繼狀態。這個 token 不能存取任何 API。 */
export const authChallenges = pgTable(
	"auth_challenges",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		userAgent: text("user_agent"),
		ipAddress: text("ip_address"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [uniqueIndex("auth_challenges_token_hash_key").on(table.tokenHash)]
);

export const totpCredentials = pgTable(
	"totp_credentials",
	{
		userId: uuid("user_id")
			.primaryKey()
			.references(() => users.id, { onDelete: "cascade" }),
		/** Base32 的 TOTP 密鑰。不會出現在任何 API 回應或日誌中。 */
		secret: text("secret").notNull(),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		/** 上一次成功驗證的時間步長，用來擋下同一組驗證碼的重放。 */
		lastUsedStep: bigint("last_used_step", { mode: "number" }),
		...timestamps
	},
	table => [index("totp_credentials_confirmed_idx").on(table.confirmedAt)]
);

export const totpRecoveryCodes = pgTable(
	"totp_recovery_codes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** 只保存雜湊。復原碼在產生當下顯示一次，之後任何人都無法還原。 */
		codeHash: text("code_hash").notNull(),
		usedAt: timestamp("used_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [index("totp_recovery_codes_user_id_idx").on(table.userId), uniqueIndex("totp_recovery_codes_hash_key").on(table.codeHash)]
);

/** 登入嘗試紀錄。以帳號與來源 IP 為單位做節流，重啟 Server 不會清空。 */
export const loginAttempts = pgTable(
	"login_attempts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		identifier: text("identifier").notNull(),
		ipAddress: text("ip_address"),
		successful: boolean("successful").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [index("login_attempts_identifier_idx").on(table.identifier, table.createdAt), index("login_attempts_ip_idx").on(table.ipAddress, table.createdAt)]
);

/* ── 素材 ─────────────────────────────────────────────────────────────── */

export const mediaAssets = pgTable(
	"media_assets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		kind: text("kind").$type<"video" | "image" | "html">().notNull(),
		name: text("name").notNull(),
		originalFilename: text("original_filename").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		status: text("status").$type<"uploading" | "uploaded" | "processing" | "ready" | "failed" | "needs_reupload">().notNull().default("uploading"),
		errorMessage: text("error_message"),
		probe: jsonb("probe").$type<MediaProbe>(),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		...timestamps
	},
	table => [index("media_assets_status_idx").on(table.status), index("media_assets_kind_idx").on(table.kind), index("media_assets_created_at_idx").on(table.createdAt)]
);

export const mediaVariants = pgTable(
	"media_variants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		assetId: uuid("asset_id")
			.notNull()
			.references(() => mediaAssets.id, { onDelete: "cascade" }),
		role: text("role").$type<"original" | "thumbnail" | "preview" | "playback">().notNull(),
		/** RustFS 中的物件鍵。一律由 UUID 組成，永遠不使用使用者提供的檔名。 */
		objectKey: text("object_key").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		sha256: text("sha256"),
		width: integer("width"),
		height: integer("height"),
		durationMs: integer("duration_ms"),
		/** 物件被回收後轉為 false；資料列留著，讓 UI 能解釋素材為什麼需要重新上傳。 */
		available: boolean("available").notNull().default(true),
		/** 所有目標裝置都完成 ACK 的時間，保留期從這一刻起算。 */
		distributionSettledAt: timestamp("distribution_settled_at", { withTimezone: true }),
		removedAt: timestamp("removed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [uniqueIndex("media_variants_asset_role_key").on(table.assetId, table.role), index("media_variants_available_idx").on(table.available)]
);

/** 每台裝置對每個播放產物的同步狀態。ACK 之後才算真的送達。 */
export const mediaDeviceSync = pgTable(
	"media_device_sync",
	{
		deviceId: uuid("device_id")
			.notNull()
			.references(() => devices.id, { onDelete: "cascade" }),
		variantId: uuid("variant_id")
			.notNull()
			.references(() => mediaVariants.id, { onDelete: "cascade" }),
		assetId: uuid("asset_id")
			.notNull()
			.references(() => mediaAssets.id, { onDelete: "cascade" }),
		status: text("status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
		sha256: text("sha256"),
		sizeBytes: bigint("size_bytes", { mode: "number" }),
		desiredVersion: integer("desired_version").notNull().default(0),
		error: text("error"),
		downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
		...timestamps
	},
	table => [primaryKey({ columns: [table.deviceId, table.variantId] }), index("media_device_sync_variant_idx").on(table.variantId), index("media_device_sync_status_idx").on(table.status)]
);

/* ── 版面與排程 ───────────────────────────────────────────────────────── */

export const layouts = pgTable(
	"layouts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		description: text("description"),
		canvasWidth: integer("canvas_width").notNull(),
		canvasHeight: integer("canvas_height").notNull(),
		/** 尚未發布的編輯中版本。Device 永遠看不到草稿。 */
		draft: jsonb("draft").$type<LayoutDocument>().notNull(),
		publishedRevisionId: uuid("published_revision_id"),
		draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().default(now),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		...timestamps
	},
	table => [index("layouts_created_at_idx").on(table.createdAt)]
);

/** 每次發布都是一筆不可變的修訂。Device 的目標狀態指向修訂 id，而不是版面 id。 */
export const layoutRevisions = pgTable(
	"layout_revisions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		layoutId: uuid("layout_id")
			.notNull()
			.references(() => layouts.id, { onDelete: "cascade" }),
		revisionNumber: integer("revision_number").notNull(),
		document: jsonb("document").$type<LayoutDocument>().notNull(),
		note: text("note"),
		publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
		publishedAt: timestamp("published_at", { withTimezone: true }).notNull().default(now)
	},
	table => [uniqueIndex("layout_revisions_layout_number_key").on(table.layoutId, table.revisionNumber)]
);

export const schedules = pgTable(
	"schedules",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		layoutId: uuid("layout_id")
			.notNull()
			.references(() => layouts.id, { onDelete: "cascade" }),
		/** IANA 時區。排程的判定完全以此為準，不使用 Server 或 Device 的本機時區。 */
		timezone: text("timezone").notNull(),
		priority: integer("priority").notNull().default(100),
		startDate: text("start_date"),
		endDate: text("end_date"),
		/** 0 = 星期日。以 smallint 陣列存放，查詢時直接比對。 */
		daysOfWeek: smallint("days_of_week").array().notNull(),
		startTime: text("start_time").notNull(),
		endTime: text("end_time").notNull(),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		...timestamps
	},
	table => [index("schedules_layout_idx").on(table.layoutId), index("schedules_enabled_idx").on(table.enabled)]
);

export const scheduleDevices = pgTable(
	"schedule_devices",
	{
		scheduleId: uuid("schedule_id")
			.notNull()
			.references(() => schedules.id, { onDelete: "cascade" }),
		deviceId: uuid("device_id")
			.notNull()
			.references(() => devices.id, { onDelete: "cascade" })
	},
	table => [primaryKey({ columns: [table.scheduleId, table.deviceId] }), index("schedule_devices_device_idx").on(table.deviceId)]
);

/* ── 裝置 ─────────────────────────────────────────────────────────────── */

export const devices = pgTable(
	"devices",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		status: text("status").$type<"active" | "revoked">().notNull().default("active"),
		defaultLayoutId: uuid("default_layout_id").references(() => layouts.id, { onDelete: "set null" }),
		/** 每次目標狀態有任何變化就 +1。Device 用它判斷自己是不是落後了。 */
		desiredVersion: integer("desired_version").notNull().default(0),
		desiredState: jsonb("desired_state").$type<DesiredState>(),
		reportedState: jsonb("reported_state").$type<ReportedState>(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		pairedAt: timestamp("paired_at", { withTimezone: true }),
		pairedBy: uuid("paired_by").references(() => users.id, { onDelete: "set null" }),
		...timestamps
	},
	table => [index("devices_status_idx").on(table.status), index("devices_last_seen_idx").on(table.lastSeenAt)]
);

export const deviceCredentials = pgTable(
	"device_credentials",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deviceId: uuid("device_id")
			.notNull()
			.references(() => devices.id, { onDelete: "cascade" }),
		/** 憑證的 SHA-256。每台裝置各自獨立，撤銷單一裝置不影響其他裝置。 */
		secretHash: text("secret_hash").notNull(),
		platform: text("platform").$type<"linux" | "win32" | "darwin" | "unknown">().notNull().default("unknown"),
		arch: text("arch").$type<"x64" | "arm64" | "arm" | "unknown">().notNull().default("unknown"),
		appVersion: text("app_version"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [uniqueIndex("device_credentials_secret_hash_key").on(table.secretHash), index("device_credentials_device_idx").on(table.deviceId)]
);

export const devicePairingCodes = pgTable(
	"device_pairing_codes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		code: text("code").notNull(),
		/** 只有持有這個 token 的裝置能領取配對結果，猜到配對碼也搶不走憑證。 */
		pairingTokenHash: text("pairing_token_hash").notNull(),
		deviceName: text("device_name").notNull(),
		platform: text("platform").$type<"linux" | "win32" | "darwin" | "unknown">().notNull().default("unknown"),
		arch: text("arch").$type<"x64" | "arm64" | "arm" | "unknown">().notNull().default("unknown"),
		appVersion: text("app_version").notNull().default(""),
		protocolVersion: integer("protocol_version").notNull().default(1),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		/** 配對完成後填入；同一組配對碼不可能用第二次。 */
		claimedDeviceId: uuid("claimed_device_id").references(() => devices.id, { onDelete: "cascade" }),
		claimedCredential: text("claimed_credential"),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [
		uniqueIndex("device_pairing_codes_code_key").on(table.code),
		uniqueIndex("device_pairing_codes_token_key").on(table.pairingTokenHash),
		index("device_pairing_codes_expires_idx").on(table.expiresAt)
	]
);

/* ── 背景工作 ─────────────────────────────────────────────────────────── */

export const workerJobs = pgTable(
	"worker_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		kind: text("kind").$type<"transcode_video" | "process_image" | "process_html" | "cleanup_distribution">().notNull(),
		status: text("status").$type<"pending" | "running" | "success" | "failed">().notNull().default("pending"),
		assetId: uuid("asset_id").references(() => mediaAssets.id, { onDelete: "cascade" }),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
		attempt: integer("attempt").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(3),
		error: text("error"),
		/** 失敗重試的退避時間。Worker 只挑 `run_after <= now()` 的工作。 */
		runAfter: timestamp("run_after", { withTimezone: true }).notNull().default(now),
		lockedBy: text("locked_by"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		...timestamps
	},
	table => [index("worker_jobs_queue_idx").on(table.status, table.runAfter), index("worker_jobs_asset_idx").on(table.assetId)]
);

/* ── 稽核 ─────────────────────────────────────────────────────────────── */

export const auditLogs = pgTable(
	"audit_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		action: text("action").$type<AuditAction>().notNull(),
		actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		actorLabel: text("actor_label"),
		actorDeviceId: uuid("actor_device_id").references(() => devices.id, { onDelete: "set null" }),
		targetType: text("target_type"),
		targetId: text("target_id"),
		targetLabel: text("target_label"),
		ipAddress: text("ip_address"),
		/** 絕不寫入密碼、TOTP 密鑰、復原碼、session token 或裝置憑證。 */
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now)
	},
	table => [index("audit_logs_created_at_idx").on(table.createdAt), index("audit_logs_action_idx").on(table.action), index("audit_logs_actor_idx").on(table.actorUserId)]
);

/* ── 關聯 ─────────────────────────────────────────────────────────────── */

export const usersRelations = relations(users, ({ many, one }) => ({
	sessions: many(sessions),
	totp: one(totpCredentials, { fields: [users.id], references: [totpCredentials.userId] }),
	recoveryCodes: many(totpRecoveryCodes)
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ many, one }) => ({
	variants: many(mediaVariants),
	creator: one(users, { fields: [mediaAssets.createdBy], references: [users.id] })
}));

export const mediaVariantsRelations = relations(mediaVariants, ({ one, many }) => ({
	asset: one(mediaAssets, { fields: [mediaVariants.assetId], references: [mediaAssets.id] }),
	deviceSync: many(mediaDeviceSync)
}));

export const layoutsRelations = relations(layouts, ({ many }) => ({
	revisions: many(layoutRevisions),
	schedules: many(schedules)
}));

export const layoutRevisionsRelations = relations(layoutRevisions, ({ one }) => ({
	layout: one(layouts, { fields: [layoutRevisions.layoutId], references: [layouts.id] })
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
	layout: one(layouts, { fields: [schedules.layoutId], references: [layouts.id] }),
	targets: many(scheduleDevices)
}));

export const scheduleDevicesRelations = relations(scheduleDevices, ({ one }) => ({
	schedule: one(schedules, { fields: [scheduleDevices.scheduleId], references: [schedules.id] }),
	device: one(devices, { fields: [scheduleDevices.deviceId], references: [devices.id] })
}));

export const devicesRelations = relations(devices, ({ many, one }) => ({
	credentials: many(deviceCredentials),
	scheduleTargets: many(scheduleDevices),
	defaultLayout: one(layouts, { fields: [devices.defaultLayoutId], references: [layouts.id] })
}));
