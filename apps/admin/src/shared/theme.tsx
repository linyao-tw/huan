import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "huan.theme";

function readStoredPreference(): ThemePreference {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : "system";
	} catch {
		// 隱私模式或封鎖第三方儲存時讀取會丟例外；跟隨系統是安全的預設。
		return "system";
	}
}

function systemTheme(): ResolvedTheme {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeContextValue {
	preference: ThemePreference;
	resolved: ResolvedTheme;
	setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
	const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme());

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const listener = (event: MediaQueryListEvent): void => setSystem(event.matches ? "dark" : "light");
		media.addEventListener("change", listener);
		return () => media.removeEventListener("change", listener);
	}, []);

	const resolved: ResolvedTheme = preference === "system" ? system : preference;

	useEffect(() => {
		document.documentElement.dataset.lydsTheme = resolved;
	}, [resolved]);

	const setPreference = useCallback((next: ThemePreference) => {
		setPreferenceState(next);
		try {
			if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
			else window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// 無法保存時仍然套用本次選擇，下次開啟會回到系統偏好。
		}
	}, []);

	const value = useMemo<ThemeContextValue>(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);

	return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
	const value = use(ThemeContext);
	if (!value) throw new Error("useTheme 必須在 ThemeProvider 內使用");
	return value;
}
