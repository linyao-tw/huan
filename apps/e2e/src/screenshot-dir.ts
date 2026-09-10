import { resolve } from "node:path";

/**
 * 官網首頁貼出來的四張畫面。
 *
 * 其餘截圖只有文件站在用。全部都複製一份到 admin 的 public，等於讓網站多帶
 * 一批沒有人引用的圖片，光是深色版就多了一倍。
 */
const LANDING_SHOTS = new Set(["devices", "layout-editor", "media", "schedules"]);

export interface ScreenshotDirs {
	docs: string;
	admin: string;
}

/**
 * 截圖要送到兩個地方。
 *
 * 文件站在獨立的 repository（同層的 `../docs` checkout），官網首頁則需要自己
 * 的一份 —— 首頁不能引用另一個 repository 的檔案。兩邊都要，所以一次寫兩份，
 * 而不是拍完再手動複製一次。
 *
 * `DOCS_SCREENSHOT_DIR` 可以覆寫文件站那一份的位置。產生的圖片要各自在兩個
 * repository 提交。
 */
export function screenshotDirs(here: string): ScreenshotDirs {
	return {
		docs: process.env.DOCS_SCREENSHOT_DIR ?? resolve(here, "../../../../docs/public/huan/screenshots"),
		admin: resolve(here, "../../admin/public/screenshots")
	};
}

/** 這一張截圖該寫到哪些資料夾。 */
export function destinationsFor(dirs: ScreenshotDirs, name: string): string[] {
	return LANDING_SHOTS.has(name) ? [dirs.docs, dirs.admin] : [dirs.docs];
}
