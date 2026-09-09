/**
 * 常用時區的中文說法。
 *
 * 畫面上沒有理由出現「Asia/Taipei」——那是資料庫用的識別字，不是給店長看的。
 * 但也不要假裝我們翻得出全世界的地名：清單以外的時區照原樣顯示，讓使用者
 * 至少還能對照自己當初選的那一個。
 */
const TIME_ZONE_CITIES: Readonly<Record<string, string>> = {
	"Asia/Taipei": "台北",
	"Asia/Hong_Kong": "香港",
	"Asia/Shanghai": "上海",
	"Asia/Tokyo": "東京",
	"Asia/Seoul": "首爾",
	"Asia/Singapore": "新加坡",
	"Asia/Bangkok": "曼谷",
	"Asia/Kuala_Lumpur": "吉隆坡",
	"Asia/Manila": "馬尼拉",
	"Australia/Sydney": "雪梨",
	"Europe/London": "倫敦",
	"Europe/Berlin": "柏林",
	"Europe/Paris": "巴黎",
	"America/New_York": "紐約",
	"America/Los_Angeles": "洛杉磯",
	UTC: "世界標準時間"
};

/** 表格裡的一行字：「台北時間」。翻不出來時就顯示原本的識別字。 */
export function timeZoneShortLabel(zone: string): string {
	const city = TIME_ZONE_CITIES[zone];
	return city ? `${city}時間` : zone;
}

/** 下拉選單的一列：中文在前，原識別字放括號裡，讓知道的人也找得到。 */
export function timeZoneOptionLabel(zone: string): string {
	const city = TIME_ZONE_CITIES[zone];
	return city ? `${city}（${zone}）` : zone;
}
