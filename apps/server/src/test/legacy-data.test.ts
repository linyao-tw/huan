import { checkEnvironment, createHarness, createReadyAsset, createUser, login, pairDevice, type SeededUser, type TestHarness } from "@/test/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 舊資料相容性整合測試：${environment.reason}`);

/**
 * 協定改版前寫進資料庫的資料。
 *
 * 其他測試都走 API 建資料，拿到的永遠是現在的格式；正式環境裡躺著的卻是當時的格式。
 * 回應序列化走 zod 的 encode 方向、不補預設值，所以這裡刻意繞過 API、直接寫 JSONB，
 * 模擬「版面在輪播改成共用秒數之前就存在」與「目標狀態在 idle 欄位出現之前就算好了」。
 */
function legacyPlaylistDocument(assetId: string) {
	return {
		canvas: { width: 1920, height: 1080 },
		background: { color: "#000000", imageAssetId: null, imageFit: "cover" },
		gap: 0,
		root: {
			type: "slot",
			id: "root",
			content: { type: "playlist", items: [{ assetId, kind: "image", durationMs: 5000 }], fit: "contain", backgroundColor: "#000000" }
		}
	};
}

suite("協定改版前的舊資料", () => {
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

	/** 走原生 SQL：這份文件本來就不符合現在的型別，透過 drizzle 寫入等於要先騙過型別檢查。 */
	async function insertLegacyLayout(): Promise<{ layoutId: string; revisionId: string }> {
		const asset = await createReadyAsset(harness, owner.id, "image", "舊輪播的圖");
		const document = JSON.stringify(legacyPlaylistDocument(asset.assetId));
		const [layout] = await harness.ctx.sql<{ id: string }[]>`
			insert into layouts (name, canvas_width, canvas_height, draft, owner_id, created_by)
			values ('舊版面', 1920, 1080, ${document}::jsonb, ${owner.id}, ${owner.id})
			returning id`;
		if (!layout) throw new Error("建立舊版面失敗");
		const [revision] = await harness.ctx.sql<{ id: string }[]>`
			insert into layout_revisions (layout_id, revision_number, document, published_by)
			values (${layout.id}, 1, ${document}::jsonb, ${owner.id})
			returning id`;
		if (!revision) throw new Error("建立舊修訂失敗");
		await harness.ctx.sql`update layouts set published_revision_id = ${revision.id} where id = ${layout.id}`;
		return { layoutId: layout.id, revisionId: revision.id };
	}

	it("打開舊版面的編輯器不會 500，輪播補上共用秒數", async () => {
		const { layoutId } = await insertLegacyLayout();
		const response = await harness.app.inject({ method: "GET", url: harness.url(`/layouts/${layoutId}`), headers: { cookie } });
		expect(response.statusCode).toBe(200);
		const content = response.json().draft.root.content;
		expect(content.imageDurationMs).toBe(8000);
		expect(content.items[0]).not.toHaveProperty("durationMs");
	});

	it("讀舊的已發布修訂也不會 500", async () => {
		const { layoutId, revisionId } = await insertLegacyLayout();
		const response = await harness.app.inject({ method: "GET", url: harness.url(`/layouts/${layoutId}/revisions/${revisionId}`), headers: { cookie } });
		expect(response.statusCode).toBe(200);
		expect(response.json().document.root.content.imageDurationMs).toBe(8000);
	});

	it("快取的目標狀態沒有 idle 時，裝置照樣同步得到", async () => {
		const { layoutId } = await insertLegacyLayout();
		const paired = await pairDevice(harness, cookie, "舊裝置", layoutId);

		/** 把快取改寫成協定改版前的樣子：拿掉 idle。版面文件在上面已經是逐則秒數的舊格式。 */
		await harness.ctx.sql`update devices set desired_state = desired_state - 'idle' where id = ${paired.deviceId}`;
		const [cached] = await harness.ctx.sql<{ hasIdle: boolean }[]>`select desired_state ? 'idle' as "hasIdle" from devices where id = ${paired.deviceId}`;
		expect(cached?.hasIdle).toBe(false);

		const response = await harness.app.inject({ method: "GET", url: harness.url("/device/state"), headers: { authorization: paired.authorization } });
		expect(response.statusCode).toBe(200);
		expect(response.json().idle).toEqual({ mode: "brand", imageAssetId: null });
	});
});
