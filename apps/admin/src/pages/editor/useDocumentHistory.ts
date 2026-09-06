import type { LayoutDocument } from "@huan/protocol";
import { useCallback, useMemo, useRef, useState } from "react";

const MAX_HISTORY = 60;

interface HistoryState {
	past: LayoutDocument[];
	present: LayoutDocument;
	future: LayoutDocument[];
}

export interface ApplyOptions {
	/**
	 * 連續的同類操作合併成一步。
	 *
	 * 拖曳一次分隔線會產生上百次更新；沒有合併的話，一次 Ctrl+Z 只會退回一個像素，
	 * 使用者要按幾十次才回得到原本的比例。
	 */
	coalesceKey?: string;
}

export interface DocumentHistory {
	document: LayoutDocument;
	canUndo: boolean;
	canRedo: boolean;
	apply: (updater: (current: LayoutDocument) => LayoutDocument, options?: ApplyOptions) => void;
	replace: (document: LayoutDocument) => void;
	undo: () => void;
	redo: () => void;
}

export function useDocumentHistory(initial: LayoutDocument): DocumentHistory {
	const [state, setState] = useState<HistoryState>({ past: [], present: initial, future: [] });
	const lastCoalesceKey = useRef<string | null>(null);

	const apply = useCallback((updater: (current: LayoutDocument) => LayoutDocument, options?: ApplyOptions) => {
		setState(current => {
			const next = updater(current.present);
			if (next === current.present) return current;

			const coalesce = options?.coalesceKey !== undefined && options.coalesceKey === lastCoalesceKey.current;
			lastCoalesceKey.current = options?.coalesceKey ?? null;

			if (coalesce) return { past: current.past, present: next, future: [] };

			const past = [...current.past, current.present];
			return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, present: next, future: [] };
		});
	}, []);

	/** 從伺服器重新載入時使用：整段歷史一併重置，避免把別人的版本混進 undo 堆疊。 */
	const replace = useCallback((document: LayoutDocument) => {
		lastCoalesceKey.current = null;
		setState({ past: [], present: document, future: [] });
	}, []);

	const undo = useCallback(() => {
		lastCoalesceKey.current = null;
		setState(current => {
			const previous = current.past[current.past.length - 1];
			if (!previous) return current;
			return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
		});
	}, []);

	const redo = useCallback(() => {
		lastCoalesceKey.current = null;
		setState(current => {
			const next = current.future[0];
			if (!next) return current;
			return { past: [...current.past, current.present], present: next, future: current.future.slice(1) };
		});
	}, []);

	return useMemo(() => ({ document: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, apply, replace, undo, redo }), [state, apply, replace, undo, redo]);
}
