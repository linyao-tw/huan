import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const routes = (await readFile("/tmp/routes-devrest.txt", "utf8")).split("\n").filter(Boolean);
const b = await chromium.launch();
for (const [vn, w, h] of [
	["desktop", 1600, 1000],
	["laptop", 1280, 800]
]) {
	for (const route of routes) {
		const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: "light" });
		await p.goto("http://localhost:4322" + route, { waitUntil: "domcontentloaded" });
		const r = await p.evaluate(() => {
			const sb = document.querySelector(".sidebar");
			const a = document.querySelector('.sidebar [aria-current="page"]');
			if (!a) return { active: null, st: sb.scrollTop, sh: sb.scrollHeight, ch: sb.clientHeight };
			const sr = sb.getBoundingClientRect(),
				ar = a.getBoundingClientRect();
			return {
				text: a.textContent.trim(),
				st: sb.scrollTop,
				sh: Math.round(sb.scrollHeight),
				ch: Math.round(sb.clientHeight),
				visible: ar.top >= sr.top && ar.bottom <= sr.bottom,
				offTop: Math.round(ar.top - sr.top),
				offBottom: Math.round(ar.bottom - sr.bottom)
			};
		});
		console.log(vn, route.padEnd(40), JSON.stringify(r));
		await p.close();
	}
}
await b.close();
