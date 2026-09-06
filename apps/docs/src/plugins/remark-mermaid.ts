import type { Root } from "mdast";
import { visit } from "unist-util-visit";

/**
 * 把 ```mermaid 區塊換成待算繪的容器。
 *
 * 圖是在瀏覽器端畫的，原因是主題：mermaid 會把顏色寫死在 SVG 裡，
 * 建置期算繪就得為亮色與深色各存一份，而我們的主題是使用者手動切換的，
 * `prefers-color-scheme` 那一套跟不上。改成在前端算繪，切換主題時重畫即可。
 *
 * 代價是有圖的頁面要載入 mermaid，因此只有這些頁面才會載入它。
 */
export function remarkMermaid() {
	return (tree: Root): void => {
		visit(tree, "code", node => {
			if (node.lang !== "mermaid") return;

			const target = node as unknown as { type: string; data: Record<string, unknown>; children: unknown[] };
			target.type = "paragraph";
			target.data = {
				hName: "div",
				hProperties: {
					class: "mermaid",
					"data-diagram": node.value
				}
			};
			target.children = [];
		});
	};
}
