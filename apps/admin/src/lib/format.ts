const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFormatter = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
const relativeFormatter = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });

export function formatDateTime(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateFormatter.format(date);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60 * 1000],
	["month", 30 * 24 * 60 * 60 * 1000],
	["day", 24 * 60 * 60 * 1000],
	["hour", 60 * 60 * 1000],
	["minute", 60 * 1000]
];

/** 「3 分鐘前」比絕對時間更容易判斷裝置是不是還活著，因此清單一律用相對時間。 */
export function formatRelativeTime(value: string | null | undefined, now: number = Date.now()): string {
	if (!value) return "從未";
	const timestamp = new Date(value).getTime();
	if (Number.isNaN(timestamp)) return "—";
	const diff = timestamp - now;
	const absolute = Math.abs(diff);
	if (absolute < 45_000) return "剛剛";
	for (const [unit, milliseconds] of RELATIVE_UNITS) {
		if (absolute >= milliseconds) return relativeFormatter.format(Math.round(diff / milliseconds), unit);
	}
	return relativeFormatter.format(Math.round(diff / 1000), "second");
}

export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
	if (!width || !height) return "—";
	return `${width} × ${height}`;
}

export function formatPercent(value: number, fractionDigits = 0): string {
	return `${(value * 100).toFixed(fractionDigits)}%`;
}

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function formatWeekdays(days: readonly number[]): string {
	if (days.length === 7) return "每天";
	const sorted = [...days].sort((a, b) => a - b);
	return sorted.map(day => WEEKDAY_LABELS[day] ?? "?").join("、");
}
