import { resolve } from "node:path";

/**
 * 文件搬到獨立的 repository 之後，截圖是在這裡產生、在那裡 commit 的。
 *
 * 預設寫到同層的 `../docs` checkout，因為兩個 repository 通常並排放；
 * 放在別處時用 DOCS_SCREENSHOT_DIR 覆寫。
 * 產生的圖片要記得在 docs repository 那邊 commit，不然文件站不會更新。
 */
export function screenshotDir(here: string): string {
	const override = process.env.DOCS_SCREENSHOT_DIR;
	if (override) return resolve(override);
	return resolve(here, "../../../../docs/public/huan/screenshots");
}
