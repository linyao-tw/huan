import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAsset, makeDesiredState } from "./fixtures.js";
import type { Logger } from "./logger.js";
import { DeviceStorage, atomicWriteFile, mediaFileName, readJsonFile } from "./storage.js";
import { isRecord, jsonValidator } from "./types.js";

function recordingLogger(): Logger & { warnings: string[] } {
	const warnings: string[] = [];
	return {
		warnings,
		debug: () => {},
		info: () => {},
		warn: message => {
			warnings.push(message);
		},
		error: message => {
			warnings.push(message);
		}
	};
}

describe("atomicWriteFile", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "huan-storage-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("在 rename 之前斷電時，舊內容仍然完整可讀", async () => {
		const file = join(root, "manifests", "active.json");
		await atomicWriteFile(file, JSON.stringify({ version: 1 }));

		await expect(
			atomicWriteFile(file, JSON.stringify({ version: 2 }), {
				beforeRename: () => {
					throw new Error("模擬斷電");
				}
			})
		).rejects.toThrow("模擬斷電");

		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1 });
	});

	it("寫入成功後不留下暫存檔", async () => {
		const file = join(root, "state", "activation.json");
		await atomicWriteFile(file, "{}");
		await expect(readFile(`${file}.tmp`, "utf8")).rejects.toThrow();
	});

	it("可以指定 0600 之類的檔案權限", async () => {
		const file = join(root, "config", "credential");
		await atomicWriteFile(file, "secret", { mode: 0o600 });
		const { stat } = await import("node:fs/promises");
		const info = await stat(file);
		expect(info.mode & 0o777).toBe(0o600);
	});
});

describe("readJsonFile", () => {
	let root: string;
	const validator = jsonValidator<{ value: number }>(input => {
		if (!isRecord(input)) return null;
		return typeof input.value === "number" ? { value: input.value } : null;
	});

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "huan-storage-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("檔案不存在時回 null 而不是丟例外", async () => {
		await expect(readJsonFile(join(root, "missing.json"), validator)).resolves.toBeNull();
	});

	it("內容被截斷時回 null 並記錄警告", async () => {
		const logger = recordingLogger();
		const file = join(root, "broken.json");
		await writeFile(file, '{"value": 1');
		await expect(readJsonFile(file, validator, logger)).resolves.toBeNull();
		expect(logger.warnings.length).toBe(1);
	});

	it("結構不符時回 null", async () => {
		const logger = recordingLogger();
		const file = join(root, "wrong.json");
		await writeFile(file, '{"value": "not a number"}');
		await expect(readJsonFile(file, validator, logger)).resolves.toBeNull();
		expect(logger.warnings.length).toBe(1);
	});
});

describe("DeviceStorage", () => {
	let root: string;
	let storage: DeviceStorage;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "huan-storage-"));
		storage = new DeviceStorage({ appDataDir: root });
		await storage.init();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("損毀的 active manifest 會被當成不存在，而不是讓播放器炸掉", async () => {
		const manifest = makeDesiredState({ version: 7 });
		await storage.writeActiveManifest(manifest);
		expect((await storage.readActiveManifest())?.version).toBe(7);

		await writeFile(storage.activeManifestPath, "{ 這不是 JSON");
		await expect(storage.readActiveManifest()).resolves.toBeNull();
	});

	it("結構正確但欄位型別錯誤的 activation 檔一樣被忽略", async () => {
		await writeFile(storage.activationPath, JSON.stringify({ version: "七", activatedAt: "x", layoutRevisionIds: [] }));
		await expect(storage.readActivation()).resolves.toBeNull();
	});

	it("多個下載同時完成時，媒體索引不會互相覆蓋", async () => {
		await Promise.all(
			Array.from({ length: 20 }, (_unused, index) =>
				storage.updateMediaIndex(current => {
					current.entries[`variant-${index}`] = {
						variantId: `variant-${index}`,
						assetId: `asset-${index}`,
						fileName: `variant-${index}.mp4`,
						sha256: "0".repeat(64),
						sizeBytes: index,
						verifiedAt: "2026-01-01T00:00:00.000Z"
					};
				})
			)
		);
		const index = await storage.readMediaIndex();
		expect(Object.keys(index.entries)).toHaveLength(20);
	});

	it("列出媒體檔時忽略不存在的項目並回報大小", async () => {
		await writeFile(storage.mediaPath("a.mp4"), "hello");
		const files = await storage.listMediaFiles();
		expect(files.map(file => file.fileName)).toEqual(["a.mp4"]);
		expect(files[0]?.sizeBytes).toBe(5);
	});

	it("媒體檔名一律用 variantId，不採用伺服器給的檔名", () => {
		const entry = makeAsset("x", { filename: "../../../etc/passwd", contentType: "application/octet-stream", kind: "video" });
		expect(mediaFileName(entry)).toBe(`${entry.variantId}.mp4`);
		expect(mediaFileName(entry)).not.toContain("/");
	});

	it("寫入狀態檔時不會殘留暫存檔", async () => {
		const spy = vi.spyOn(JSON, "stringify");
		await storage.writeDesiredState(makeDesiredState());
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(storage.stateDir);
		expect(files.some(name => name.endsWith(".tmp"))).toBe(false);
	});
});
