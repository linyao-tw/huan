import { useEffect } from "react";

export const SITE_NAME = "HUAN 讙";

/**
 * 首頁與 index.html 的 <title> 必須用同一串：回到首頁時若兩邊不同，分頁名會先閃成舊值再被改掉。
 */
export const MARKETING_TITLE = "HUAN 讙 — 集中管理、離線穩播的雲端數位看板";

/**
 * 直接設定整個分頁標題，不加任何後綴。首頁與 index.html 共用同一串時用這個。
 *
 * 離開時刻意不還原：後台是單頁應用，下一個畫面會設定自己的標題，中間留著舊標題
 * 遠比閃回站名自然。
 */
export function usePageTitle(title: string): void {
	useEffect(() => {
		document.title = title;
	}, [title]);
}

/**
 * 後台各頁用。換頁時網址變了但 index.html 的 <title> 不會跟著變，這個 hook 補上
 * 「· HUAN 讙」後綴，讓瀏覽器分頁名反映目前所在位置。
 */
export function useDocumentTitle(title: string): void {
	usePageTitle(`${title} · ${SITE_NAME}`);
}
