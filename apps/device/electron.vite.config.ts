import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";

const alias = {
	"@": fileURLToPath(new URL("./src", import.meta.url))
};

/**
 * `electron` 必須保持 external，而且必須明講。
 *
 * `externalizeDepsPlugin()` 只會外部化 `dependencies` 與 `peerDependencies`；
 * `electron` 放在 devDependencies（打包後由 Electron runtime 自己提供），
 * 所以會被一起打進 bundle —— 打進去的是 npm 的啟動器 shim，執行時會去跑
 * `install.js` 重新下載二進位檔，而不是提供真正的 Electron API，
 * 結果就是 app 靜默地永遠起不來。
 */
const ELECTRON_EXTERNAL = ["electron"];

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias },
		build: {
			outDir: "out/main",
			rollupOptions: {
				external: ELECTRON_EXTERNAL,
				input: fileURLToPath(new URL("./src/main/index.ts", import.meta.url))
			}
		}
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias },
		build: {
			outDir: "out/preload",
			rollupOptions: {
				external: ELECTRON_EXTERNAL,
				input: fileURLToPath(new URL("./src/preload/index.ts", import.meta.url)),
				/**
				 * preload 在 sandbox 下必須是 CommonJS。Electron 的沙箱化 preload
				 * 不支援 ESM 載入器，輸出 ESM 會在啟動時直接失敗。
				 */
				output: { format: "cjs", entryFileNames: "index.cjs" }
			}
		}
	},
	renderer: {
		root: "src/renderer",
		plugins: [react()],
		resolve: { alias },
		build: {
			outDir: "out/renderer",
			rollupOptions: {
				input: fileURLToPath(new URL("./src/renderer/index.html", import.meta.url))
			}
		}
	}
});
