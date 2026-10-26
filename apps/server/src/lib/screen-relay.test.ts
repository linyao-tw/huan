import { ScreenRelay } from "@/lib/screen-relay";
import { describe, expect, it } from "vitest";

describe("ScreenRelay", () => {
	it("沒人在看時不收截圖，開始看之後才收", () => {
		let now = 1_000_000;
		const relay = new ScreenRelay(() => now);
		expect(relay.store("d1", Buffer.from("a"))).toBe(false);
		expect(relay.watch("d1")).toBe(true);
		expect(relay.store("d1", Buffer.from("b"))).toBe(true);
		expect(relay.latest("d1")?.jpeg.toString()).toBe("b");
		now += 11_000;
		expect(relay.store("d1", Buffer.from("c"))).toBe(false);
		expect(relay.latest("d1")).toBeNull();
	});

	it("持續在看而且有新畫面時不重複叫醒裝置，畫面停了才再叫", () => {
		let now = 1_000_000;
		const relay = new ScreenRelay(() => now);
		expect(relay.watch("d1")).toBe(true);
		relay.store("d1", Buffer.from("a"));
		now += 1_000;
		expect(relay.watch("d1")).toBe(false);
		relay.store("d1", Buffer.from("b"));
		now += 1_000;
		expect(relay.watch("d1")).toBe(false);
		now += 4_000;
		expect(relay.watch("d1")).toBe(true);
	});
});
