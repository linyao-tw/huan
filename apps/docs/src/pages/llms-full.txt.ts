import { docsInOrder, toMarkdown } from "@/lib/markdown";
import type { APIRoute } from "astro";

/** llms-full.txt：整份文件串成一個檔案，順序與側欄一致。 */
export const GET: APIRoute = async () => {
	const entries = await docsInOrder();
	const body = entries.map(entry => toMarkdown(entry)).join("\n---\n\n");

	return new Response(`# HUAN 讙 完整文件\n\n${body}`, {
		headers: { "content-type": "text/plain; charset=utf-8" }
	});
};
