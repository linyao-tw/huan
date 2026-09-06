export interface NavLink {
	label: string;
	/** 集合中的 id，不含副檔名。根目錄的入口是 `index`。 */
	id: string;
}

export interface NavGroup {
	label: string;
	items: NavLink[];
	/** 預設收合。只有 ADR 這種參考資料需要，一般章節保持展開。 */
	collapsed?: boolean;
}

export type NavNode = NavLink | NavGroup;

export function isGroup(node: NavNode): node is NavGroup {
	return "items" in node;
}

export interface Section {
	/** 導覽列上的名稱。 */
	label: string;
	/** 這個區塊的入口頁。 */
	entry: string;
	/** 判斷目前頁面屬於哪個區塊。 */
	match: (id: string) => boolean;
	nav: NavNode[];
}

/** 使用教學：寫給實際操作 HUAN 的人。不談程式碼、指令或部署。 */
const GUIDE: NavNode[] = [
	{
		label: "開始使用",
		items: [
			{ label: "快速開始", id: "index" },
			{ label: "核心概念", id: "guide/concepts" }
		]
	},
	{
		label: "日常操作",
		items: [
			{ label: "上傳素材", id: "guide/media" },
			{ label: "設計版面", id: "guide/layouts" },
			{ label: "安排播放時段", id: "guide/schedules" },
			{ label: "管理裝置", id: "guide/devices" }
		]
	},
	{
		label: "播放裝置",
		items: [
			{ label: "配對裝置", id: "guide/pairing" },
			{ label: "離線播放", id: "guide/offline" },
			{ label: "解除綁定", id: "guide/unbind" },
			{ label: "在 Raspberry Pi 上安裝", id: "guide/install-raspberry-pi" },
			{ label: "在 Ubuntu 上安裝", id: "guide/install-ubuntu" },
			{ label: "在 Windows 上安裝", id: "guide/install-windows" },
			{ label: "在 macOS 上安裝", id: "guide/install-macos" }
		]
	},
	{
		label: "帳號",
		items: [
			{ label: "登入", id: "guide/account" },
			{ label: "兩步驟驗證", id: "guide/two-factor" },
			{ label: "使用者與權限", id: "guide/users" }
		]
	},
	{ label: "疑難排解", id: "guide/troubleshooting" }
];

/** 開發者：寫給要架設、修改或部署 HUAN 的人。 */
const DEV: NavNode[] = [
	{
		label: "開發環境",
		items: [
			{ label: "開始開發", id: "dev/index" },
			{ label: "Monorepo", id: "dev/monorepo" },
			{ label: "指令", id: "dev/commands" },
			{ label: "測試", id: "dev/testing" }
		]
	},
	{
		label: "架構",
		items: [
			{ label: "系統架構", id: "dev/architecture" },
			{ label: "Server", id: "dev/server" },
			{ label: "Worker", id: "dev/worker" },
			{ label: "Device", id: "dev/device" },
			{ label: "素材生命週期", id: "dev/asset-lifecycle" },
			{ label: "Desired / Reported State", id: "dev/desired-reported-state" },
			{ label: "版面與縮放", id: "dev/layout-engine" },
			{ label: "排程與時區", id: "dev/scheduling" },
			{ label: "協定", id: "dev/protocol" }
		]
	},
	{
		label: "部署",
		items: [
			{ label: "Docker", id: "dev/deploy/docker" },
			{ label: "環境變數", id: "dev/deploy/environment" },
			{ label: "PostgreSQL", id: "dev/deploy/postgresql" },
			{ label: "RustFS", id: "dev/deploy/rustfs" },
			{ label: "GitHub Pages", id: "dev/deploy/github-pages" },
			{ label: "發布", id: "dev/release" }
		]
	},
	{
		label: "架構決策紀錄",
		collapsed: true,
		items: [
			{ label: "總覽", id: "dev/adr/index" },
			{ label: "0001 WebSocket 加 REST", id: "dev/adr/0001-websocket-plus-rest" },
			{ label: "0002 Desired / Reported State", id: "dev/adr/0002-desired-reported-state" },
			{ label: "0003 物件儲存只做暫存", id: "dev/adr/0003-temporary-object-storage" },
			{ label: "0004 遞迴分割版面", id: "dev/adr/0004-recursive-split-layout" },
			{ label: "0005 本機優先播放", id: "dev/adr/0005-local-first-playback" },
			{ label: "0006 選擇 Electron", id: "dev/adr/0006-electron" },
			{ label: "0007 PostgreSQL 工作佇列", id: "dev/adr/0007-postgres-job-queue" }
		]
	},
	{ label: "疑難排解", id: "dev/troubleshooting" }
];

export const SECTIONS: Section[] = [
	{ label: "使用教學", entry: "index", match: id => !id.startsWith("dev/"), nav: GUIDE },
	{ label: "開發者", entry: "dev/index", match: id => id.startsWith("dev/"), nav: DEV }
];

export function sectionFor(id: string): Section {
	return SECTIONS.find(section => section.match(id)) ?? SECTIONS[0]!;
}

/** 集合 id → 網址。`index` 是根路徑，`dev/index` 是 `/dev`。 */
export function hrefFor(id: string): string {
	if (id === "index") return "/";
	return `/${id.replace(/\/index$/, "")}`;
}

export function flatten(nav: NavNode[]): NavLink[] {
	return nav.flatMap(node => (isGroup(node) ? node.items : [node]));
}

/** 同一個區塊內的上一頁與下一頁。跨區塊不串接，兩邊的讀者不一樣。 */
export function neighbours(id: string): { previous?: NavLink; next?: NavLink } {
	const order = flatten(sectionFor(id).nav);
	const index = order.findIndex(item => item.id === id);
	if (index === -1) return {};
	return { previous: order[index - 1], next: order[index + 1] };
}
