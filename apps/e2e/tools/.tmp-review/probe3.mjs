import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "light" });
await p.goto("http://localhost:4322/dev/adr", { waitUntil: "networkidle" });
await p.waitForTimeout(1400);
const before = await p.evaluate(() => ({
	iw: innerWidth,
	docw: document.documentElement.clientWidth,
	label: getComputedStyle(document.querySelector(".search-trigger__label")).display,
	menu: getComputedStyle(document.querySelector(".menu-button")).display,
	mq900: matchMedia("(max-width: 900px)").matches
}));
console.log("before", JSON.stringify(before));
await p.screenshot({ path: "/private/tmp/claude-501/-Users-em-uwu-huan/57d69ebf-c75c-436f-8721-95da1f7b2869/scratchpad/full375.png", fullPage: true });
const after = await p.evaluate(() => ({
	iw: innerWidth,
	docw: document.documentElement.clientWidth,
	label: getComputedStyle(document.querySelector(".search-trigger__label")).display,
	menu: getComputedStyle(document.querySelector(".menu-button")).display
}));
console.log("after", JSON.stringify(after));
// check stylesheet order / where the scoped rule lives
const css = await p.evaluate(() => Array.from(document.querySelectorAll("link[rel=stylesheet],style")).map(n => n.tagName + ":" + (n.href || "inline:" + (n.textContent || "").length)));
console.log(css.join("\n"));
await b.close();
