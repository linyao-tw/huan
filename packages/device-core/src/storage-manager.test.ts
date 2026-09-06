import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fixtures.js";
import { StorageManager } from "./storage-manager.js";
import { DeviceStorage } from "./storage.js";

describe("StorageManager", () => {
	let root: string;
	let storage: DeviceStorage;
	let clock: FakeClock;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "huan-disk-"));
		storage = new DeviceStorage({ appDataDir: root });
		await storage.init();
		clock = new FakeClock(new Date());
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	async function writeMedia(fileName: string, content: string, ageMs = 0): Promise<string> {
		const path = storage.mediaPath(fileName);
		await writeFile(path, content);
		// 明確設定 mtime，讓「檔案有多舊」完全由測試決定，不受真實時鐘影響。
		const when = new Date(clock.now().getTime() - ageMs);
		await utimes(path, when, when);
		return path;
	}

	it("只回收保護名單以外、且已過保留期的檔案", async () => {
		const keep = await writeMedia("keep.mp4", "使用中", 60 * 60 * 1000);
		const drop = await writeMedia("drop.mp4", "沒人要", 60 * 60 * 1000);
		const fresh = await writeMedia("fresh.mp4", "剛下載完");

		const manager = new StorageManager({ storage, clock, retentionMs: 10 * 60 * 1000, diskUsage: async () => ({ freeBytes: 1e12, totalBytes: 2e12 }) });
		const result = await manager.collectGarbage({ protect: new Set(["keep.mp4"]) });

		expect(result.removed).toEqual(["drop.mp4"]);
		await expect(stat(keep)).resolves.toBeDefined();
		await expect(stat(fresh)).resolves.toBeDefined();
		await expect(stat(drop)).rejects.toThrow();
	});

	it("回收後同步清掉媒體索引，避免留下指向不存在檔案的紀錄", async () => {
		await writeMedia("gone.mp4", "沒人要", 60 * 60 * 1000);
		await storage.updateMediaIndex(index => {
			index.entries["variant-1"] = {
				variantId: "variant-1",
				assetId: "asset-1",
				fileName: "gone.mp4",
				sha256: "0".repeat(64),
				sizeBytes: 9,
				verifiedAt: clock.now().toISOString()
			};
		});

		const manager = new StorageManager({ storage, clock, retentionMs: 0, diskUsage: async () => ({ freeBytes: 1e12, totalBytes: 2e12 }) });
		await manager.collectGarbage({ protect: new Set() });

		expect((await storage.readMediaIndex()).entries["variant-1"]).toBeUndefined();
	});

	it("空間夠就直接放行，不做任何回收", async () => {
		await writeMedia("orphan.mp4", "沒人要", 60 * 60 * 1000);
		const manager = new StorageManager({ storage, clock, diskUsage: async () => ({ freeBytes: 1e12, totalBytes: 2e12 }) });
		const result = await manager.ensureSpace({ requiredBytes: 1_000, protect: new Set() });

		expect(result.ok).toBe(true);
		expect(result.collected).toBeNull();
		await expect(stat(storage.mediaPath("orphan.mp4"))).resolves.toBeDefined();
	});

	it("空間不足時先回收孤兒檔案，回收後夠用就放行", async () => {
		await writeMedia("orphan.mp4", "沒人要");
		let freeBytes = 1_000;
		const manager = new StorageManager({
			storage,
			clock,
			minFreeBytes: 0,
			retentionMs: 10 * 60 * 1000,
			diskUsage: async () => ({ freeBytes, totalBytes: 2e12 })
		});
		// 模擬回收之後真的空出了空間。
		const originalCollect = manager.collectGarbage.bind(manager);
		manager.collectGarbage = async options => {
			const result = await originalCollect(options);
			if (result.removed.length > 0) freeBytes = 5_000_000;
			return result;
		};

		const result = await manager.ensureSpace({ requiredBytes: 2_000_000, protect: new Set() });

		expect(result.ok).toBe(true);
		// 保留期在磁碟壓力下會被放棄，剛寫好的孤兒檔案照樣回收。
		expect(result.collected?.removed).toContain("orphan.mp4");
	});

	it("回收之後仍然不夠就回報 storageError，而不是無止盡重試", async () => {
		const protectedFile = await writeMedia("keep.mp4", "使用中");
		const manager = new StorageManager({
			storage,
			clock,
			minFreeBytes: 0,
			diskUsage: async () => ({ freeBytes: 1_000, totalBytes: 2e12 })
		});

		const result = await manager.ensureSpace({ requiredBytes: 5_000_000_000, protect: new Set(["keep.mp4"]) });

		expect(result.ok).toBe(false);
		expect(result.error).toContain("磁碟空間不足");
		// 保護名單裡的檔案在任何壓力下都不能被刪。
		await expect(stat(protectedFile)).resolves.toBeDefined();
	});

	it("量不到磁碟用量時不擋下載", async () => {
		const manager = new StorageManager({ storage, clock, diskUsage: async () => ({ freeBytes: null, totalBytes: null }) });
		const result = await manager.ensureSpace({ requiredBytes: 1e12, protect: new Set() });
		expect(result.ok).toBe(true);
		expect(result.error).toBeNull();
	});
});
