import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "light" });
await p.goto("http://localhost:4322/dev/adr", { waitUntil: "networkidle" });
const r = await p.evaluate(() => {
	const sel = [".site-header__rail", ".site-brand", ".site-brand span:first-child", ".site-brand__han", ".search-trigger", ".site-header__actions", ".site-header__spacer", ".menu-button"];
	const out = {};
	for (const s of sel) {
		const el = document.querySelector(s);
		if (!el) {
			out[s] = "MISSING";
			continue;
		}
		const cs = getComputedStyle(el);
		const rc = el.getBoundingClientRect();
		out[s] = { x: Math.round(rc.x), w: Math.round(rc.width), h: Math.round(rc.height), display: cs.display, overflow: cs.overflow, fs: cs.fontSize, txt: (el.textContent || "").trim().slice(0, 20) };
	}
	return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
