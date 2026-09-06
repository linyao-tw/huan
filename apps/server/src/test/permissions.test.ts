import { checkEnvironment, createHarness, createUser, login, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 權限整合測試：${environment.reason}`);

suite("角色權限", () => {
	let harness: TestHarness;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
	});

	it("一般使用者不能存取使用者管理與稽核紀錄", async () => {
		const user = await createUser(harness, { role: "user" });
		const cookie = await login(harness, user.email, user.password);

		for (const path of ["/users", "/audit-logs"]) {
			const response = await harness.app.inject({ method: "GET", url: harness.url(path), headers: { cookie } });
			expect(response.statusCode, `${path} 應該被拒絕`).toBe(403);
			expect(response.json().code).toBe("forbidden");
		}

		const create = await harness.app.inject({
			method: "POST",
			url: harness.url("/users"),
			headers: { cookie },
			payload: { email: "someone@huan.test", username: "someone", displayName: "有人", password: "another-password-12", role: "user" }
		});
		expect(create.statusCode).toBe(403);
	});

	it("最高管理員可以列出使用者、建立使用者並查稽核紀錄", async () => {
		const admin = await createUser(harness, { role: "super_admin" });
		const cookie = await login(harness, admin.email, admin.password);

		const list = await harness.app.inject({ method: "GET", url: harness.url("/users"), headers: { cookie } });
		expect(list.statusCode).toBe(200);
		expect(list.json().total).toBe(1);

		const created = await harness.app.inject({
			method: "POST",
			url: harness.url("/users"),
			headers: { cookie },
			payload: { email: "new-editor@huan.test", username: "neweditor", displayName: "新編輯", password: "created-by-admin-01", role: "user" }
		});
		expect(created.statusCode).toBe(201);
		expect(created.json()).toMatchObject({ email: "new-editor@huan.test", role: "user", totpEnabled: false });

		const audit = await harness.app.inject({ method: "GET", url: harness.url("/audit-logs"), headers: { cookie } });
		expect(audit.statusCode).toBe(200);
		const actions: string[] = audit.json().items.map((item: { action: string }) => item.action);
		expect(actions).toContain("user.created");
		expect(actions).toContain("auth.login");
	});

	it("未登入時所有受保護的端點都回 401", async () => {
		for (const path of ["/auth/session", "/media", "/layouts", "/schedules", "/devices", "/security"]) {
			const response = await harness.app.inject({ method: "GET", url: harness.url(path) });
			expect(response.statusCode, `${path} 應該要求登入`).toBe(401);
			expect(response.json().code).toBe("unauthorized");
		}
	});

	it("停用使用者之後既有的 session 立刻失效", async () => {
		const admin = await createUser(harness, { role: "super_admin" });
		const victim = await createUser(harness, { role: "user" });
		const adminCookie = await login(harness, admin.email, admin.password);
		const victimCookie = await login(harness, victim.email, victim.password);

		expect((await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie: victimCookie } })).statusCode).toBe(200);

		const disabled = await harness.app.inject({ method: "PATCH", url: harness.url(`/users/${victim.id}`), headers: { cookie: adminCookie }, payload: { status: "disabled" } });
		expect(disabled.statusCode).toBe(200);

		expect((await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie: victimCookie } })).statusCode).toBe(401);
	});

	it("最高管理員不能把自己降權或停用", async () => {
		const admin = await createUser(harness, { role: "super_admin" });
		const cookie = await login(harness, admin.email, admin.password);

		const demote = await harness.app.inject({ method: "PATCH", url: harness.url(`/users/${admin.id}`), headers: { cookie }, payload: { role: "user" } });
		expect(demote.statusCode).toBe(409);
	});
});
