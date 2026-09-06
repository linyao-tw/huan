import mermaid from "mermaid";

/**
 * 圖表的顏色取自設計系統的變數。
 *
 * mermaid 會把顏色寫死進 SVG，因此不能只設定一次——切換主題時要用新的
 * 變數值重畫一遍，否則深色頁面上會留著一張亮色的圖。
 */
/**
 * 把設計變數解析成 mermaid 看得懂的顏色。
 *
 * 設計系統用的是 OKLCH，而 mermaid 內部的色彩函式庫只認 hex / rgb —— 直接把
 * `oklch(23% .008 75)` 丟進去會讓整張圖畫不出來。用 canvas 讓瀏覽器自己算出
 * sRGB，比在前端重寫一份色彩空間轉換可靠得多。
 */
function createColorResolver(): (name: string, fallback: string) => string {
	const styles = getComputedStyle(document.documentElement);
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });

	return (name, fallback) => {
		const raw = styles.getPropertyValue(name).trim();
		if (!raw) return fallback;
		if (!context) return raw;

		context.clearRect(0, 0, 1, 1);
		context.fillStyle = "#000000";
		context.fillStyle = raw;
		/* 瀏覽器不認得這個值時 fillStyle 會保持原樣，此時退回備援色。 */
		if (context.fillStyle === "#000000" && raw !== "#000000" && raw !== "black") return fallback;

		context.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
		if (a === undefined || a === 255) return `rgb(${r}, ${g}, ${b})`;
		return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
	};
}

function themeVariables(): Record<string, string> {
	const read = createColorResolver();
	const styles = getComputedStyle(document.documentElement);

	const surface = read("--background-elevated", "#ffffff");
	const text = read("--text-main", "#1a1a1a");
	const border = read("--divider-strong", "#8a8a8a");
	const accent = read("--control-primary", "#fe3300");
	const onAccent = read("--control-on-primary", "#ffffff");
	const muted = read("--background-secondary", "#f2f2f2");

	return {
		background: "transparent",
		primaryColor: surface,
		primaryTextColor: text,
		primaryBorderColor: border,
		secondaryColor: muted,
		secondaryTextColor: text,
		secondaryBorderColor: border,
		tertiaryColor: muted,
		tertiaryTextColor: text,
		tertiaryBorderColor: border,
		lineColor: border,
		textColor: text,
		mainBkg: surface,
		nodeBorder: border,
		clusterBkg: muted,
		clusterBorder: border,
		titleColor: text,
		edgeLabelBackground: read("--background-main", "#ffffff"),
		actorBkg: surface,
		actorBorder: border,
		actorTextColor: text,
		signalColor: border,
		signalTextColor: text,
		/* alt / loop 的標籤只是結構標示，用主色會讓整張圖看起來像出錯了。 */
		labelBoxBkgColor: muted,
		labelBoxBorderColor: border,
		labelTextColor: text,
		loopTextColor: text,
		noteBkgColor: muted,
		noteBorderColor: border,
		noteTextColor: text,
		fontFamily: styles.getPropertyValue("--font-family-sans").trim() || "system-ui, sans-serif"
	};
}

/** 圖比容器寬時標記起來，讓 CSS 畫出「可以往右捲」的提示。 */
function markOverflow(node: HTMLElement): void {
	const update = (): void => {
		const remaining = node.scrollWidth - node.clientWidth - node.scrollLeft;
		node.dataset.overflow = String(remaining > 1);
	};
	update();
	node.addEventListener("scroll", update, { passive: true });
	window.addEventListener("resize", update, { passive: true });
}

let counter = 0;

async function renderAll(): Promise<void> {
	const nodes = [...document.querySelectorAll<HTMLElement>(".mermaid")];
	if (nodes.length === 0) return;

	/*
	 * 等字型載入完再算繪。
	 *
	 * mermaid 是量文字的實際寬度來決定節點框要多大。字型還沒到的話它量的是後備
	 * 字型，框就會比真正的文字窄個百分之幾 —— 畫面上看到的是「PlatformAdapte」
	 * 這種被切掉最後一個字母的標籤。而且它是競態，每次重新整理被切到的還不一樣。
	 */
	if (document.fonts) await document.fonts.ready;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		themeVariables: themeVariables(),
		/*
		 * 關掉 useMaxWidth，讓圖保持自然寬度。
		 *
		 * 開著的話 mermaid 會在 SVG 上寫 inline 的 max-width，把 1169px 的流程圖
		 * 壓進手機的 343px 欄位，標籤只剩 4px —— 技術上沒有溢出，實際上讀不到字。
		 * 現在改由容器橫向捲動。
		 */
		flowchart: { useMaxWidth: false },
		sequence: { useMaxWidth: false },
		/*
		 * 狀態圖的預設間距是照單行英文標籤抓的。Worker 那張圖有兩條 running → pending，
		 * 標籤都是兩行中文，用預設值畫出來三個標籤框會黏在一起。把層距拉開，
		 * 這比為了排版去刪掉「run_after = now() + 退避」這種真正有用的細節好。
		 */
		state: { useMaxWidth: false, nodeSpacing: 60, rankSpacing: 80 },
		gantt: { useMaxWidth: false },
		er: { useMaxWidth: false }
	});

	for (const node of nodes) {
		const source = node.dataset.diagram;
		if (!source) continue;
		try {
			counter += 1;
			const { svg } = await mermaid.render(`mermaid-${counter}`, source);
			node.innerHTML = svg;
			node.dataset.rendered = "true";
			markOverflow(node);
		} catch {
			/* 圖畫不出來時保留原始定義，讀者至少還看得到內容，也比一塊空白好除錯。 */
			node.textContent = source;
			node.dataset.rendered = "error";
		}
	}
}

export function renderDiagrams(): void {
	void renderAll();

	/** 主題切換時整批重畫。 */
	new MutationObserver(() => void renderAll()).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-lyds-theme"]
	});
}
