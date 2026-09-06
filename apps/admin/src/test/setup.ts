import "@testing-library/jest-dom/vitest";

/**
 * jsdom 缺少幾個瀏覽器 API，元件（畫布量測、主題偵測、浮層定位）在測試環境會直接丟例外。
 * 這裡補的是最小可用版本，不模擬行為，只讓程式碼跑得下去。
 */
if (!("ResizeObserver" in globalThis)) {
	class ResizeObserverStub {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	}
	Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, writable: true });
}

if (!("matchMedia" in window)) {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		})
	});
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!("PointerEvent" in window)) {
	Object.defineProperty(window, "PointerEvent", { writable: true, value: MouseEvent });
}

if (!Element.prototype.hasPointerCapture) {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
}
