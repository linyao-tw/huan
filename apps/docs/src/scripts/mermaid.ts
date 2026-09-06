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
		labelBoxBkgColor: accent,
		labelBoxBorderColor: accent,
		labelTextColor: onAccent,
		loopTextColor: text,
		noteBkgColor: muted,
		noteBorderColor: border,
		noteTextColor: text,
		fontFamily: styles.getPropertyValue("--font-family-sans").trim() || "system-ui, sans-serif"
	};
}

let counter = 0;

async function renderAll(): Promise<void> {
	const nodes = [...document.querySelectorAll<HTMLElement>(".mermaid")];
	if (nodes.length === 0) return;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		themeVariables: themeVariables()
	});

	for (const node of nodes) {
		const source = node.dataset.diagram;
		if (!source) continue;
		try {
			counter += 1;
			const { svg } = await mermaid.render(`mermaid-${counter}`, source);
			node.innerHTML = svg;
			node.dataset.rendered = "true";
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
