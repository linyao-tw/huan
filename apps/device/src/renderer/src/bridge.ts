import type { HuanBridge } from "@/preload/index";

declare global {
	interface Window {
		huan: HuanBridge;
	}
}

export const bridge: HuanBridge = window.huan;
