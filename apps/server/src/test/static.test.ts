import { buildServer, type HuanServer } from "@/app";
import { createContext, type AppContext } from "@/context";
import { loadEnv } from "@/env";
import { checkEnvironment } from "@/test/helpers";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 靜態檔案整合測試：${environment.reason}`);

suite("Admin 靜態檔案服務", () => {
	let app: HuanServer;
	let ctx: AppContext;

	beforeAll(async () => {
		const distDir = await mkdtemp(join(tmpdir(), "huan-admin-dist-"));
		await writeFile(join(distDir, "index.html"), "<!doctype html><title>HUAN Admin</title>", "utf8");
		await writeFile(join(distDir, "app.css"), "body{margin:0}", "utf8");

		const env = { ...loadEnv(), ADMIN_DIST_DIR: distDir };
		ctx = createContext({ env });
		app = await buildServer({ env, context: ctx, logger: false, rateLimits: { global: 100_000 } });
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		await ctx.close();
	});

	it("實體檔案照原樣送出", async () => {
		const response = await app.inject({ method: "GET", url: "/app.css" });
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("margin:0");
	});

	it("前端路由回退到 index.html", async () => {
		for (const path of ["/", "/devices", "/layouts/abc"]) {
			const response = await app.inject({ method: "GET", url: path });
			expect(response.statusCode, `${path} 應該回 SPA 進入點`).toBe(200);
			expect(response.body).toContain("HUAN Admin");
		}
	});

	it("API 與健康檢查路徑的 404 仍然是 JSON", async () => {
		for (const path of ["/api/v1/nope", "/health/nope"]) {
			const response = await app.inject({ method: "GET", url: path });
			expect(response.statusCode).toBe(404);
			expect(response.json().code).toBe("not_found");
		}
	});
});
