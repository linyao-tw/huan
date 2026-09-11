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
 * 主機名指向內網、loopback、link-local 或雲端 metadata 位址時擋下來。
 *
 * 這個網址會被放進裝置與後台的 iframe。放行內部位址等於讓有版面編輯權的人（或被
 * 盜用的帳號）叫所有裝置去載入客戶內網的服務，iframe 內的腳本就能以裝置的網路
 * 視角探測內網——一種 client-side SSRF。這裡擋的是「字面上就是內部位址」的情況：
 * IP 字面值與明顯的內部主機名。真正解析到內網的網域（DNS rebinding）需要另一層
 * 伺服器端的解析後檢查，不在 schema 能做的範圍內。
 */
/** 四個八位元組是否落在 loopback / 私有 / link-local / 未指定 / CGNAT 範圍。 */
function ipv4IsInternal(a: number, b: number): boolean {
	if (a === 127 || a === 10 || a === 0) return true;
	if (a === 169 && b === 254) return true; // link-local，含雲端 metadata 169.254.169.254
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	return false;
}

/**
 * 把 IPv6 字面值展開成 8 組 16-bit，處理 `::` 壓縮；不是合法 IPv6 就回 null。
 *
 * 展開之後才能可靠地判斷內嵌 IPv4（`::x.x.x.x`、NAT64）落在哪個範圍——單靠字串
 * 前綴比對會漏掉 `[::127.0.0.1]`（正規化成 `::7f00:1`）這類寫法。
 */
function expandIpv6(host: string): number[] | null {
	const bare = host.split("%")[0] ?? host; // 去掉 zone id
	if (!bare.includes(":")) return null;
	const halves = bare.split("::");
	if (halves.length > 2) return null;

	const parse = (part: string): number[] | null => {
		if (part === "") return [];
		const out: number[] = [];
		for (const group of part.split(":")) {
			if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
			out.push(parseInt(group, 16));
		}
		return out;
	};

	const head = parse(halves[0] ?? "");
	const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
	if (head === null || tail === null) return null;

	const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail] : head;
	return groups.length === 8 ? groups : null;
}

function hostLooksInternal(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
	if (host === "metadata.google.internal") return true;

	// IPv4 字面值
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (v4) return ipv4IsInternal(Number(v4[1]), Number(v4[2]));

	const g = expandIpv6(host);
	if (g) {
		if (g.every(part => part === 0)) return true; // ::（未指定）
		if (g.slice(0, 7).every(part => part === 0) && g[7] === 1) return true; // ::1（loopback）
		if ((g[0]! & 0xfe00) === 0xfc00) return true; // 唯一本地 fc00::/7
		if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10

		/*
		 * 內嵌 IPv4：IPv4-mapped ::ffff:0:0/96、IPv4-compatible ::/96、NAT64 64:ff9b::/96。
		 * 這三種都把 IPv4 放在低 32 bit，取出來套同一組內網判斷。
		 */
		const mapped = g[4] === 0 && g[5] === 0xffff && g.slice(0, 4).every(part => part === 0);
		const compatible = g.slice(0, 6).every(part => part === 0);
		const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(part => part === 0);
		if (mapped || compatible || nat64) {
			// 低 32 bit 是內嵌的 IPv4：a.b 在第 7 組，c.d 在第 8 組；內網判斷只看前兩個八位元組。
			return ipv4IsInternal(g[6]! >> 8, g[6]! & 0xff);
		}
	}

	return false;
}

/**
 * 可嵌入 iframe 的外部網址。
 * 只允許 http/https，拒絕內嵌憑證與指向內網／metadata 的位址。
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
		if (hostLooksInternal(parsed.hostname)) return false;
		return true;
	}, "只接受不含帳號密碼、且不指向內部網路的 http 或 https 網址");

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
