/** 台灣客戶佔絕大多數，把 `Asia/Taipei` 放第一位可以省掉每次建立排程都要搜尋一次。 */
export const CURATED_TIME_ZONES = [
	"Asia/Taipei",
	"Asia/Hong_Kong",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Asia/Seoul",
	"Asia/Singapore",
	"Asia/Bangkok",
	"Asia/Kuala_Lumpur",
	"Asia/Manila",
	"Australia/Sydney",
	"Europe/London",
	"Europe/Berlin",
	"Europe/Paris",
	"America/New_York",
	"America/Los_Angeles",
	"UTC"
] as const;

export function listAllTimeZones(): string[] {
	// 舊瀏覽器沒有 supportedValuesOf；此時仍要能建立排程，所以退回精選清單。
	const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
	const merged = new Set<string>([...CURATED_TIME_ZONES, ...supported]);
	return [...merged];
}

export function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei";
	} catch {
		return "Asia/Taipei";
	}
}

export interface TimeZoneOption {
	value: string;
	label: string;
	curated: boolean;
}

export function buildTimeZoneOptions(): TimeZoneOption[] {
	const curated = new Set<string>(CURATED_TIME_ZONES);
	const all = listAllTimeZones();
	const rest = all.filter(zone => !curated.has(zone)).sort((a, b) => a.localeCompare(b));
	return [...CURATED_TIME_ZONES.map(zone => ({ value: zone, label: zone, curated: true })), ...rest.map(zone => ({ value: zone, label: zone, curated: false }))];
}
