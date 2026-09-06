import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "light" });
await p.goto("http://localhost:4322/dev/adr/0001-websocket-plus-rest", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.click("#menu-button");
await p.waitForTimeout(600);
console.log(
	JSON.stringify(
		await p.evaluate(() => {
			const s = document.querySelector(".scrim");
			const cs = getComputedStyle(s);
			const sb = document.querySelector(".sidebar");
			return {
				scrimOpen: s.dataset.open,
				opacity: cs.opacity,
				vis: cs.visibility,
				bg: cs.background.slice(0, 90),
				z: cs.zIndex,
				sbOpen: sb.dataset.open,
				sbz: getComputedStyle(sb).zIndex,
				sbx: Math.round(sb.getBoundingClientRect().x),
				bodyOverflow: getComputedStyle(document.body).overflow,
				scrimVar: getComputedStyle(document.documentElement).getPropertyValue("--background-scrim")
			};
		}),
		null,
		1
	)
);
await b.close();
