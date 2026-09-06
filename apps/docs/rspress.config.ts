import { defineConfig } from "@rspress/core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (relative: string): string => resolve(fileURLToPath(new URL(".", import.meta.url)), relative);

/**
 * GitHub Pages 會把站台放在 `<owner>.github.io/<repo>/` 之下，
 * 因此 base 與 siteOrigin 必須由 workflow 帶進來，不能寫死在這裡；
 * 本機開發時兩者都退回根路徑。
 */
const base = process.env.DOCS_BASE ?? "/";
const siteOrigin = process.env.DOCS_SITE_ORIGIN;

export default defineConfig({
	root: "docs",
	base,
	...(siteOrigin ? { siteOrigin } : {}),
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
	 * 產生 llms.txt、llms-full.txt 與每一頁的 Markdown 版本，
	 * 讓 AI 工具不必解析 HTML 就能讀懂整份文件。
	 */
	llms: true,

	ssg: true,

	themeConfig: {
		darkMode: true,
		search: true,
		enableScrollToTop: true,
		outlineTitle: "本頁內容",
		lastUpdated: true,
		lastUpdatedText: "最後更新",
		prevPageText: "上一頁",
		nextPageText: "下一頁",
		socialLinks: [{ icon: "github", mode: "link", content: "https://github.com/linyao-tw/huan" }],
		footer: {
			message: "HUAN 讙 — 麟曜數位工作室。採購請來信 contact@linyao.tw。"
		},
		nav: [
			{ text: "快速開始", link: "/guide/getting-started" },
			{ text: "架構", link: "/architecture/overview" },
			{ text: "部署", link: "/deployment/docker" },
			{ text: "管理員", link: "/admin/login" },
			{ text: "Device", link: "/device/raspberry-pi" },
			{ text: "開發", link: "/development/monorepo" }
		],
		sidebar: {
			"/guide/": [
				{
					text: "開始使用",
					items: [
						{ text: "HUAN 是什麼", link: "/guide/index" },
						{ text: "快速開始", link: "/guide/getting-started" },
						{ text: "核心概念", link: "/guide/concepts" }
					]
				}
			],
			"/architecture/": [
				{
					text: "架構",
					items: [
						{ text: "系統架構", link: "/architecture/overview" },
						{ text: "Server", link: "/architecture/server" },
						{ text: "Worker", link: "/architecture/worker" },
						{ text: "Device", link: "/architecture/device" },
						{ text: "素材生命週期", link: "/architecture/asset-lifecycle" },
						{ text: "Desired / Reported State", link: "/architecture/desired-reported-state" },
						{ text: "版面與縮放", link: "/architecture/layout-engine" },
						{ text: "排程與時區", link: "/architecture/scheduling" }
					]
				},
				{
					text: "架構決策紀錄",
					collapsible: true,
					items: [
						{ text: "總覽", link: "/architecture/adr/index" },
						{ text: "ADR-0001 WebSocket 加 REST", link: "/architecture/adr/0001-websocket-plus-rest" },
						{ text: "ADR-0002 Desired / Reported State", link: "/architecture/adr/0002-desired-reported-state" },
						{ text: "ADR-0003 物件儲存只做暫存", link: "/architecture/adr/0003-temporary-object-storage" },
						{ text: "ADR-0004 遞迴分割版面", link: "/architecture/adr/0004-recursive-split-layout" },
						{ text: "ADR-0005 本機優先播放", link: "/architecture/adr/0005-local-first-playback" },
						{ text: "ADR-0006 選擇 Electron", link: "/architecture/adr/0006-electron" },
						{ text: "ADR-0007 PostgreSQL 工作佇列", link: "/architecture/adr/0007-postgres-job-queue" }
					]
				}
			],
			"/deployment/": [
				{
					text: "部署",
					items: [
						{ text: "Docker", link: "/deployment/docker" },
						{ text: "環境變數", link: "/deployment/environment" },
						{ text: "PostgreSQL", link: "/deployment/postgresql" },
						{ text: "RustFS", link: "/deployment/rustfs" },
						{ text: "GitHub Pages", link: "/deployment/github-pages" }
					]
				}
			],
			"/admin/": [
				{
					text: "管理員手冊",
					items: [
						{ text: "登入", link: "/admin/login" },
						{ text: "兩步驟驗證", link: "/admin/two-factor" },
						{ text: "使用者", link: "/admin/users" },
						{ text: "素材", link: "/admin/media" },
						{ text: "排版", link: "/admin/layouts" },
						{ text: "排程", link: "/admin/schedules" },
						{ text: "裝置", link: "/admin/devices" }
					]
				}
			],
			"/device/": [
				{
					text: "Device",
					items: [
						{ text: "Raspberry Pi", link: "/device/raspberry-pi" },
						{ text: "Windows", link: "/device/windows" },
						{ text: "Ubuntu", link: "/device/ubuntu" },
						{ text: "macOS", link: "/device/macos" },
						{ text: "配對", link: "/device/pairing" },
						{ text: "離線播放", link: "/device/offline" },
						{ text: "解除綁定", link: "/device/unbind" }
					]
				}
			],
			"/development/": [
				{
					text: "開發",
					items: [
						{ text: "Monorepo", link: "/development/monorepo" },
						{ text: "指令", link: "/development/commands" },
						{ text: "測試", link: "/development/testing" },
						{ text: "協定", link: "/development/protocol" },
						{ text: "發布", link: "/development/release" }
					]
				}
			],
			"/troubleshooting": []
		}
	}
});
