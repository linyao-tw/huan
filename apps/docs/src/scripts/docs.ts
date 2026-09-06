/** 主題只有兩個值，不提供「跟隨系統」——切換鈕要能一次看出現在是哪一個。 */
type Theme = "light" | "dark";

const THEME_KEY = "huan-docs-theme";

function currentTheme(): Theme {
	return document.documentElement.getAttribute("data-lyds-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
	document.documentElement.setAttribute("data-lyds-theme", theme);
	document.documentElement.style.colorScheme = theme;
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		/* 無痕視窗會拒絕寫入。主題仍然在這一次瀏覽中生效，只是不會被記住。 */
	}
}

function setupTheme(): void {
	document.getElementById("theme-toggle")?.addEventListener("click", () => {
		applyTheme(currentTheme() === "dark" ? "light" : "dark");
	});
}

function setupSidebar(): void {
	const sidebar = document.getElementById("sidebar");
	const scrim = document.getElementById("sidebar-scrim");
	const button = document.getElementById("menu-button");
	if (!sidebar || !scrim || !button) return;

	const setOpen = (open: boolean): void => {
		sidebar.dataset.open = String(open);
		scrim.dataset.open = String(open);
		button.setAttribute("aria-expanded", String(open));
		document.body.style.overflow = open ? "hidden" : "";
	};

	button.addEventListener("click", () => setOpen(sidebar.dataset.open !== "true"));
	scrim.addEventListener("click", () => setOpen(false));
	document.addEventListener("keydown", event => {
		if (event.key === "Escape") setOpen(false);
	});
}

/**
 * 目錄的高亮。
 *
 * 用 IntersectionObserver 而不是監聽 scroll：後者每一幀都要問一次每個標題的
 * 位置，在長頁面上是實打實的成本，而這裡要的資訊瀏覽器本來就算得出來。
 */
function setupTableOfContents(): void {
	const links = [...document.querySelectorAll<HTMLAnchorElement>(".toc__link")];
	if (links.length === 0) return;

	const byId = new Map(links.map(link => [link.dataset.tocTarget ?? "", link]));
	const headings = [...byId.keys()].map(id => document.getElementById(id)).filter((element): element is HTMLElement => element !== null);
	if (headings.length === 0) return;

	const visible = new Set<string>();

	const highlight = (): void => {
		const active = headings.find(heading => visible.has(heading.id)) ?? null;
		for (const link of links) link.removeAttribute("data-active");
		if (active) byId.get(active.id)?.setAttribute("data-active", "true");
	};

	const observer = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) visible.add(entry.target.id);
				else visible.delete(entry.target.id);
			}
			highlight();
		},
		{ rootMargin: "-80px 0px -70% 0px", threshold: 0 }
	);

	for (const heading of headings) observer.observe(heading);
}

function setupCodeCopy(): void {
	for (const pre of document.querySelectorAll<HTMLPreElement>(".prose pre")) {
		if (pre.parentElement?.classList.contains("code-block")) continue;

		const wrapper = document.createElement("div");
		wrapper.className = "code-block";
		pre.parentElement?.insertBefore(wrapper, pre);
		wrapper.appendChild(pre);

		const button = document.createElement("button");
		button.type = "button";
		button.className = "code-copy";
		button.textContent = "複製";
		button.addEventListener("click", () => {
			void navigator.clipboard.writeText(pre.innerText).then(() => {
				button.textContent = "已複製";
				setTimeout(() => (button.textContent = "複製"), 2000);
			});
		});
		wrapper.appendChild(button);
	}
}

/** 寬表格在窄螢幕上會撐破版面，包一層可捲動的容器。 */
function setupTables(): void {
	for (const table of document.querySelectorAll<HTMLTableElement>(".prose table")) {
		if (table.parentElement?.classList.contains("table-scroll")) continue;
		const wrapper = document.createElement("div");
		wrapper.className = "table-scroll";
		table.parentElement?.insertBefore(wrapper, table);
		wrapper.appendChild(table);
	}
}

/** 只有真的有圖的頁面才載入 mermaid，它比整個文件站的其他 JS 加起來還大。 */
async function setupDiagrams(): Promise<void> {
	if (!document.querySelector(".mermaid")) return;
	const { renderDiagrams } = await import("@/scripts/mermaid");
	renderDiagrams();
}

export function initDocs(): void {
	setupTheme();
	setupSidebar();
	setupTableOfContents();
	setupCodeCopy();
	setupTables();
	void setupDiagrams();
	void import("@/scripts/search").then(module => module.initSearch());
}
