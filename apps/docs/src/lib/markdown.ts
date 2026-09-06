import { hrefFor, SECTIONS } from "@/lib/navigation";
import { getCollection, type CollectionEntry } from "astro:content";

/**
 * 產生給 AI 讀的純 Markdown。
 *
 * 內容本身就是 Markdown，因此只需要把 frontmatter 換成一個標題，
 * 不必反向從 HTML 還原——那樣會把表格與程式碼區塊弄壞。
 */
export function toMarkdown(entry: CollectionEntry<"docs">): string {
	const heading = `# ${entry.data.title}`;
	const lead = entry.data.description ? `\n\n${entry.data.description}` : "";
	return `${heading}${lead}\n\n${entry.body?.trim() ?? ""}\n`;
}

export async function docsInOrder(): Promise<CollectionEntry<"docs">[]> {
	const entries = await getCollection("docs");
	const byId = new Map(entries.map(entry => [entry.id, entry]));

	/** 依照側欄的順序輸出，讓 llms.txt 的結構和人看到的一致。 */
	const ordered: CollectionEntry<"docs">[] = [];
	for (const section of SECTIONS) {
		for (const node of section.nav) {
			const items = "items" in node ? node.items : [node];
			for (const item of items) {
				const entry = byId.get(item.id);
				if (entry && !ordered.includes(entry)) ordered.push(entry);
			}
		}
	}
	for (const entry of entries) {
		if (!ordered.includes(entry)) ordered.push(entry);
	}
	return ordered;
}

export function markdownUrl(id: string): string {
	const href = hrefFor(id);
	return href === "/" ? "/index.md" : `${href}.md`;
}
