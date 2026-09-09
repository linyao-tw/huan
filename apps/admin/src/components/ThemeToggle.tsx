import { useTheme } from "@/lib/theme";
import { IconButton } from "@linyao.tw/ui";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";

/**
 * 主題切換。
 *
 * 顯示的是**目前**的主題，不是按下去會變成什麼——切換鈕要能一眼看出現在在哪個
 * 狀態，畫成「下一步」反而每次都要想一下。
 *
 * 介面上只有亮色與深色兩個狀態，沒有「跟隨系統」這個選項：三段式的切換器佔掉
 * 頁首一大塊，而且第一次進站本來就已經跟著系統走了（ThemeProvider 的預設）。
 * 按下去等於表明「我要這個」，之後就照使用者說的算。
 */
export function ThemeToggle() {
	const { resolved, setPreference } = useTheme();
	const isDark = resolved === "dark";

	return (
		<IconButton aria-label={isDark ? "切換到亮色主題" : "切換到深色主題"} variant="quiet" size="sm" onClick={() => setPreference(isDark ? "light" : "dark")}>
			{isDark ? <MoonIcon weight="fill" /> : <SunIcon weight="fill" />}
		</IconButton>
	);
}
