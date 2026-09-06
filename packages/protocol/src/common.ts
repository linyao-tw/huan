import { z } from "zod";

/** HTTP API 的版本前綴。所有 REST 端點都掛在這個 prefix 底下。 */
export const API_PREFIX = "/api/v1";

/**
 * Device 與 Server 之間的通訊協定版本。
 * Device 在 WebSocket handshake 與 heartbeat 回報此值，Server 用它判斷相容性。
 */
export const PROTOCOL_VERSION = 1;

/** 資料庫主鍵一律使用 UUID v4 字串。 */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** ISO 8601 時間字串（UTC）。JSON 傳輸一律使用字串而非 Date 物件。 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** `YYYY-MM-DD`，不含時間與時區的日曆日期。 */
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");
export type CalendarDateString = z.infer<typeof CalendarDateSchema>;

/** `HH:MM`，24 小時制的當地時刻。 */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間格式必須是 HH:MM");
export type ClockTimeString = z.infer<typeof ClockTimeSchema>;

/**
 * IANA 時區名稱，例如 `Asia/Taipei`。
 * 排程一律以此時區計算，不使用 Server 或 Device 的本機時區。
 */
export const TimeZoneSchema = z
	.string()
	.min(1)
	.max(64)
	.refine(value => {
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: value });
			return true;
		} catch {
			return false;
		}
	}, "必須是有效的 IANA 時區名稱");
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/** SHA-256 摘要，64 個小寫十六進位字元。 */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "必須是 64 位小寫十六進位的 SHA-256 值");
export type Sha256 = z.infer<typeof Sha256Schema>;

/** CSS 色彩字串。限制為 hex 與 rgb()/rgba()，避免使用者輸入任意 CSS。 */
export const ColorSchema = z
	.string()
	.regex(/^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/, "必須是 #RGB、#RRGGBB、#RRGGBBAA 或 rgb()/rgba() 色彩");
export type Color = z.infer<typeof ColorSchema>;

/**
 * 可嵌入 iframe 的外部網址。
 * 只允許 http/https，並拒絕內嵌憑證，避免把帳密寫進版面設定。
 */
export const ExternalUrlSchema = z
	.url()
	.max(2048)
	.refine(value => {
		let parsed: URL;
		try {
			parsed = new URL(value);
		} catch {
			return false;
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		if (parsed.username !== "" || parsed.password !== "") return false;
		return true;
	}, "只接受不含帳號密碼的 http 或 https 網址");

export const PaginationQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginatedSchema<Item extends z.ZodTypeAny>(item: Item) {
	return z.object({
		items: z.array(item),
		total: z.number().int().min(0),
		limit: z.number().int().min(1),
		offset: z.number().int().min(0)
	});
}

/** 所有錯誤回應共用的結構。`code` 是穩定的機器可讀識別字，`message` 是使用者可讀的繁體中文說明。 */
export const ApiErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional()
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof OkSchema>;
