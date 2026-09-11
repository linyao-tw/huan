import { checkEnvironment, createHarness, createUser, extractSessionCookie, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] auth 整合測試：${environment.reason}`);

suite("認證", () => {
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

	it("正確的帳密可以登入並取得 session cookie", async () => {
		const user = await createUser(harness, { password: "correct-horse-battery" });

		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: "authenticated", user: { email: user.email, role: "user" } });

		const cookie = extractSessionCookie(response.headers["set-cookie"]);
		expect(cookie).toBeTruthy();

		const rawSetCookie = response.headers["set-cookie"];
		const cookieHeader = Array.isArray(rawSetCookie) ? rawSetCookie.join(";") : String(rawSetCookie);
		expect(cookieHeader).toContain("HttpOnly");
		expect(cookieHeader).toContain("SameSite=Lax");

		const session = await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie: cookie ?? "" } });
		expect(session.statusCode).toBe(200);
		expect(session.json().user.id).toBe(user.id);
	});

	it("帳號可以取代 Email 當作登入識別字", async () => {
		const user = await createUser(harness);
		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.username, password: user.password } });
		expect(response.statusCode).toBe(200);
	});

	it("密碼錯誤回 401 invalid_credentials，而且不設 cookie", async () => {
		const user = await createUser(harness);
		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: "wrong-password-value" } });

		expect(response.statusCode).toBe(401);
		expect(response.json().code).toBe("invalid_credentials");
		expect(extractSessionCookie(response.headers["set-cookie"])).toBeNull();
	});

	it("不存在的帳號與密碼錯誤回同一種錯誤，不洩漏帳號是否存在", async () => {
		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: "nobody@huan.test", password: "whatever-password" } });
		expect(response.statusCode).toBe(401);
		expect(response.json().code).toBe("invalid_credentials");
	});

	it("停用的帳號即使密碼正確也無法登入", async () => {
		const user = await createUser(harness, { status: "disabled" });
		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });

		expect(response.statusCode).toBe(403);
		expect(response.json().code).toBe("forbidden");
	});

	it("連續失敗超過門檻後開始回 429 rate_limited", async () => {
		const user = await createUser(harness);
		const max = harness.ctx.env.LOGIN_RATE_LIMIT_MAX;

		for (let attempt = 0; attempt < max; attempt += 1) {
			const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: "definitely-wrong" } });
			expect(response.statusCode).toBe(401);
		}

		const blocked = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: "definitely-wrong" } });
		expect(blocked.statusCode).toBe(429);
		expect(blocked.json().code).toBe("rate_limited");

		/** 節流是針對「這次嘗試」，密碼正確與否都一樣要等，否則就成了帳號探測器。 */
		const withCorrectPassword = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		expect(withCorrectPassword.statusCode).toBe(429);
	});

	it("同一個帳號用 Email 或帳號登入共用同一個節流計數", async () => {
		const user = await createUser(harness);
		const max = harness.ctx.env.LOGIN_RATE_LIMIT_MAX;

		/**
		 * 每一次都換一個來源 IP，把 per-IP 節流排除掉，單獨驗 per-identifier 這一桶。
		 * 交替 Email 與帳號各打一半：若各自計數，兩桶都到不了門檻；併回同一桶才會在第
		 * max 次被擋。少了換 IP 的話，per-IP 會先湊到門檻，把這個行為蓋掉。
		 */
		for (let attempt = 0; attempt < max; attempt += 1) {
			const identifier = attempt % 2 === 0 ? user.email : user.username;
			const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), remoteAddress: `10.1.0.${attempt}`, payload: { identifier, password: "definitely-wrong" } });
			expect(response.statusCode).toBe(401);
		}

		const blocked = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), remoteAddress: "10.1.0.250", payload: { identifier: user.username, password: "definitely-wrong" } });
		expect(blocked.statusCode).toBe(429);
	});

	it("登出之後 session cookie 失效", async () => {
		const user = await createUser(harness);
		const loginResponse = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		const cookie = extractSessionCookie(loginResponse.headers["set-cookie"]) ?? "";

		const logout = await harness.app.inject({ method: "POST", url: harness.url("/auth/logout"), headers: { cookie } });
		expect(logout.statusCode).toBe(200);

		const afterLogout = await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie } });
		expect(afterLogout.statusCode).toBe(401);
	});

	it("變更密碼會讓其他 session 一起失效", async () => {
		const user = await createUser(harness, { password: "original-password-01" });
		const first = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		const second = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		const firstCookie = extractSessionCookie(first.headers["set-cookie"]) ?? "";
		const secondCookie = extractSessionCookie(second.headers["set-cookie"]) ?? "";

		const changed = await harness.app.inject({
			method: "POST",
			url: harness.url("/auth/password"),
			headers: { cookie: secondCookie },
			payload: { currentPassword: user.password, newPassword: "brand-new-password-02" }
		});
		expect(changed.statusCode).toBe(200);

		expect((await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie: firstCookie } })).statusCode).toBe(401);
		expect((await harness.app.inject({ method: "GET", url: harness.url("/auth/session"), headers: { cookie: secondCookie } })).statusCode).toBe(200);
	});

	it("健康檢查：live 永遠成功，ready 檢查資料庫", async () => {
		expect((await harness.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
		const ready = await harness.app.inject({ method: "GET", url: "/health/ready" });
		expect(ready.statusCode).toBe(200);
		expect(ready.json()).toMatchObject({ status: "ok", database: "ok" });
	});
});
