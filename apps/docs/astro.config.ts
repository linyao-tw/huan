import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import remarkDirective from "remark-directive";
import { remarkCallouts } from "./src/plugins/remark-callouts";
import { remarkMermaid } from "./src/plugins/remark-mermaid";

/**
 * 文件站有自己的網域，服務在根路徑，因此不需要處理子路徑。
 * `site` 只影響 sitemap、canonical 與 llms.txt 裡的絕對連結，換網域時覆寫即可。
 */
const site = process.env.DOCS_SITE_ORIGIN ?? "https://docs.huan.linyao.tw";

export default defineConfig({
	site,
	base: "/",
	trailingSlash: "never",
	build: { format: "file" },

	markdown: {
		/**
		 * Shiki 只負責語法結構，配色交給 CSS。
		 *
		 * `css-variables` 主題讓 Shiki 輸出 `var(--astro-code-*)`，我們再把那些
		 * 變數接到設計系統的語意角色上，程式碼區塊就會跟著亮／深色主題走 ——
		 * 內建主題會把色碼寫死，切到深色只有程式碼那一塊還是亮的。
		 */
		shikiConfig: {
			theme: "css-variables",
			wrap: false
		},

		/*
		 * Astro 7 預設改用原生的 Sätteri 處理器，速度快很多，但目前還沒有
		 * remark-directive 那一整套生態。文件用到 `:::tip` 這類容器語法，
		 * 因此明確選用 unified；45 頁的站台在建置時間上感覺不出差別。
		 */
		processor: unified({
			remarkPlugins: [remarkDirective, remarkCallouts, remarkMermaid]
		})
	}
});
