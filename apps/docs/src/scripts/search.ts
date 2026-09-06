interface PagefindResult {
	id: string;
	data: () => Promise<{
		url: string;
		meta: { title?: string };
		excerpt: string;
	}>;
}

interface Pagefind {
	search: (query: string) => Promise<{ results: PagefindResult[] }>;
	init?: () => Promise<void>;
}

/**
 * Pagefind 的索引是在 `astro build` 之後才產生的，開發模式下並不存在。
 * 因此這裡動態載入，載不到就把搜尋鈕保持在「僅正式站台可用」的狀態，
 * 而不是讓整個頁面拋錯。
 */
async function loadPagefind(): Promise<Pagefind | null> {
	try {
		const module = (await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}pagefind/pagefind.js`)) as Pagefind;
		await module.init?.();
		return module;
	} catch {
		return null;
	}
}

function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delay: number): (...args: Args) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: Args) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

export function initSearch(): void {
	const trigger = document.getElementById("search-trigger");
	const overlay = document.getElementById("search-overlay");
	const input = document.getElementById("search-input") as HTMLInputElement | null;
	const results = document.getElementById("search-results");
	if (!trigger || !overlay || !input || !results) return;

	let pagefind: Pagefind | null = null;
	let activeIndex = -1;

	const open = async (): Promise<void> => {
		overlay.hidden = false;
		input.focus();
		input.select();
		pagefind ??= await loadPagefind();
		if (!pagefind && results.childElementCount === 0) {
			results.innerHTML = `<p class="search-empty">搜尋索引只在正式建置後產生，開發模式下不可用。</p>`;
		}
	};

	const close = (): void => {
		overlay.hidden = true;
		trigger.focus();
	};

	const links = (): HTMLAnchorElement[] => [...results.querySelectorAll<HTMLAnchorElement>(".search-result")];

	const highlight = (next: number): void => {
		const all = links();
		if (all.length === 0) return;
		activeIndex = (next + all.length) % all.length;
		for (const [index, link] of all.entries()) {
			link.dataset.active = String(index === activeIndex);
		}
		all[activeIndex]?.scrollIntoView({ block: "nearest" });
	};

	const run = debounce(async (query: string) => {
		if (!pagefind || query.trim().length === 0) {
			results.innerHTML = "";
			activeIndex = -1;
			return;
		}
		const search = await pagefind.search(query);
		const top = await Promise.all(search.results.slice(0, 8).map(result => result.data()));
		activeIndex = -1;

		if (top.length === 0) {
			results.innerHTML = `<p class="search-empty">找不到符合的結果。</p>`;
			return;
		}

		results.innerHTML = top
			.map(item => {
				const url = item.url.replace(/\.html$/, "");
				return `<a class="search-result" href="${url}" role="option"><span class="search-result__title">${item.meta.title ?? url}</span><span class="search-result__excerpt">${item.excerpt}</span></a>`;
			})
			.join("");
	}, 150);

	trigger.addEventListener("click", () => void open());
	input.addEventListener("input", () => run(input.value));

	overlay.addEventListener("click", event => {
		if (event.target === overlay) close();
	});

	document.addEventListener("keydown", event => {
		const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
		if (isShortcut) {
			event.preventDefault();
			overlay.hidden ? void open() : close();
			return;
		}
		if (overlay.hidden) return;

		if (event.key === "Escape") {
			event.preventDefault();
			close();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			highlight(activeIndex + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			highlight(activeIndex - 1);
		} else if (event.key === "Enter" && activeIndex >= 0) {
			event.preventDefault();
			links()[activeIndex]?.click();
		}
	});
}
