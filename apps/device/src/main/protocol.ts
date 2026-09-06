import { net, protocol, session } from "electron";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const HUAN_MEDIA_SCHEME = "huan-media";

/**
 * 播放中的素材必須讓 renderer 讀得到，但 renderer 沒有 Node，
 * 也不能拿到 `file://` —— 那等於把整個檔案系統交給沙箱裡的頁面。
 *
 * 自訂協定把可讀範圍限制在媒體目錄裡的單一檔名：路徑分隔字元、`..` 與絕對路徑
 * 全部拒絕，因此不存在路徑穿越的空間。
 */
export function registerMediaProtocolSchemes(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: HUAN_MEDIA_SCHEME,
			privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: true }
		}
	]);
}

function isSafeFileName(name: string): boolean {
	if (name.length === 0 || name.length > 128) return false;
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
	if (name === "." || name === "..") return false;
	return /^[A-Za-z0-9._-]+$/.test(name);
}

export function registerMediaProtocol(mediaDir: string, resolveHtmlFileName: (name: string) => boolean = () => true): void {
	protocol.handle(HUAN_MEDIA_SCHEME, request => {
		const url = new URL(request.url);
		const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		if (!isSafeFileName(fileName) || !resolveHtmlFileName(fileName)) {
			return new Response("Not found", { status: 404 });
		}
		return net.fetch(pathToFileURL(`${mediaDir}/${fileName}`).toString());
	});
}

/**
 * 上傳的 HTML 在自己的 partition 裡執行，並套用嚴格的 CSP。
 *
 * 它拿不到 preload、拿不到 Node、拿不到 session 儲存，也連不出去；
 * 「因為要播放 HTML 所以放寬 Electron 的安全設定」在 HUAN 不會發生。
 */
export function hardenSandboxSession(partition: string): void {
	const sandboxed = session.fromPartition(partition);
	sandboxed.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	sandboxed.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [
					"default-src 'none'; img-src data: blob: huan-media:; media-src data: blob: huan-media:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; frame-ancestors 'self'"
				]
			}
		});
	});
}

export function contentHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
