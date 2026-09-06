import { toMarkdown } from "@/lib/markdown";
import { hrefFor } from "@/lib/navigation";
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

/** 每一頁都有對應的 `.md`，AI 工具不必解析 HTML 就能讀懂整份文件。 */
export const getStaticPaths: GetStaticPaths = async () => {
	const entries = await getCollection("docs");
	return entries.map(entry => ({
		params: { slug: hrefFor(entry.id).replace(/^\//, "") || "index" },
		props: { entry }
	}));
};

export const GET: APIRoute = ({ props }) =>
	new Response(toMarkdown(props.entry), {
		headers: { "content-type": "text/markdown; charset=utf-8" }
	});
