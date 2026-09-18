import { checkEnvironment, createHarness, createReadyAsset, createUser, login, type SeededUser, type TestHarness } from "@/test/helpers";
import { MEDIA_FOLDER_MAX_DEPTH } from "@huan/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 素材資料夾整合測試：${environment.reason}`);

suite("素材資料夾", () => {
	let harness: TestHarness;
	let owner: SeededUser;
	let cookie: string;

	beforeAll(async () => {
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
	});

	beforeEach(async () => {
		await harness.truncate();
		owner = await createUser(harness, { role: "user" });
		cookie = await login(harness, owner.email, owner.password);
	});

	async function createFolder(name: string, parentId: string | null = null, sessionCookie = cookie) {
		return harness.app.inject({ method: "POST", url: harness.url("/media/folders"), headers: { cookie: sessionCookie }, payload: { name, parentId } });
	}

	async function listFolders(sessionCookie = cookie) {
		const response = await harness.app.inject({ method: "GET", url: harness.url("/media/folders"), headers: { cookie: sessionCookie } });
		return response.json().items as { id: string; name: string; parentId: string | null; assetCount: number; childCount: number }[];
	}

	it("建立、巢狀與計數", async () => {
		const parent = await createFolder("門市");
		expect(parent.statusCode).toBe(201);
		const parentId = parent.json().id as string;

		const child = await createFolder("櫥窗", parentId);
		expect(child.statusCode).toBe(201);
		expect(child.json().parentId).toBe(parentId);

		const asset = await createReadyAsset(harness, owner.id, "image", "海報");
		const moved = await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [asset.assetId], folderId: parentId } });
		expect(moved.statusCode).toBe(200);

		const folders = await listFolders();
		const listedParent = folders.find(folder => folder.id === parentId);
		expect(listedParent?.assetCount).toBe(1);
		expect(listedParent?.childCount).toBe(1);
	});

	it("同一層不接受同名資料夾，不同層可以同名", async () => {
		const first = await createFolder("活動");
		expect(first.statusCode).toBe(201);
		expect((await createFolder("活動")).statusCode).toBe(409);
		expect((await createFolder("活動", first.json().id)).statusCode).toBe(201);
	});

	it("擋下把資料夾搬進自己的子資料夾", async () => {
		const parentId = (await createFolder("上層")).json().id as string;
		const childId = (await createFolder("下層", parentId)).json().id as string;

		const response = await harness.app.inject({ method: "PATCH", url: harness.url(`/media/folders/${parentId}`), headers: { cookie }, payload: { parentId: childId } });
		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe("folder_cycle");
	});

	it("超過深度上限就拒絕", async () => {
		let parentId: string | null = null;
		for (let level = 0; level < MEDIA_FOLDER_MAX_DEPTH; level += 1) {
			const response = await createFolder(`第 ${level} 層`, parentId);
			expect(response.statusCode).toBe(201);
			parentId = response.json().id as string;
		}
		const tooDeep = await createFolder("再一層", parentId);
		expect(tooDeep.statusCode).toBe(409);
		expect(tooDeep.json().code).toBe("folder_too_deep");
	});

	it("資料夾非空時不能刪除，清空之後可以", async () => {
		const folderId = (await createFolder("要刪的")).json().id as string;
		const asset = await createReadyAsset(harness, owner.id, "image", "還在裡面");
		await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [asset.assetId], folderId } });

		const blocked = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/folders/${folderId}`), headers: { cookie } });
		expect(blocked.statusCode).toBe(409);
		expect(blocked.json().code).toBe("folder_not_empty");

		await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [asset.assetId], folderId: null } });
		const removed = await harness.app.inject({ method: "DELETE", url: harness.url(`/media/folders/${folderId}`), headers: { cookie } });
		expect(removed.statusCode).toBe(200);
	});

	it("列表可以只要某一層，root 只回沒有資料夾的素材", async () => {
		const folderId = (await createFolder("分類")).json().id as string;
		const inside = await createReadyAsset(harness, owner.id, "image", "分類裡的");
		const outside = await createReadyAsset(harness, owner.id, "image", "最上層的");
		await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [inside.assetId], folderId } });

		const inFolder = await harness.app.inject({ method: "GET", url: harness.url(`/media?folderId=${folderId}`), headers: { cookie } });
		expect(inFolder.json().items.map((item: { id: string }) => item.id)).toEqual([inside.assetId]);

		const atRoot = await harness.app.inject({ method: "GET", url: harness.url("/media?folderId=root"), headers: { cookie } });
		expect(atRoot.json().items.map((item: { id: string }) => item.id)).toEqual([outside.assetId]);

		/** 不帶 folderId 就是整個素材庫，搜尋要能跨資料夾找得到。 */
		const everything = await harness.app.inject({ method: "GET", url: harness.url("/media"), headers: { cookie } });
		expect(everything.json().total).toBe(2);
	});

	it("別人的資料夾看不到也搬不進去", async () => {
		const other = await createUser(harness, { role: "user" });
		const otherCookie = await login(harness, other.email, other.password);
		const otherFolderId = (await createFolder("別人的", null, otherCookie)).json().id as string;

		expect(await listFolders()).toEqual([]);

		const asset = await createReadyAsset(harness, owner.id, "image", "我的素材");
		const response = await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [asset.assetId], folderId: otherFolderId } });
		expect(response.statusCode).toBe(404);
	});

	it("搬移只要有一筆不是自己的就整批不動", async () => {
		const other = await createUser(harness, { role: "user" });
		const mine = await createReadyAsset(harness, owner.id, "image", "我的");
		const theirs = await createReadyAsset(harness, other.id, "image", "他的");
		const folderId = (await createFolder("目標")).json().id as string;

		const response = await harness.app.inject({ method: "POST", url: harness.url("/media/move"), headers: { cookie }, payload: { assetIds: [mine.assetId, theirs.assetId], folderId } });
		expect(response.statusCode).toBe(404);

		const listed = await harness.app.inject({ method: "GET", url: harness.url(`/media?folderId=${folderId}`), headers: { cookie } });
		expect(listed.json().items).toEqual([]);
	});

	it("上傳時指定的資料夾會寫進素材", async () => {
		const folderId = (await createFolder("上傳目標")).json().id as string;
		const created = await harness.app.inject({
			method: "POST",
			url: harness.url("/media/uploads"),
			headers: { cookie },
			payload: { kind: "image", name: "新圖", filename: "a.png", contentType: "image/png", sizeBytes: 1024, folderId }
		});
		expect(created.statusCode).toBe(201);

		const asset = await harness.app.inject({ method: "GET", url: harness.url(`/media/${created.json().assetId}`), headers: { cookie } });
		expect(asset.json().folderId).toBe(folderId);
	});
});
