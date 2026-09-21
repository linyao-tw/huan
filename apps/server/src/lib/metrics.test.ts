import { countJobs, summarizeDevices, type DeviceSnapshotRow } from "@/lib/metrics";
import { describe, expect, it } from "vitest";

const now = new Date("2026-09-21T12:00:00.000Z");

function device(overrides: Partial<DeviceSnapshotRow>): DeviceSnapshotRow {
	return { id: "d1", name: "門口電視", status: "active", online: true, desiredVersion: 4, reportedVersion: 4, storageError: null, lastSeenAt: new Date("2026-09-21T11:59:30.000Z"), ...overrides };
}

describe("summarizeDevices", () => {
	it("依連線狀態分組，撤銷的裝置另外算", () => {
		const summary = summarizeDevices([device({ id: "a" }), device({ id: "b", online: false }), device({ id: "c", status: "revoked", online: false })], now);
		expect(summary.byStatus).toEqual({ online: 1, offline: 1, revoked: 1 });
	});

	it("撤銷的裝置不列進逐台明細", () => {
		const summary = summarizeDevices([device({ id: "a" }), device({ id: "c", status: "revoked" })], now);
		expect(summary.perDevice.map(entry => entry.id)).toEqual(["a"]);
	});

	it("版本落差是目標減回報，沒回報過的落後整個目標版本", () => {
		const [synced, behind, never] = summarizeDevices([device({ id: "a" }), device({ id: "b", reportedVersion: 2 }), device({ id: "c", reportedVersion: null })], now).perDevice;
		expect(synced?.versionLag).toBe(0);
		expect(behind?.versionLag).toBe(2);
		expect(never?.versionLag).toBe(4);
	});

	it("回報版本比目標還新時不會出現負數", () => {
		expect(summarizeDevices([device({ reportedVersion: 9 })], now).perDevice[0]?.versionLag).toBe(0);
	});

	it("最後回報距今秒數；從沒回報過就是 null", () => {
		const [seen, neverSeen] = summarizeDevices([device({ id: "a" }), device({ id: "b", lastSeenAt: null })], now).perDevice;
		expect(seen?.lastSeenAgeSeconds).toBe(30);
		expect(neverSeen?.lastSeenAgeSeconds).toBeNull();
	});

	it("儲存錯誤轉成 1 或 0", () => {
		expect(summarizeDevices([device({ storageError: "磁碟空間不足" })], now).perDevice[0]?.storageError).toBe(1);
	});
});

describe("countJobs", () => {
	it("每種工作 × 每種狀態都有一個數字，查不到的是 0", () => {
		const counts = countJobs([{ kind: "process_image", status: "success", value: 3 }]);
		expect(counts).toHaveLength(12);
		expect(counts.find(row => row.kind === "process_image" && row.status === "success")?.value).toBe(3);
		expect(counts.find(row => row.kind === "transcode_video" && row.status === "pending")?.value).toBe(0);
	});
});
