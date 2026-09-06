import { checkEnvironment, createHarness, createReadyAsset, createUser, login, pairDevice, singleAssetDocument, type TestHarness } from "@/test/helpers";
import { mediaAssets } from "@huan/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 版面與排程整合測試：${environment.reason}`);

suite("版面、排程與目標狀態", () => {
	let harness: TestHarness;
	let cookie: string;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
		const admin = await createUser(harness, { role: "super_admin" });
		cookie = await login(harness, admin.email, admin.password);
	});

	async function createLayout(name: string): Promise<string> {
		const response = await harness.app.inject({
			method: "POST",
			url: harness.url("/layouts"),
			headers: { cookie },
			payload: { name, description: null, canvas: { width: 1920, height: 1080 } }
		});
		expect(response.statusCode).toBe(201);
		return response.json().id;
	}

	async function setDraft(layoutId: string, assetId: string): Promise<void> {
		const response = await harness.app.inject({
			method: "PATCH",
			url: harness.url(`/layouts/${layoutId}`),
			headers: { cookie },
			payload: { draft: singleAssetDocument(assetId) }
		});
		expect(response.statusCode).toBe(200);
	}

	it("發布會建立修訂並推進裝置的目標狀態版本", async () => {
		const asset = await createReadyAsset(harness);
		const layoutId = await createLayout("門市主畫面");
		await setDraft(layoutId, asset.assetId);

		const device = await pairDevice(harness, cookie, "大廳", layoutId);
		const beforePublish = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: device.authorization } });
		const versionBefore = beforePublish.json().version;

		const published = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: "初版" } });
		expect(published.statusCode).toBe(201);
		expect(published.json()).toMatchObject({ layoutId, revisionNumber: 1, note: "初版" });

		const detail = await harness.app.inject({ method: "GET", url: harness.url(`/layouts/${layoutId}`), headers: { cookie } });
		expect(detail.json().publishedRevisionId).toBe(published.json().id);
		expect(detail.json().publishedRevisionNumber).toBe(1);
		expect(detail.json().revisions).toHaveLength(1);

		const afterPublish = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: device.authorization } });
		expect(afterPublish.json().version).toBeGreaterThan(versionBefore);

		const state = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		expect(state.statusCode).toBe(200);
		const body = state.json();
		expect(body.defaultLayout).toMatchObject({ layoutId, revisionNumber: 1 });
		expect(body.layouts).toHaveLength(1);
		expect(body.assets).toHaveLength(1);
		expect(body.assets[0]).toMatchObject({
			assetId: asset.assetId,
			variantId: asset.variantId,
			sha256: asset.sha256,
			downloadPath: `/device/assets/${asset.variantId}/url`
		});

		/** 第二次發布相同草稿仍然是新的修訂，版本要再往前一格。 */
		const second = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		expect(second.json().revisionNumber).toBe(2);
		const afterSecond = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: device.authorization } });
		expect(afterSecond.json().version).toBeGreaterThan(afterPublish.json().version);
	});

	it("重算目標狀態但內容沒變時不會浪費一個版本號", async () => {
		const asset = await createReadyAsset(harness);
		const layoutId = await createLayout("穩定版面");
		await setDraft(layoutId, asset.assetId);
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });

		const device = await pairDevice(harness, cookie, "穩定裝置", layoutId);
		const first = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: device.authorization } });

		/** 強制同步一定會通知，但不應該改變版本號。 */
		const forced = await harness.app.inject({ method: "POST", url: harness.url(`/devices/${device.deviceId}/force-sync`), headers: { cookie } });
		expect(forced.statusCode).toBe(200);

		const second = await harness.app.inject({ method: "GET", url: harness.url("/device/state/version"), headers: { authorization: device.authorization } });
		expect(second.json().version).toBe(first.json().version);
	});

	it("引用未就緒素材的版面不能發布", async () => {
		const asset = await createReadyAsset(harness);
		await harness.ctx.db.update(mediaAssets).set({ status: "processing" }).where(eq(mediaAssets.id, asset.assetId));

		const layoutId = await createLayout("尚未就緒");
		await setDraft(layoutId, asset.assetId);

		const response = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		expect(response.statusCode).toBe(409);
		expect(response.json().message).toContain("尚未就緒");
		expect(response.json().details.assets[0]).toMatchObject({ assetId: asset.assetId, reason: "not_ready", status: "processing" });
	});

	it("草稿引用的素材不會被派送出去", async () => {
		const published = await createReadyAsset(harness, "video", "已發布素材");
		const draftOnly = await createReadyAsset(harness, "image", "只在草稿裡的素材");

		const layoutId = await createLayout("草稿測試");
		await setDraft(layoutId, published.assetId);
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });

		const device = await pairDevice(harness, cookie, "草稿測試裝置", layoutId);
		await setDraft(layoutId, draftOnly.assetId);

		const state = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		const assetIds: string[] = state.json().assets.map((entry: { assetId: string }) => entry.assetId);
		expect(assetIds).toEqual([published.assetId]);
	});

	it("排程的新增、修改與刪除都會反映在裝置的目標狀態", async () => {
		const asset = await createReadyAsset(harness, "image", "午餐主視覺");
		const layoutId = await createLayout("午餐時段");
		await setDraft(layoutId, asset.assetId);
		const publishedRevision = await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		const revisionId = publishedRevision.json().id;

		const device = await pairDevice(harness, cookie, "排程裝置");

		const emptyState = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		expect(emptyState.json().schedules).toHaveLength(0);
		expect(emptyState.json().assets).toHaveLength(0);

		const created = await harness.app.inject({
			method: "POST",
			url: harness.url("/schedules"),
			headers: { cookie },
			payload: {
				name: "午餐時段",
				enabled: true,
				layoutId,
				timezone: "Asia/Taipei",
				priority: 100,
				startDate: null,
				endDate: null,
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: "11:00",
				endTime: "14:00",
				deviceIds: [device.deviceId]
			}
		});
		expect(created.statusCode).toBe(201);
		const scheduleId = created.json().id;
		expect(created.json()).toMatchObject({ layoutName: "午餐時段", deviceIds: [device.deviceId] });

		const withSchedule = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		expect(withSchedule.json().schedules).toHaveLength(1);
		expect(withSchedule.json().schedules[0]).toMatchObject({ id: scheduleId, layoutRevisionId: revisionId, startTime: "11:00", endTime: "14:00", timezone: "Asia/Taipei" });
		/** 排程用到的版面與素材同樣要被派送，即使它不是預設版面。 */
		expect(withSchedule.json().assets.map((entry: { assetId: string }) => entry.assetId)).toEqual([asset.assetId]);

		const updated = await harness.app.inject({
			method: "PATCH",
			url: harness.url(`/schedules/${scheduleId}`),
			headers: { cookie },
			payload: {
				name: "午餐時段（延長）",
				enabled: true,
				layoutId,
				timezone: "Asia/Taipei",
				priority: 200,
				startDate: null,
				endDate: null,
				daysOfWeek: [1, 2, 3, 4, 5, 6],
				startTime: "11:00",
				endTime: "15:00",
				deviceIds: [device.deviceId]
			}
		});
		expect(updated.statusCode).toBe(200);

		const afterUpdate = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		expect(afterUpdate.json().schedules[0]).toMatchObject({ priority: 200, endTime: "15:00", daysOfWeek: [1, 2, 3, 4, 5, 6] });

		/** 把裝置移出目標清單後，它的目標狀態必須立刻不再包含這個排程。 */
		const removedTarget = await harness.app.inject({
			method: "PATCH",
			url: harness.url(`/schedules/${scheduleId}`),
			headers: { cookie },
			payload: {
				name: "午餐時段（延長）",
				enabled: true,
				layoutId,
				timezone: "Asia/Taipei",
				priority: 200,
				startDate: null,
				endDate: null,
				daysOfWeek: [1, 2, 3, 4, 5, 6],
				startTime: "11:00",
				endTime: "15:00",
				deviceIds: []
			}
		});
		expect(removedTarget.statusCode).toBe(200);
		const afterRemoval = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: device.authorization } });
		expect(afterRemoval.json().schedules).toHaveLength(0);
		expect(afterRemoval.json().assets).toHaveLength(0);

		const deleted = await harness.app.inject({ method: "DELETE", url: harness.url(`/schedules/${scheduleId}`), headers: { cookie } });
		expect(deleted.statusCode).toBe(200);
		const list = await harness.app.inject({ method: "GET", url: harness.url("/schedules"), headers: { cookie } });
		expect(list.json().total).toBe(0);
	});

	it("被排程或裝置引用的版面不能刪除", async () => {
		const asset = await createReadyAsset(harness);
		const layoutId = await createLayout("被引用的版面");
		await setDraft(layoutId, asset.assetId);
		await harness.app.inject({ method: "POST", url: harness.url(`/layouts/${layoutId}/publish`), headers: { cookie }, payload: { note: null } });
		await pairDevice(harness, cookie, "引用裝置", layoutId);

		const response = await harness.app.inject({ method: "DELETE", url: harness.url(`/layouts/${layoutId}`), headers: { cookie } });
		expect(response.statusCode).toBe(409);
		expect(response.json().details.devices).toHaveLength(1);
	});
});
