import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";

const alias = {
	"@": fileURLToPath(new URL("./src", import.meta.url))
};

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		resolve: { alias },
		build: {
			outDir: "out/main",
			rollupOptions: {
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
