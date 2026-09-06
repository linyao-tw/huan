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

	/*
	 * 進站時把目前頁面捲進側欄的可視範圍。
	 *
	 * 側欄自己是一個捲動容器，ADR 那一段排在清單最下面 —— 不捲的話，停在
	 * /dev/adr/0007 看到的是一份完全沒有高亮的目錄，讀者無從得知自己在哪裡。
	 * 不用 scrollIntoView：它會連帶把整個頁面一起捲走。
	 */
	const revealActive = (): void => {
		const active = sidebar.querySelector<HTMLElement>('[aria-current="page"]');
		if (!active) return;
		const offset = active.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop;
		const visible = offset >= sidebar.scrollTop && offset + active.offsetHeight <= sidebar.scrollTop + sidebar.clientHeight;
		if (visible) return;
		sidebar.scrollTop = Math.max(0, offset - (sidebar.clientHeight - active.offsetHeight) / 2);
	};

	/*
	 * 側欄捲不完的時候在該側淡出，讓人知道還有項目。
	 *
	 * 門檻不能是 1px：側欄底下有一段內距，捲動範圍永遠比可視範圍多出那幾十 px，
	 * 於是提示會在「其實已經到底」的時候亮著，把最後一個項目蓋成半透明。
	 * 取一個比內距大的門檻，只有真的還有東西沒露出來才提示。
	 */
	const EDGE_HINT_THRESHOLD = 32;

	const updateMore = (): void => {
		sidebar.dataset.less = String(sidebar.scrollTop > EDGE_HINT_THRESHOLD);
		sidebar.dataset.more = String(sidebar.scrollHeight - sidebar.clientHeight - sidebar.scrollTop > EDGE_HINT_THRESHOLD);
	};

	const setOpen = (open: boolean): void => {
		sidebar.dataset.open = String(open);
		scrim.dataset.open = String(open);
		button.setAttribute("aria-expanded", String(open));
		document.body.style.overflow = open ? "hidden" : "";
		// 抽屜關著的時候量不到位置，所以每次打開都要重算一次。
		if (open) {
			revealActive();
			updateMore();
		}
	};

	revealActive();
	updateMore();
	sidebar.addEventListener("scroll", updateMore, { passive: true });
	window.addEventListener("resize", updateMore, { passive: true });

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

		const update = (): void => {
			const remaining = pre.scrollWidth - pre.clientWidth - pre.scrollLeft;
			wrapper.dataset.overflow = String(remaining > 1);
		};
		update();
		pre.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update, { passive: true });
	}
}

/**
 * 寬表格在窄螢幕上會撐破版面，包一層可捲動的容器。
 *
 * 外面再包一層是為了畫「還可以往右捲」的提示：提示不能畫在捲動容器上，
 * 表格儲存格有自己的背景色，會直接蓋掉。
 */
function setupTables(): void {
	const scrollers: HTMLElement[] = [];

	for (const table of document.querySelectorAll<HTMLTableElement>(".prose table")) {
		let scroller = table.parentElement;
		if (!scroller?.classList.contains("table-scroll")) {
			const wrap = document.createElement("div");
			wrap.className = "table-wrap";
			const inner = document.createElement("div");
			inner.className = "table-scroll";
			table.parentElement?.insertBefore(wrap, table);
			wrap.appendChild(inner);
			inner.appendChild(table);
			scroller = inner;
		}
		scrollers.push(scroller);
	}

	if (scrollers.length === 0) return;

	const update = (): void => {
		for (const scroller of scrollers) {
			const remaining = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
			const wrap = scroller.parentElement;
			if (wrap) wrap.dataset.overflow = String(remaining > 1);
		}
	};

	update();
	for (const scroller of scrollers) scroller.addEventListener("scroll", update, { passive: true });
	window.addEventListener("resize", update, { passive: true });
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
