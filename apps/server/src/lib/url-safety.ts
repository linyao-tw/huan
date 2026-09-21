/**
 * 請求 URL 在寫進日誌或 trace 之前先洗掉祕密。
 *
 * 查詢字串裡可能帶著裝置 token 或簽章網址的簽名，路徑上的配對碼本身就是祕密。
 * 記錄只需要知道打了哪個端點，不需要那些值，因此整段查詢字串直接丟掉，再把
 * `/pairing/<code>` 的配對碼遮成 `***`（只遮後台那條，裝置端的 pairing 路徑沒有
 * 把碼放在網址上）。
 *
 * 獨立成一個沒有任何相依的模組，是因為 OpenTelemetry 的埋點也要用它，而埋點必須在
 * Fastify 載入之前就跑起來——從 app.ts 匯入會把整個應用程式提早拉進來。
 */
export function sanitizeLoggedUrl(url: string): string {
	const path = url.split("?")[0] ?? url;
	return path.replace(/(\/api\/v1\/pairing\/)[^/]+/, "$1***");
}
