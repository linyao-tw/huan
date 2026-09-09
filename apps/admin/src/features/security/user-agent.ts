/**
 * 把 User-Agent 整理成「Chrome · macOS」這種看得懂的字。
 *
 * 原始字串是給機器讀的：整串放進表格，光是這一欄就要 900px 以上，
 * 其他欄位再怎麼調都塞不進畫面。這裡只認常見的瀏覽器與作業系統，
 * 認不出來就說認不出來，不要用「可能是」去猜一個看起來像答案的東西。
 */

/** 先比對比較特殊的，因為 Edge、Opera 與 Electron 的字串裡都含有 Chrome。 */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
	[/\bEdgA?i?O?S?\//, "Edge"],
	[/\bOPR\/|\bOpera\b/, "Opera"],
	[/\bSamsungBrowser\//, "Samsung Internet"],
	[/\bElectron\//, "HUAN 播放器"],
	[/\bFirefox\/|\bFxiOS\//, "Firefox"],
	[/\bChrome\/|\bCriOS\//, "Chrome"],
	[/\bSafari\//, "Safari"],
	[/^curl\//, "curl"],
	[/^HUAN-Device\//, "HUAN 播放器"]
];

/** iPad 與 Android 的字串裡分別含有 Macintosh 與 Linux，所以要先比對它們。 */
const PLATFORMS: readonly (readonly [RegExp, string])[] = [
	[/\bWindows NT\b/, "Windows"],
	[/\biPad\b/, "iPad"],
	[/\biPhone\b|\biPod\b/, "iPhone"],
	[/\bAndroid\b/, "Android"],
	[/\bCrOS\b/, "ChromeOS"],
	[/\bMac OS X\b|\bMacintosh\b/, "macOS"],
	[/\bX11\b|\bLinux\b/, "Linux"]
];

function firstMatch(value: string, table: readonly (readonly [RegExp, string])[]): string | null {
	for (const [pattern, label] of table) {
		if (pattern.test(value)) return label;
	}
	return null;
}

export function describeUserAgent(userAgent: string | null): string {
	if (!userAgent || userAgent.trim().length === 0) return "無法辨識的程式";
	const browser = firstMatch(userAgent, BROWSERS);
	const platform = firstMatch(userAgent, PLATFORMS);
	if (browser && platform) return `${browser} · ${platform}`;
	return browser ?? platform ?? "無法辨識的程式";
}
