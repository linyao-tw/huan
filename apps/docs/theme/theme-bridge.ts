/**
 * 把 Rspress 的深色狀態同步給設計系統。
 *
 * Rspress 在 `<html>` 上切換 `rp-dark` class，`@linyao.tw/ui` 讀的則是
 * `data-lyds-theme` 屬性，兩者原本互不相干——結果是使用者切到深色時，
 * 框架的外框變黑、設計系統的表面與文字卻還是亮色的那一套。
 *
 * 這段程式碼會以字串的形式內嵌進 `<head>`（見 rspress.config.ts 的 `head`），
 * 在第一次繪製前就先算出主題，之後再用 MutationObserver 跟著切換走。
 */
export const THEME_BRIDGE_SCRIPT = `(function(){
	var root=document.documentElement;
	function resolve(){
		var saved=null;
		try{saved=localStorage.getItem("rspress-theme-appearance");}catch(e){}
		if(saved==="light"||saved==="dark")return saved;
		return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
	}
	function apply(theme){
		if(root.getAttribute("data-lyds-theme")!==theme)root.setAttribute("data-lyds-theme",theme);
	}
	apply(root.classList.contains("rp-dark")?"dark":resolve());
	new MutationObserver(function(){
		apply(root.classList.contains("rp-dark")?"dark":"light");
	}).observe(root,{attributes:true,attributeFilter:["class"]});
})();`;
