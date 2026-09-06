import { checkEnvironment, createHarness, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] OpenAPI 整合測試：${environment.reason}`);

suite("OpenAPI 文件", () => {
	let harness: TestHarness;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	it("由 zod schema 產生完整的 OpenAPI 文件", async () => {
		const response = await harness.app.inject({ method: "GET", url: harness.url("/openapi.json") });
		expect(response.statusCode).toBe(200);

		const document = response.json();
		expect(document.openapi.startsWith("3.")).toBe(true);
		expect(document.info.title).toContain("HUAN");

		const paths = Object.keys(document.paths);
		for (const path of [
			"/api/v1/auth/login",
			"/api/v1/auth/totp/challenge",
			"/api/v1/security/totp/setup",
			"/api/v1/users",
			"/api/v1/media/uploads",
			"/api/v1/media/uploads/complete",
			"/api/v1/layouts/{id}/publish",
			"/api/v1/schedules",
			"/api/v1/devices/{id}/force-sync",
			"/api/v1/pairing/confirm",
			"/api/v1/device/pairing/start",
			"/api/v1/device/state",
			"/api/v1/device/assets/{variantId}/url",
			"/api/v1/audit-logs",
			"/health/live",
			"/health/ready"
		]) {
			expect(paths, `${path} 應該出現在 OpenAPI 文件中`).toContain(path);
		}

		/** WebSocket 路由不是 REST 端點，不應該出現在文件裡。 */
		expect(paths).not.toContain("/api/v1/devices/socket");
		expect(paths).not.toContain("/api/v1/admin/socket");

		/** 登入的請求與回應結構要真的被展開，而不是一個空的 schema。 */
		const loginBody = document.paths["/api/v1/auth/login"].post.requestBody.content["application/json"].schema;
		expect(Object.keys(loginBody.properties)).toEqual(["identifier", "password"]);
	});

	it("非 production 提供互動式文件", async () => {
		const redirect = await harness.app.inject({ method: "GET", url: harness.url("/docs") });
		expect(redirect.statusCode).toBe(301);

		const page = await harness.app.inject({ method: "GET", url: harness.url("/docs/") });
		expect(page.statusCode).toBe(200);
		expect(page.headers["content-type"]).toContain("text/html");
	});
});
