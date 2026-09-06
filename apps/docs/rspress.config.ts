import { defineConfig } from "@rspress/core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_BRIDGE_SCRIPT } from "./theme/theme-bridge";

const here = (relative: string): string => resolve(fileURLToPath(new URL(".", import.meta.url)), relative);

/**
 * 文件站有自己的網域，服務在根路徑，因此 base 固定是 `/`。
 *
 * `siteOrigin` 只影響 `llms.txt` 與各頁 Markdown 裡的絕對連結；
 * fork 出去換網域時覆寫 `DOCS_SITE_ORIGIN` 即可。
 */
const siteOrigin = process.env.DOCS_SITE_ORIGIN ?? "https://docs.huan.linyao.tw";

const THEME_TEXT_ZH_TW: Record<string, string> = {
	languagesText: "語言",
	themeText: "佈景主題",
	versionsText: "版本",
	menuTitle: "選單",
	outlineTitle: "本頁內容",
	scrollToTopText: "回到頂部",
	lastUpdatedText: "最後更新",
	lastUpdatedAuthorText: "最後更新者",
	prevPageText: "上一頁",
	nextPageText: "下一頁",
	sourceCodeText: "原始碼",
	searchPlaceholderText: "搜尋文件",
	searchPanelCancelText: "取消",
	searchNoResultsText: "找不到符合的結果",
	searchSuggestedQueryText: "請換個關鍵字再試一次",
	"overview.filterNameText": "篩選",
	"overview.filterPlaceholderText": "輸入關鍵字",
	"overview.filterNoResultText": "找不到符合的標題",
	openInText: "開啟於",
	copyMarkdownText: "複製 Markdown",
	copyMarkdownLinkText: "複製 Markdown 連結",
	editLinkText: "編輯此頁",
	codeButtonGroupCopyButtonText: "複製",
	codeButtonGroupWrapButtonText: "自動換行",
	notFoundText: "找不到這個頁面",
	takeMeHomeText: "回到快速開始",
	promptCopyText: "複製提示詞",
	promptCopiedText: "已複製",
	promptExpandText: "展開",
	promptCollapseText: "收合"
};

/** 使用教學：面向實際操作 HUAN 的人，不談程式碼與部署。 */
const GUIDE_SIDEBAR = [
	{
		text: "開始使用",
		items: [
			{ text: "快速開始", link: "/index" },
			{ text: "核心概念", link: "/guide/concepts" }
		]
	},
	{
		text: "日常操作",
		items: [
			{ text: "上傳素材", link: "/guide/media" },
			{ text: "設計版面", link: "/guide/layouts" },
			{ text: "安排播放時段", link: "/guide/schedules" },
			{ text: "管理裝置", link: "/guide/devices" }
		]
	},
	{
		text: "播放裝置",
		items: [
			{ text: "配對裝置", link: "/guide/pairing" },
			{ text: "離線播放", link: "/guide/offline" },
			{ text: "解除綁定", link: "/guide/unbind" },
			{ text: "在 Raspberry Pi 上安裝", link: "/guide/install-raspberry-pi" },
			{ text: "在 Ubuntu 上安裝", link: "/guide/install-ubuntu" },
			{ text: "在 Windows 上安裝", link: "/guide/install-windows" },
			{ text: "在 macOS 上安裝", link: "/guide/install-macos" }
		]
	},
	{
		text: "帳號",
		items: [
			{ text: "登入", link: "/guide/account" },
			{ text: "兩步驟驗證", link: "/guide/two-factor" },
			{ text: "使用者與權限", link: "/guide/users" }
		]
	},
	{ text: "疑難排解", link: "/guide/troubleshooting" }
];

/** 開發者：架設、擴充與理解系統怎麼運作。 */
const DEV_SIDEBAR = [
	{
		text: "開發環境",
		items: [
			{ text: "開始開發", link: "/dev/index" },
			{ text: "Monorepo", link: "/dev/monorepo" },
			{ text: "指令", link: "/dev/commands" },
			{ text: "測試", link: "/dev/testing" }
		]
	},
	{
		text: "架構",
		items: [
			{ text: "系統架構", link: "/dev/architecture" },
			{ text: "Server", link: "/dev/server" },
			{ text: "Worker", link: "/dev/worker" },
			{ text: "Device", link: "/dev/device" },
			{ text: "素材生命週期", link: "/dev/asset-lifecycle" },
			{ text: "Desired / Reported State", link: "/dev/desired-reported-state" },
			{ text: "版面與縮放", link: "/dev/layout-engine" },
			{ text: "排程與時區", link: "/dev/scheduling" },
			{ text: "協定", link: "/dev/protocol" }
		]
	},
	{
		text: "部署",
		items: [
			{ text: "Docker", link: "/dev/deploy/docker" },
			{ text: "環境變數", link: "/dev/deploy/environment" },
			{ text: "PostgreSQL", link: "/dev/deploy/postgresql" },
			{ text: "RustFS", link: "/dev/deploy/rustfs" },
			{ text: "GitHub Pages", link: "/dev/deploy/github-pages" },
			{ text: "發布", link: "/dev/release" }
		]
	},
	{
		text: "架構決策紀錄",
		collapsible: true,
		collapsed: true,
		items: [
			{ text: "總覽", link: "/dev/adr/index" },
			{ text: "0001 WebSocket 加 REST", link: "/dev/adr/0001-websocket-plus-rest" },
			{ text: "0002 Desired / Reported State", link: "/dev/adr/0002-desired-reported-state" },
			{ text: "0003 物件儲存只做暫存", link: "/dev/adr/0003-temporary-object-storage" },
			{ text: "0004 遞迴分割版面", link: "/dev/adr/0004-recursive-split-layout" },
			{ text: "0005 本機優先播放", link: "/dev/adr/0005-local-first-playback" },
			{ text: "0006 選擇 Electron", link: "/dev/adr/0006-electron" },
			{ text: "0007 PostgreSQL 工作佇列", link: "/dev/adr/0007-postgres-job-queue" }
		]
	},
	{ text: "疑難排解", link: "/dev/troubleshooting" }
];

export default defineConfig({
	root: "docs",
	base: "/",
	siteOrigin,
	lang: "zh-TW",
	title: "HUAN 讙",
	description: "跨平台的雲端媒體播放與數位看板系統",
	icon: "/favicon.svg",
	logo: {
		light: "/logo.svg",
		dark: "/logo-dark.svg"
	},
	logoText: "HUAN 讙",
	outDir: "doc_build",
	globalStyles: here("theme/styles.css"),

	/**
	 * Rspress 用 `html.rp-dark` 切換深色，@linyao.tw/ui 用 `data-lyds-theme`。
	 * 這段內嵌腳本在第一次繪製前就把兩者對齊，避免出現框架已經變黑、
	 * 內容還是亮色的半套畫面。
	 */
	head: [`<script>${THEME_BRIDGE_SCRIPT}</script>`],

	/** 產生 llms.txt、llms-full.txt 與每頁的 Markdown，讓 AI 工具直接讀得懂。 */
	llms: true,

	ssg: true,

	i18nSource: defaults => {
		const merged: Record<string, Record<string, string>> = { ...defaults };
		for (const [key, value] of Object.entries(THEME_TEXT_ZH_TW)) {
			merged[key] = { ...(merged[key] ?? {}), "zh-TW": value };
		}
		return merged;
	},

	themeConfig: {
		darkMode: true,
		search: true,
		enableScrollToTop: true,
		lastUpdated: true,
		socialLinks: [{ icon: "github", mode: "link", content: "https://github.com/linyao-tw/huan" }],
		footer: {
			message: "HUAN 讙 — 麟曜數位工作室。採購請來信 contact@linyao.tw。"
		},
		/** 整份文件只有兩個入口：給使用者的，和給開發者的。 */
		nav: [
			{ text: "使用教學", link: "/index", activeMatch: "^/(index|guide)" },
			{ text: "開發者", link: "/dev/index", activeMatch: "^/dev" }
		],
		sidebar: {
			"/dev/": DEV_SIDEBAR,
			"/guide/": GUIDE_SIDEBAR,
			"/": GUIDE_SIDEBAR
		}
	}
});
