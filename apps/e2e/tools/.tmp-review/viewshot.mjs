import { chromium } from "@playwright/test";
const [outDir, scheme, ...rest] = process.argv.slice(2);
const routes = rest[0].split(",");
const b = await chromium.launch();
for (const route of routes) {
	for (const [name, w, h] of [
		["mobile", 375, 812],
		["desktop", 1600, 1000]
	]) {
		const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
		await p.goto("http://localhost:4322" + route, { waitUntil: "networkidle" });
		await p.waitForTimeout(1500);
		const slug = route.replace(/^\//, "").replace(/\//g, "_");
		await p.screenshot({ path: `${outDir}/${slug}--${name}--${scheme}--view.png` });
		if (name === "mobile") {
			await p.click("#menu-button");
			await p.waitForTimeout(500);
			await p.screenshot({ path: `${outDir}/${slug}--${name}--${scheme}--drawer.png` });
		}
		await p.close();
	}
}
await b.close();
console.log("done");
