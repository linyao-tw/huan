/// <reference types="vite/client" />

/** CSS 以副作用形式匯入，TypeScript 需要知道這些模組存在。 */
declare module "*.css" {
	const content: string;
	export default content;
}
