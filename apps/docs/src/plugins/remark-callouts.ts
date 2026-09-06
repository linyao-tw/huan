import type { Root } from "mdast";
import { visit } from "unist-util-visit";

type CalloutKind = "tip" | "info" | "warning" | "danger" | "note";

const KIND_LABEL: Record<CalloutKind, string> = {
	tip: "提示",
	info: "說明",
	warning: "注意",
	danger: "警告",
	note: "備註"
};

const ALIASES: Record<string, CalloutKind> = {
	tip: "tip",
	info: "info",
	note: "note",
	warning: "warning",
	caution: "warning",
	danger: "danger",
	important: "info"
};

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 把 `:::tip 標題` 轉成語意化的 `<aside>`。
 *
 * 直接輸出 HTML 而不是 MDX 元件，是因為內容全都是 `.md`：多帶一整套 MDX
 * 只為了四種提示框，建置會慢上不少，而 Markdown 本來就允許內嵌 HTML。
 */
export function remarkCallouts() {
	return (tree: Root): void => {
		visit(tree, node => {
			if (node.type !== "containerDirective" && node.type !== "leafDirective") return;

			const directive = node as unknown as { name: string; children: unknown[] };
			const kind = ALIASES[directive.name];
			if (!kind) return;

			/** `:::tip 這是標題` 的標題會被 remark-directive 放進帶 directiveLabel 的段落。 */
			let label = KIND_LABEL[kind];
			const children = directive.children as { type: string; data?: { directiveLabel?: boolean }; children?: { value?: string }[] }[];
			const first = children[0];
			if (first?.type === "paragraph" && first.data?.directiveLabel) {
				label = (first.children ?? []).map(child => child.value ?? "").join("");
				children.shift();
			}

			const container = node as unknown as { type: string; data: Record<string, unknown> };
			container.data = {
				hName: "aside",
				hProperties: {
					class: "callout",
					"data-kind": kind
				}
			};

			children.unshift({
				type: "html",
				value: `<p class="callout__title">${escapeHtml(label)}</p>`
			} as never);
		});
	};
}
