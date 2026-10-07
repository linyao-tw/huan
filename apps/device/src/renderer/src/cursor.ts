/**
 * 滑鼠停著不動就把游標藏起來，一動就出現。
 *
 * 為什麼不直接 `cursor: none`：配對畫面的重試鈕與裝置資訊面板仍要能用滑鼠點；
 * 但看板現場通常沒人碰滑鼠，labwc 會把游標一直畫在最後的位置，全黑或深色畫面上特別顯眼。
 */
export const CURSOR_IDLE_MS = 3000;

const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "wheel"] as const;

export interface CursorHiderOptions {
	target: EventTarget;
	setHidden: (hidden: boolean) => void;
	idleMs?: number;
}

export function startCursorHider({ target, setHidden, idleMs = CURSOR_IDLE_MS }: CursorHiderOptions): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const arm = (): void => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => setHidden(true), idleMs);
	};

	const onActivity = (): void => {
		setHidden(false);
		arm();
	};

	// 一啟動就開始倒數：播放器開機後沒人動過滑鼠，游標也不該一直留在畫面中央。
	arm();
	for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity);

	return () => {
		if (timer) clearTimeout(timer);
		for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity);
		setHidden(false);
	};
}
