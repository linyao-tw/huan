import type { DevicePlatform } from "@huan/protocol";
import { WindowsLogoIcon } from "@phosphor-icons/react/dist/csr/WindowsLogo";
import { siLinux, siMacos, siRaspberrypi, siUbuntu } from "simple-icons";

/**
 * 作業系統的品牌標誌。
 *
 * 用 Simple Icons 而不是 Phosphor：Phosphor 只有線條風格的通用標誌，畫不出
 * Ubuntu 與 Raspberry Pi。Windows 是唯一的例外——Simple Icons 因為商標政策
 * 把微軟整組移除了，所以那一個回頭用 Phosphor 的實心版本，視覺上跟其他
 * 實心品牌標誌是同一個調性。
 *
 * `simple-icons` 標了 `sideEffects: false` 且是具名匯出的 ESM，
 * 因此打包時只會帶進這裡實際 import 的那幾個，不是全部三千多個。
 */
export type OsKey = "windows" | "macos" | "linux" | "ubuntu" | "raspberry-pi";

const PATHS: Record<Exclude<OsKey, "windows">, string> = {
	macos: siMacos.path,
	linux: siLinux.path,
	ubuntu: siUbuntu.path,
	"raspberry-pi": siRaspberrypi.path
};

const TITLES: Record<OsKey, string> = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
	ubuntu: "Ubuntu",
	"raspberry-pi": "Raspberry Pi"
};

interface Props {
	os: OsKey;
	size?: string;
	/**
	 * 有沒有可讀的名稱。
	 *
	 * 標誌旁邊通常已經有文字（「Windows · x64」），那時候圖示是裝飾，
	 * 再念一次只是噪音；單獨出現時才需要名稱。
	 */
	labelled?: boolean;
}

export function OsIcon({ os, size = "1.25em", labelled = false }: Props) {
	const title = TITLES[os];
	const shared = {
		width: size,
		height: size,
		"aria-hidden": labelled ? undefined : (true as const),
		role: labelled ? ("img" as const) : undefined,
		"aria-label": labelled ? title : undefined,
		focusable: false as const
	};

	if (os === "windows") return <WindowsLogoIcon weight="fill" {...shared} />;

	return (
		<svg viewBox="0 0 24 24" fill="currentColor" {...shared}>
			<path d={PATHS[os]} />
		</svg>
	);
}

/**
 * 裝置回報的平台 → 標誌。
 *
 * 只認得協定裡真的存在的四個值。刻意不從 linux + arm64 推論成 Raspberry Pi：
 * 那只是「有可能」，而後台不該把猜測畫成事實。
 */
export function osForPlatform(platform: DevicePlatform): OsKey | null {
	if (platform === "win32") return "windows";
	if (platform === "darwin") return "macos";
	if (platform === "linux") return "linux";
	return null;
}
