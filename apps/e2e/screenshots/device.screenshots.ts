import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "../../docs/public/screenshots");
const DEVICE_DIR = resolve(HERE, "../../device");
const MAIN_ENTRY = join(DEVICE_DIR, "out/main/index.js");

/**
 * 從真正的 Electron 播放器擷取配對畫面。
 *
 * 文件裡的裝置畫面必須是實際跑起來的樣子，不是後台的模擬圖；
 * 沒有先 `pnpm --filter @huan/device build` 時就跳過，而不是放一張假的。
 */
test("device pairing screen", async () => {
	test.skip(!existsSync(MAIN_ENTRY), "尚未建置 Electron 播放器：請先執行 pnpm --filter @huan/device build");

	await mkdir(OUTPUT_DIR, { recursive: true });
	const userData = await mkdtemp(join(tmpdir(), "huan-device-shot-"));

	const app = await electron.launch({
		args: [MAIN_ENTRY, `--user-data-dir=${userData}`],
		cwd: DEVICE_DIR,
		env: {
			...process.env,
			HUAN_SERVER_URL: process.env.HUAN_E2E_API_URL ?? "http://localhost:4000",
			HUAN_DEVICE_NAME: "門市展示機",
			/** 截圖需要視窗模式，全螢幕 kiosk 會蓋掉整個桌面。 */
			HUAN_KIOSK: "false",
			ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
		}
	});

	try {
		const window = await app.firstWindow();
		await window.waitForLoadState("domcontentloaded");
		/** 等配對碼真的從伺服器回來，而不是拍到載入中的轉圈圈。 */
		await expect(window.getByText(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)).toBeVisible({ timeout: 30_000 });
		await window.waitForTimeout(1_500);
		await window.screenshot({ path: resolve(OUTPUT_DIR, "device-pairing.png") });
	} finally {
		await app.close();
		await rm(userData, { recursive: true, force: true });
	}
});
