import { checkEnvironment, createHarness, createUser, extractSessionCookie, login, type TestHarness } from "@/test/helpers";
import { generateTotp } from "@huan/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] TOTP 整合測試：${environment.reason}`);

const STEP_MS = 30_000;

suite("兩階段驗證", () => {
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

	async function startChallenge(identifier: string, password: string): Promise<string> {
		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier, password } });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.status).toBe("totp_required");
		expect(extractSessionCookie(response.headers["set-cookie"])).toBeNull();
		return body.challengeToken;
	}

	it("綁定、啟用、以驗證碼與復原碼完成登入", async () => {
		const user = await createUser(harness, { password: "totp-flow-password-1" });
		const cookie = await login(harness, user.email, user.password);

		const setup = await harness.app.inject({ method: "POST", url: harness.url("/security/totp/setup"), headers: { cookie }, payload: { password: user.password } });
		expect(setup.statusCode).toBe(200);
		const { secret, otpauthUri, qrCodeDataUrl } = setup.json();
		expect(secret).toMatch(/^[A-Z2-7]+$/);
		expect(otpauthUri).toContain("otpauth://totp/");
		expect(qrCodeDataUrl.startsWith("data:image/png;base64,")).toBe(true);

		/** 啟用前 2FA 還沒生效，登入應該直接成功。 */
		const beforeActivation = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		expect(beforeActivation.json().status).toBe("authenticated");

		const activate = await harness.app.inject({
			method: "POST",
			url: harness.url("/security/totp/activate"),
			headers: { cookie },
			payload: { code: await generateTotp(secret) }
		});
		expect(activate.statusCode).toBe(200);
		const recoveryCodes: string[] = activate.json().recoveryCodes;
		expect(recoveryCodes).toHaveLength(10);
		expect(new Set(recoveryCodes).size).toBe(10);

		/** 啟用之後，安全設定不再回傳密鑰。 */
		const overview = await harness.app.inject({ method: "GET", url: harness.url("/security"), headers: { cookie } });
		expect(overview.json()).toMatchObject({ totpEnabled: true, recoveryCodesRemaining: 10 });
		expect(overview.body).not.toContain(secret);

		const challengeToken = await startChallenge(user.email, user.password);

		/** 換下一個時間步長的驗證碼：啟用時用掉的步長不能再被重放。 */
		const nextStepCode = await generateTotp(secret, Date.now() + STEP_MS);
		const completed = await harness.app.inject({ method: "POST", url: harness.url("/auth/totp/challenge"), payload: { challengeToken, code: nextStepCode } });
		expect(completed.statusCode).toBe(200);
		expect(extractSessionCookie(completed.headers["set-cookie"])).toBeTruthy();

		/** 同一張 challenge 不能用第二次。 */
		const replayed = await harness.app.inject({ method: "POST", url: harness.url("/auth/totp/challenge"), payload: { challengeToken, code: await generateTotp(secret, Date.now() + 2 * STEP_MS) } });
		expect(replayed.statusCode).toBe(401);

		const recoveryCode = recoveryCodes[0] ?? "";
		const secondChallenge = await startChallenge(user.email, user.password);
		const withRecovery = await harness.app.inject({ method: "POST", url: harness.url("/auth/totp/challenge"), payload: { challengeToken: secondChallenge, recoveryCode } });
		expect(withRecovery.statusCode).toBe(200);
		expect(extractSessionCookie(withRecovery.headers["set-cookie"])).toBeTruthy();

		/** 復原碼是一次性的：第二次同一組碼必須失敗。 */
		const thirdChallenge = await startChallenge(user.email, user.password);
		const reusedRecovery = await harness.app.inject({ method: "POST", url: harness.url("/auth/totp/challenge"), payload: { challengeToken: thirdChallenge, recoveryCode } });
		expect(reusedRecovery.statusCode).toBe(401);

		const afterUse = await harness.app.inject({ method: "GET", url: harness.url("/security"), headers: { cookie } });
		expect(afterUse.json().recoveryCodesRemaining).toBe(9);
	});

	it("錯誤的驗證碼無法完成 challenge", async () => {
		const user = await createUser(harness, { password: "totp-wrong-code-pass" });
		const cookie = await login(harness, user.email, user.password);
		const setup = await harness.app.inject({ method: "POST", url: harness.url("/security/totp/setup"), headers: { cookie }, payload: { password: user.password } });
		const { secret } = setup.json();
		await harness.app.inject({ method: "POST", url: harness.url("/security/totp/activate"), headers: { cookie }, payload: { code: await generateTotp(secret) } });

		const challengeToken = await startChallenge(user.email, user.password);
		const wrong = await harness.app.inject({ method: "POST", url: harness.url("/auth/totp/challenge"), payload: { challengeToken, code: "000000" } });
		expect(wrong.statusCode).toBe(401);
	});

	it("設定 2FA 前必須先確認密碼", async () => {
		const user = await createUser(harness, { password: "totp-needs-password-1" });
		const cookie = await login(harness, user.email, user.password);
		const response = await harness.app.inject({ method: "POST", url: harness.url("/security/totp/setup"), headers: { cookie }, payload: { password: "not-the-real-password" } });
		expect(response.statusCode).toBe(401);
	});

	it("停用之後登入不再需要第二階段", async () => {
		const user = await createUser(harness, { password: "totp-disable-password" });
		const cookie = await login(harness, user.email, user.password);
		const setup = await harness.app.inject({ method: "POST", url: harness.url("/security/totp/setup"), headers: { cookie }, payload: { password: user.password } });
		const { secret } = setup.json();
		await harness.app.inject({ method: "POST", url: harness.url("/security/totp/activate"), headers: { cookie }, payload: { code: await generateTotp(secret) } });

		const disable = await harness.app.inject({
			method: "POST",
			url: harness.url("/security/totp/disable"),
			headers: { cookie },
			payload: { password: user.password, code: await generateTotp(secret, Date.now() + STEP_MS) }
		});
		expect(disable.statusCode).toBe(200);

		const response = await harness.app.inject({ method: "POST", url: harness.url("/auth/login"), payload: { identifier: user.email, password: user.password } });
		expect(response.json().status).toBe("authenticated");
	});
});
