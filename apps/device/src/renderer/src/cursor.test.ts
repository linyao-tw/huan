import { CURSOR_IDLE_MS, startCursorHider } from "@/renderer/src/cursor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("startCursorHider", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("沒人動滑鼠時，啟動後也會把游標藏起來", () => {
		const setHidden = vi.fn();
		startCursorHider({ target: new EventTarget(), setHidden });

		vi.advanceTimersByTime(CURSOR_IDLE_MS - 1);
		expect(setHidden).not.toHaveBeenCalledWith(true);
		vi.advanceTimersByTime(1);
		expect(setHidden).toHaveBeenLastCalledWith(true);
	});

	it("移動滑鼠會立刻顯示游標並重新倒數", () => {
		const target = new EventTarget();
		const setHidden = vi.fn();
		startCursorHider({ target, setHidden });
		vi.advanceTimersByTime(CURSOR_IDLE_MS);

		target.dispatchEvent(new Event("pointermove"));
		expect(setHidden).toHaveBeenLastCalledWith(false);

		vi.advanceTimersByTime(CURSOR_IDLE_MS - 1);
		expect(setHidden).toHaveBeenLastCalledWith(false);
		vi.advanceTimersByTime(1);
		expect(setHidden).toHaveBeenLastCalledWith(true);
	});

	it("停止後恢復游標，也不再監聽", () => {
		const target = new EventTarget();
		const setHidden = vi.fn();
		const stop = startCursorHider({ target, setHidden });

		stop();
		expect(setHidden).toHaveBeenLastCalledWith(false);

		setHidden.mockClear();
		target.dispatchEvent(new Event("pointermove"));
		vi.advanceTimersByTime(CURSOR_IDLE_MS * 2);
		expect(setHidden).not.toHaveBeenCalled();
	});
});
