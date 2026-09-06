import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const route of ["/guide/account", "/guide/layouts", "/guide/concepts", "/"]) {
	const p = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, colorScheme: "light" });
	await p.goto("http://localhost:4322" + route, { waitUntil: "networkidle" });
	const r = await p.evaluate(() => ({
		innerWidth: window.innerWidth,
		docClientWidth: document.documentElement.clientWidth,
		m400: window.matchMedia("(max-width:400px)").matches,
		m900: window.matchMedia("(max-width:900px)").matches,
		han: getComputedStyle(document.querySelector(".site-brand__han")).display,
		label: getComputedStyle(document.querySelector(".search-trigger__label")).display,
		sections: getComputedStyle(document.querySelector(".site-sections")).display,
		sidebarSections: getComputedStyle(document.querySelector(".sidebar__sections")).display,
		menuBtn: getComputedStyle(document.querySelector(".menu-button")).display,
		sheets: [...document.styleSheets].map(s => s.href || "inline").length,
		scrollH: document.documentElement.scrollHeight
	}));
	console.log(route, JSON.stringify(r));
	await p.close();
}
await b.close();
