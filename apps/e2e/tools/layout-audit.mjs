/**
 * 版面稽核：對指定路由在多個視窗寬度下截圖，並自動找出客觀的跑版問題。
 *
 * 「看起來怪怪的」只能靠人眼，但「內容超出視窗」「元素互相重疊」「文字被裁掉」
 * 是可以量出來的。先把這些抓出來，人再去看剩下的。
 *
 * 用法：
 *   node tools/layout-audit.mjs --routes /dev,/guide/media --out /tmp/audit --base http://localhost:4322
 *   node tools/layout-audit.mjs --routes-file /tmp/huan-routes.txt --out /tmp/audit
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [
	{ name: "mobile", width: 375, height: 812 },
	{ name: "tablet", width: 768, height: 1024 },
	{ name: "laptop", width: 1280, height: 800 },
	{ name: "desktop", width: 1600, height: 1000 }
];

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? "http://localhost:4322";
const outDir = args.out ?? "/tmp/huan-layout-audit";
const scheme = args.scheme ?? "light";
const only = args.viewport;

let routes = [];
if (args["routes-file"]) {
	const { readFile } = await import("node:fs/promises");
	routes = (await readFile(args["routes-file"], "utf8")).split("\n").filter(Boolean);
} else if (args.routes) {
	routes = args.routes.split(",").filter(Boolean);
} else {
	console.error("需要 --routes 或 --routes-file");
	process.exit(2);
}

const viewports = only ? VIEWPORTS.filter(v => v.name === only) : VIEWPORTS;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const findings = [];

for (const route of routes) {
	for (const viewport of viewports) {
		const page = await browser.newPage({
			viewport: { width: viewport.width, height: viewport.height },
			deviceScaleFactor: 1,
			colorScheme: scheme
		});

		const consoleErrors = [];
		page.on("pageerror", error => consoleErrors.push(String(error)));
		page.on("console", message => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});

		await page.goto(base + route, { waitUntil: "networkidle" });
		/* mermaid 是前端算繪的，等它畫完再量，否則量到的是還沒有圖的高度。 */
		await page.waitForTimeout(1400);

		const report = await page.evaluate(vw => {
			const problems = [];
			const doc = document.documentElement;

			/* 1. 整頁橫向捲動：最常見、也最明顯的跑版。 */
			if (doc.scrollWidth > vw + 1) {
				problems.push({ kind: "page-overflow", detail: `文件寬度 ${doc.scrollWidth}px 超出視窗 ${vw}px` });
			}

			/*
			 * 2. 找出實際突出視窗右緣的元素，指出是誰造成的。
			 *
			 * 跳過祖先本身就會橫向捲動的元素：程式碼區塊裡的長行本來就會超出
			 * 容器，那是 `overflow-x: auto` 正常運作，不是跑版。
			 */
			const insideScroller = element => {
				for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
					const overflowX = getComputedStyle(node).overflowX;
					if (overflowX === "auto" || overflowX === "scroll") return true;
				}
				return false;
			};

			const culprits = [];
			for (const element of document.querySelectorAll("body *")) {
				const style = getComputedStyle(element);
				if (style.position === "fixed" || style.display === "none" || style.visibility === "hidden") continue;
				const rect = element.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) continue;
				if (insideScroller(element)) continue;
				if (rect.right > vw + 1) {
					culprits.push({
						tag: element.tagName.toLowerCase(),
						cls: (element.className || "").toString().slice(0, 60),
						right: Math.round(rect.right),
						width: Math.round(rect.width)
					});
				}
			}
			/* 只留最外層的那幾個，子元素跟著爆出去沒有額外資訊。 */
			if (culprits.length > 0) {
				problems.push({ kind: "element-overflow", detail: culprits.slice(0, 5) });
			}

			/* 3. 內容被固定頁首蓋住。 */
			const header = document.querySelector(".site-header");
			const heading = document.querySelector(".content h1");
			if (header && heading) {
				const headerRect = header.getBoundingClientRect();
				const headingRect = heading.getBoundingClientRect();
				if (headingRect.top < headerRect.bottom && headingRect.bottom > headerRect.top) {
					problems.push({ kind: "header-overlap", detail: `h1 頂端 ${Math.round(headingRect.top)} 落在頁首下緣 ${Math.round(headerRect.bottom)} 之上` });
				}
			}

			/* 4. 表格與程式碼區塊要能自己捲動，不能撐破版面。 */
			for (const pre of document.querySelectorAll(".prose pre")) {
				const style = getComputedStyle(pre);
				if (pre.scrollWidth > pre.clientWidth + 1 && style.overflowX !== "auto" && style.overflowX !== "scroll") {
					problems.push({ kind: "code-not-scrollable", detail: `pre 內容 ${pre.scrollWidth}px 超出 ${pre.clientWidth}px 但沒有捲動` });
					break;
				}
			}
			for (const table of document.querySelectorAll(".prose table")) {
				const wrapper = table.parentElement;
				const wrapped = wrapper && wrapper.classList.contains("table-scroll");
				if (!wrapped && table.scrollWidth > (wrapper?.clientWidth ?? 0) + 1) {
					problems.push({ kind: "table-not-wrapped", detail: "表格沒有可捲動的外框" });
					break;
				}
			}

			/* 5. 圖片溢出容器。 */
			for (const img of document.querySelectorAll(".prose img")) {
				const rect = img.getBoundingClientRect();
				if (rect.right > vw + 1) {
					problems.push({ kind: "image-overflow", detail: `圖片右緣 ${Math.round(rect.right)} 超出視窗` });
					break;
				}
			}

			/* 6. 主要區塊在小螢幕上是否還看得到。 */
			const main = document.querySelector(".content");
			if (main) {
				const rect = main.getBoundingClientRect();
				if (rect.width < 200) problems.push({ kind: "content-too-narrow", detail: `內容欄只有 ${Math.round(rect.width)}px` });
			}

			return {
				problems,
				scrollWidth: doc.scrollWidth,
				sidebarVisible: (() => {
					const sidebar = document.querySelector(".sidebar");
					if (!sidebar) return null;
					const style = getComputedStyle(sidebar);
					const rect = sidebar.getBoundingClientRect();
					return style.position === "fixed" ? `fixed(${Math.round(rect.x)})` : "static";
				})(),
				tocVisible: (() => {
					const toc = document.querySelector(".toc");
					if (!toc) return "none";
					return getComputedStyle(toc).display === "none" ? "hidden" : "visible";
				})()
			};
		}, viewport.width);

		const slug = (route === "/" ? "index" : route.replace(/^\//, "").replace(/\//g, "_")) + `--${viewport.name}--${scheme}`;
		const file = join(outDir, `${slug}.png`);
		await page.screenshot({ path: file, fullPage: true });

		findings.push({
			route,
			viewport: viewport.name,
			width: viewport.width,
			screenshot: file,
			consoleErrors,
			...report
		});

		await page.close();
	}
}

await browser.close();

const withProblems = findings.filter(f => f.problems.length > 0 || f.consoleErrors.length > 0);
await writeFile(join(outDir, "report.json"), JSON.stringify(findings, null, "\t"));

console.log(`稽核 ${routes.length} 個路由 × ${viewports.length} 個寬度 = ${findings.length} 張截圖`);
console.log(`輸出：${outDir}`);
console.log(`有問題的組合：${withProblems.length}`);
for (const item of withProblems) {
	console.log(`\n✗ ${item.route} @ ${item.viewport}(${item.width}px)`);
	for (const problem of item.problems) {
		console.log(`   [${problem.kind}] ${typeof problem.detail === "string" ? problem.detail : JSON.stringify(problem.detail)}`);
	}
	for (const error of item.consoleErrors) console.log(`   [console] ${error}`);
}
if (withProblems.length === 0) console.log("\n自動檢查沒有發現客觀的跑版問題。");
