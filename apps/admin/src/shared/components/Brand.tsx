/**
 * 品牌鎖定組合：獸、HUAN、讙。
 *
 * 這三個元素原本在登入、配對、官網頁首、官網頁尾與後台側欄各抄了一次，
 * 五份要一起改才不會有一頁長得不一樣。外層的連結留給呼叫端——每一處要去的
 * 地方不同，有的甚至不是連結。
 */
export function Brand() {
	return (
		<>
			{/*
			 * 標誌用 CSS 遮罩上色，不是直接放圖。
			 *
			 * 這隻獸是單一路徑的線稿，遮罩之後顏色由 currentColor 決定，和旁邊的字
			 * 標永遠同一個色，主題換了也自己跟上。直接 <img> 的話顏色寫死在檔案裡，
			 * 深色主題得再放一份；而路徑本身有 27 KB，內嵌進 JS 是讓每一頁都揹著
			 * 一份不會變的美術資產。
			 */}
			<span className="huan-shell__brand-logo" aria-hidden="true" />
			<span className="huan-shell__brand-mark">HUAN</span>
			<span className="huan-shell__brand-han">讙</span>
		</>
	);
}
