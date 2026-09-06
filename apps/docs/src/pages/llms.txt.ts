import { markdownUrl } from "@/lib/markdown";
import { SECTIONS } from "@/lib/navigation";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

/**
 * llms.txt：整站的結構化索引。
 *
 * 連結指向每頁的 `.md` 而不是 HTML，而且是絕對網址——AI 工具通常是拿到單一
 * 檔案就直接抓連結，相對路徑在那個情境下解析不出來。
 */
export const GET: APIRoute = async ({ site }) => {
	const origin = site?.origin ?? "";
	const entries = await getCollection("docs");
	const byId = new Map(entries.map(entry => [entry.id, entry]));

	const lines = ["# HUAN 讙", "", "> 跨平台的雲端媒體播放與數位看板系統。使用者在瀏覽器設計畫面、安排時段，內容再派送到 Raspberry Pi、Windows、Ubuntu 與 macOS 的播放裝置離線播放。", ""];

	for (const section of SECTIONS) {
		lines.push(`## ${section.label}`, "");
		for (const node of section.nav) {
			const items = "items" in node ? node.items : [node];
			for (const item of items) {
				const entry = byId.get(item.id);
				if (!entry) continue;
				const description = entry.data.description ? `: ${entry.data.description}` : "";
				lines.push(`- [${entry.data.title}](${origin}${markdownUrl(entry.id)})${description}`);
			}
		}
		lines.push("");
	}

	return new Response(lines.join("\n"), {
		headers: { "content-type": "text/plain; charset=utf-8" }
	});
};
