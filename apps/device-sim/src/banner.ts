/**
 * 配對碼的點陣字型。
 *
 * 現場的人要從螢幕上把這串碼抄到後台，字太小就會抄錯，
 * 所以模擬裝置跟正式播放器一樣把它畫得夠大。
 * 字母表已經排除了 0/O/1/I，這裡只需要涵蓋剩下的 32 個字元加上連字號。
 */
const GLYPHS: Record<string, readonly string[]> = {
	"2": [".###.", "#...#", "...#.", "..#..", "#####"],
	"3": ["####.", "....#", "..##.", "....#", "####."],
	"4": ["#...#", "#...#", "#####", "....#", "....#"],
	"5": ["#####", "#....", "####.", "....#", "####."],
	"6": [".###.", "#....", "####.", "#...#", ".###."],
	"7": ["#####", "....#", "...#.", "..#..", "..#.."],
	"8": [".###.", "#...#", ".###.", "#...#", ".###."],
	"9": [".###.", "#...#", ".####", "....#", ".###."],
	A: [".###.", "#...#", "#####", "#...#", "#...#"],
	B: ["####.", "#...#", "####.", "#...#", "####."],
	C: [".###.", "#...#", "#....", "#...#", ".###."],
	D: ["####.", "#...#", "#...#", "#...#", "####."],
	E: ["#####", "#....", "####.", "#....", "#####"],
	F: ["#####", "#....", "####.", "#....", "#...."],
	G: [".###.", "#....", "#.###", "#...#", ".###."],
	H: ["#...#", "#...#", "#####", "#...#", "#...#"],
	J: ["....#", "....#", "....#", "#...#", ".###."],
	K: ["#...#", "#..#.", "###..", "#..#.", "#...#"],
	L: ["#....", "#....", "#....", "#....", "#####"],
	M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
	N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
	P: ["####.", "#...#", "####.", "#....", "#...."],
	Q: [".###.", "#...#", "#...#", "#..#.", ".##.#"],
	R: ["####.", "#...#", "####.", "#..#.", "#...#"],
	S: [".####", "#....", ".###.", "....#", "####."],
	T: ["#####", "..#..", "..#..", "..#..", "..#.."],
	U: ["#...#", "#...#", "#...#", "#...#", ".###."],
	V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
	W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
	X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
	Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
	Z: ["#####", "...#.", "..#..", ".#...", "#####"],
	"-": [".....", ".....", "#####", ".....", "....."]
};

const GLYPH_HEIGHT = 5;
const UNKNOWN: readonly string[] = ["#####", "#####", "#####", "#####", "#####"];

/** 把一串字畫成點陣圖。無法呈現的字元以實心方塊代替，絕不靜靜省略。 */
export function renderBigText(text: string, on = "█", off = " "): string[] {
	const rows: string[] = [];
	for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
		const parts: string[] = [];
		for (const character of text.toUpperCase()) {
			const glyph = GLYPHS[character] ?? UNKNOWN;
			parts.push(
				(glyph[row] ?? "")
					.split("")
					.map(cell => (cell === "#" ? on : off))
					.join("")
			);
		}
		rows.push(parts.join(off));
	}
	return rows;
}

function displayWidth(text: string): number {
	// 中文字在終端機是兩格寬，靠這個估算才能把外框對齊。
	let width = 0;
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		width +=
			code >= 0x1100 &&
			(code <= 0x115f ||
				(code >= 0x2e80 && code <= 0xa4cf) ||
				(code >= 0xac00 && code <= 0xd7a3) ||
				(code >= 0xf900 && code <= 0xfaff) ||
				(code >= 0xfe30 && code <= 0xfe6f) ||
				(code >= 0xff00 && code <= 0xff60) ||
				(code >= 0xffe0 && code <= 0xffe6))
				? 2
				: 1;
	}
	return width;
}

export interface PairingBannerInput {
	code: string;
	pairingUrl: string;
	expiresAt: string;
}

/** 配對畫面：大字配對碼、配對網址與有效期限，一次把現場需要的資訊全部給出來。 */
export function renderPairingBanner(input: PairingBannerInput): string {
	const formatted = formatCode(input.code);
	const big = renderBigText(formatted);
	const lines = ["請在 HUAN 後台輸入這組配對碼", "", ...big, "", `配對碼：${formatted}`, `配對網址：${input.pairingUrl}`, `有效期限：${formatExpiry(input.expiresAt)}`];

	const width = Math.max(...lines.map(displayWidth)) + 4;
	const top = `┌${"─".repeat(width)}┐`;
	const bottom = `└${"─".repeat(width)}┘`;
	const body = lines.map(line => `│  ${line}${" ".repeat(Math.max(0, width - 2 - displayWidth(line)))}│`);
	return [top, ...body, bottom].join("\n");
}

function formatCode(code: string): string {
	const compact = code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
	return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function formatExpiry(iso: string): string {
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return iso;
	return parsed.toLocaleString("zh-TW", { hour12: false });
}
