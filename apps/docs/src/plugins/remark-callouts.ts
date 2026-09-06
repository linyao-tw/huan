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
 * 還原一個指令節點在原始碼裡的樣子。
 *
 * remark-directive 會把散文裡的 `13:00` 解析成文字 `13` 加上一個名為 `00` 的
 * 指令；沒有人處理它的話，remark-rehype 會把它整個丟掉——`:00` 就這樣從頁面上
 * 消失，段落還被切成兩半。同樣的事發生在 `16:9`、`4:3` 這些寫法上。
 * 因此凡是我們不認得的指令，一律照原樣還原成純文字。
 */
function literalSource(node: {
	type: string;
	name: string;
	attributes?: Record<string, string | null> | null;
	children?: { type: string; value?: string; data?: { directiveLabel?: boolean } }[];
}): string {
	const marker = node.type === "containerDirective" ? ":::" : node.type === "leafDirective" ? "::" : ":";
	let text = `${marker}${node.name}`;

	const label = node.children?.find(child => child.data?.directiveLabel);
	if (label) {
		const inner = (label as { children?: { value?: string }[] }).children ?? [];
		text += `[${inner.map(child => child.value ?? "").join("")}]`;
	}

	const attributes = Object.entries(node.attributes ?? {});
	if (attributes.length > 0) {
		text += `{${attributes.map(([key, value]) => (value === null || value === "" ? key : `${key}="${value}"`)).join(" ")}}`;
	}
	return text;
}

/**
 * 把 `:::tip[標題]` 轉成語意化的 `<aside>`。
 *
 * 直接輸出 HTML 而不是 MDX 元件，是因為內容全都是 `.md`：多帶一整套 MDX
 * 只為了四種提示框，建置會慢上不少，而 Markdown 本來就允許內嵌 HTML。
 */
export function remarkCallouts() {
	return (tree: Root): void => {
		visit(tree, node => {
			if (node.type !== "containerDirective" && node.type !== "leafDirective" && node.type !== "textDirective") return;

			const directive = node as unknown as { name: string; children: unknown[]; attributes?: Record<string, string | null> | null };
			const kind = ALIASES[directive.name];

			/* 不是提示框就照原樣還原成文字，不要讓它被靜默吃掉。 */
			if (!kind) {
				const restored = node as unknown as { type: string; value: string; children?: unknown[]; data?: unknown };
				const text = literalSource(directive as never);
				restored.type = "text";
				restored.value = text;
				delete restored.children;
				delete restored.data;
				return;
			}

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
