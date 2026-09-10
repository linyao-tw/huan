import { buildDesiredState } from "@/lib/desired-state";
import { checkEnvironment, createHarness, createTenant, createUser, login, scheduleBody, singleAssetDocument, type TenantFixture, type TestHarness } from "@/test/helpers";
import { layoutRevisions, layouts, scheduleDevices } from "@huan/db";
import { eq } from "drizzle-orm";
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

/**
 * 租戶隔離。
 *
 * 每個端點都各自查一次資料庫，所以「有一個地方漏了擁有者條件」不會在別的測試裡
 * 浮現，只會等到上線後由使用者發現。這組測試刻意窮舉 audit 清單上的每一條路徑，
 * 任何一個 where 少了 ownerId 都會有一條紅燈。
 */
suite("租戶隔離", () => {
	let harness: TestHarness;
	let alice: TenantFixture;
	let bob: TenantFixture;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
		alice = await createTenant(harness, "甲");
		bob = await createTenant(harness, "乙");
	});

	it("跨使用者的讀取、修改與刪除一律回 404", async () => {
		/** 回 404 而不是 403：403 等於承認「這個 id 存在但不是你的」，id 就變成可以列舉的。 */
		const cases: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; payload?: Record<string, unknown> }[] = [
			{ method: "GET", path: `/devices/${alice.deviceId}` },
			{ method: "PATCH", path: `/devices/${alice.deviceId}`, payload: { name: "被改名的裝置" } },
			{ method: "POST", path: `/devices/${alice.deviceId}/force-sync` },
			{ method: "POST", path: `/devices/${alice.deviceId}/restart-player` },
			{ method: "GET", path: `/media/${alice.asset.assetId}` },
			{ method: "GET", path: `/media/${alice.asset.assetId}/usage` },
			{ method: "POST", path: "/media/uploads/complete", payload: { assetId: alice.asset.assetId } },
			{ method: "PATCH", path: `/media/${alice.asset.assetId}`, payload: { name: "被改名的素材" } },
			{ method: "GET", path: `/layouts/${alice.layoutId}` },
			{ method: "PATCH", path: `/layouts/${alice.layoutId}`, payload: { name: "被改名的版面" } },
			{ method: "POST", path: `/layouts/${alice.layoutId}/publish`, payload: { note: null } },
			{ method: "GET", path: `/layouts/${alice.layoutId}/revisions/${alice.revisionId}` },
			{ method: "PATCH", path: `/schedules/${alice.scheduleId}`, payload: scheduleBody({ name: "被改名的排程", layoutId: bob.layoutId, deviceIds: [] }) },
			/** 刪除放最後，才不會讓前面的案例在「尚未修好」的狀態下先把資料清掉。 */
			{ method: "DELETE", path: `/media/${alice.asset.assetId}` },
			{ method: "DELETE", path: `/schedules/${alice.scheduleId}` },
			{ method: "DELETE", path: `/layouts/${alice.layoutId}` },
			{ method: "DELETE", path: `/devices/${alice.deviceId}` }
		];

		for (const testCase of cases) {
			const response = await harness.app.inject({
				method: testCase.method,
				url: harness.url(testCase.path),
				headers: { cookie: bob.cookie },
				...(testCase.payload ? { payload: testCase.payload } : {})
			});
			expect(response.statusCode, `${testCase.method} ${testCase.path} 應該回 404`).toBe(404);
			expect(response.json().code, `${testCase.method} ${testCase.path} 應該回 not_found`).toBe("not_found");
		}
	});

	it("別人的資料一筆都沒有被動到", async () => {
		for (const testCase of [
			{ method: "DELETE" as const, path: `/devices/${alice.deviceId}` },
			{ method: "DELETE" as const, path: `/layouts/${alice.layoutId}` },
			{ method: "DELETE" as const, path: `/schedules/${alice.scheduleId}` },
			{ method: "DELETE" as const, path: `/media/${alice.asset.assetId}` }
		]) {
			await harness.app.inject({ method: testCase.method, url: harness.url(testCase.path), headers: { cookie: bob.cookie } });
		}

		for (const path of [`/devices/${alice.deviceId}`, `/layouts/${alice.layoutId}`, `/media/${alice.asset.assetId}`]) {
			const response = await harness.app.inject({ method: "GET", url: harness.url(path), headers: { cookie: alice.cookie } });
			expect(response.statusCode, `${path} 對擁有者應該還在`).toBe(200);
		}
		const schedules = await harness.app.inject({ method: "GET", url: harness.url("/schedules"), headers: { cookie: alice.cookie } });
		expect(schedules.json().total).toBe(1);
		/** 物件也不能被刪掉：RustFS 上的 playback 產物沒有還原路徑。 */
		expect(await harness.ctx.storage.head(alice.asset.objectKey)).not.toBeNull();
	});

	it("每個列表都只回傳自己的資料", async () => {
		const expectations: { path: string; id: string }[] = [
			{ path: "/devices", id: bob.deviceId },
			{ path: "/media", id: bob.asset.assetId },
			{ path: "/layouts", id: bob.layoutId },
			{ path: "/schedules", id: bob.scheduleId }
		];

		for (const expectation of expectations) {
			const response = await harness.app.inject({ method: "GET", url: harness.url(expectation.path), headers: { cookie: bob.cookie } });
			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.total, `${expectation.path} 的總數應該只算自己的`).toBe(1);
			expect(
				body.items.map((item: { id: string }) => item.id),
				`${expectation.path} 只應該列出自己的資料`
			).toEqual([expectation.id]);
		}

		/** 搜尋是最容易漏掉擁有者條件的地方：它會把 filters 陣列重新組一次。 */
		const search = await harness.app.inject({ method: "GET", url: harness.url("/media?search=甲的素材"), headers: { cookie: bob.cookie } });
		expect(search.json().total).toBe(0);
	});

	it("不能把別人的版面指派給自己的裝置或排程", async () => {
		const pinned = await harness.app.inject({
			method: "PATCH",
			url: harness.url(`/devices/${bob.deviceId}`),
			headers: { cookie: bob.cookie },
			payload: { defaultLayoutId: alice.layoutId }
		});
		expect(pinned.statusCode).toBe(404);

		const scheduled = await harness.app.inject({
			method: "POST",
			url: harness.url("/schedules"),
			headers: { cookie: bob.cookie },
			payload: scheduleBody({ name: "借用別人的版面", layoutId: alice.layoutId, deviceIds: [bob.deviceId] })
		});
		expect(scheduled.statusCode).toBe(400);
		expect(scheduled.json().code).toBe("validation_failed");
	});

	it("排程不能指派別人的裝置，資料庫層也擋得住", async () => {
		const response = await harness.app.inject({
			method: "POST",
			url: harness.url("/schedules"),
			headers: { cookie: bob.cookie },
			payload: scheduleBody({ name: "指到別人家的螢幕", layoutId: bob.layoutId, deviceIds: [alice.deviceId] })
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().details.deviceIds).toEqual([alice.deviceId]);

		/** 服務層的檢查是第一道防線，複合外鍵是第二道：跨擁有者的指派在資料庫裡寫不進去。 */
		await expect(harness.ctx.db.insert(scheduleDevices).values({ scheduleId: bob.scheduleId, deviceId: alice.deviceId, ownerId: bob.user.id })).rejects.toThrow();
	});

	it("目標狀態不會把別人的素材派送出去", async () => {
		/**
		 * 版面文件是 JSONB，沒有任何外鍵能阻止它引用別人的素材，
		 * 所以這件事必須由發布檢查與 buildDesiredState 各自擋一次。
		 */
		await harness.app.inject({
			method: "PATCH",
			url: harness.url(`/layouts/${bob.layoutId}`),
			headers: { cookie: bob.cookie },
			payload: { draft: singleAssetDocument(alice.asset.assetId, "image") }
		});
		const published = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${bob.layoutId}/publish`), headers: { cookie: bob.cookie }, payload: { note: null } });
		expect(published.statusCode).toBe(409);
		expect(published.json().details.assets[0]).toMatchObject({ assetId: alice.asset.assetId, reason: "missing" });

		/** 繞過路由直接寫一筆引用別人素材的修訂，派送這一層也必須自己擋住。 */
		const [revision] = await harness.ctx.db
			.insert(layoutRevisions)
			.values({ layoutId: bob.layoutId, revisionNumber: 99, document: singleAssetDocument(alice.asset.assetId, "image"), note: "手動寫入" })
			.returning();
		if (!revision) throw new Error("建立版面修訂失敗");
		await harness.ctx.db.update(layouts).set({ publishedRevisionId: revision.id }).where(eq(layouts.id, bob.layoutId));

		const state = await buildDesiredState(harness.ctx, bob.deviceId);
		expect(state?.assets).toEqual([]);
	});

	it("最高管理員被資源路由明確拒絕", async () => {
		const admin = await createUser(harness, { role: "super_admin" });
		const cookie = await login(harness, admin.email, admin.password);

		for (const path of ["/devices", "/media", "/layouts", "/schedules"]) {
			const response = await harness.app.inject({ method: "GET", url: harness.url(path), headers: { cookie } });
			expect(response.statusCode, `${path} 對最高管理員應該回 403`).toBe(403);
			expect(response.json().code).toBe("forbidden");
		}

		const layout = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name: "管理員不該建立的版面", description: null, canvas: { width: 1920, height: 1080 } }
		});
		expect(layout.statusCode).toBe(403);

		/** 配對也算資源操作：誰確認配對碼，裝置就歸誰，而最高管理員不該擁有裝置。 */
		const started = await harness.app.inject({
			method: "POST",
			url: harness.url("/device/pairing/start"),
			payload: { deviceName: "沒人能確認的裝置", platform: "linux", arch: "arm64", appVersion: "0.1.0", protocolVersion: 1 }
		});
		const code: string = started.json().code;
		expect((await harness.app.inject({ method: "GET", url: harness.url(`/pairing/${code}`), headers: { cookie } })).statusCode).toBe(403);
		const confirmed = await harness.app.inject({ method: "POST", url: harness.url("/pairing/confirm"), headers: { cookie }, payload: { code, deviceName: "沒人能確認的裝置", defaultLayoutId: null } });
		expect(confirmed.statusCode).toBe(403);
	});

	it("確認配對的人就是裝置的擁有者", async () => {
		const started = await harness.app.inject({
			method: "POST",
			url: harness.url("/device/pairing/start"),
			payload: { deviceName: "新來的裝置", platform: "linux", arch: "arm64", appVersion: "0.1.0", protocolVersion: 1 }
		});
		const code: string = started.json().code;

		const confirmed = await harness.app.inject({
			method: "POST",
			url: harness.url("/pairing/confirm"),
			headers: { cookie: bob.cookie },
			payload: { code, deviceName: "新來的裝置", defaultLayoutId: null }
		});
		expect(confirmed.statusCode).toBe(201);
		const deviceId: string = confirmed.json().id;

		expect((await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}`), headers: { cookie: bob.cookie } })).statusCode).toBe(200);
		expect((await harness.app.inject({ method: "GET", url: harness.url(`/devices/${deviceId}`), headers: { cookie: alice.cookie } })).statusCode).toBe(404);
	});
});
