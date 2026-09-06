import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "light" });
await p.goto("http://localhost:4322/dev/adr", { waitUntil: "networkidle" });
await p.waitForTimeout(1600);
const r = await p.evaluate(() => {
	const sel = [".site-header__rail", ".site-brand", ".site-brand__han", ".search-trigger", ".site-header__actions"];
	const out = {};
	for (const s of sel) {
		const el = document.querySelector(s);
		if (!el) {
			out[s] = "MISSING";
			continue;
		}
		const cs = getComputedStyle(el);
		const rc = el.getBoundingClientRect();
		out[s] = { x: Math.round(rc.x), w: Math.round(rc.width), h: Math.round(rc.height), display: cs.display, vis: cs.visibility, op: cs.opacity, color: cs.color, fs: cs.fontSize };
	}
	out.han_visible = (() => {
		const e = document.querySelector(".site-brand__han");
		return e ? e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : null;
	})();
	return out;
});
console.log(JSON.stringify(r, null, 1));
await p.locator(".site-header").screenshot({ path: "/private/tmp/claude-501/-Users-em-uwu-huan/57d69ebf-c75c-436f-8721-95da1f7b2869/scratchpad/hdr-live.png" });
await b.close();
