import { defineConfig } from "tsup";

/**
 * 只打包這個 app 自己的原始碼，npm 相依維持 external。
 *
 * 這樣做有兩個好處：`@/` 別名在打包時就被解析掉，production build 不需要
 * 額外的路徑解析器；第三方套件則保持原樣，避免把有動態 require 的函式庫
 * 硬塞進單一檔案而在執行期爆炸。
 */
export default defineConfig({
	entry: ["src/main.ts"],
	format: ["esm"],
	target: "node24",
	platform: "node",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	dts: false,
	splitting: false,
	skipNodeModulesBundle: true,
	tsconfig: "tsconfig.json"
});
