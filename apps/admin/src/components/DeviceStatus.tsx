import { OsIcon, osForPlatform } from "@/components/OsIcon";
import type { Device, DevicePlatform } from "@huan/protocol";
import { formatBytes } from "@huan/shared";
import { Badge, Meter } from "@linyao.tw/ui";

export const PLATFORM_LABELS: Record<DevicePlatform, string> = { linux: "Linux", win32: "Windows", darwin: "macOS", unknown: "未知" };

/**
 * 平台 + 架構的統一寫法。
 *
 * 列表、詳情與配對三個地方原本各自拼一次字串，加上標誌之後只會拼得更不一樣，
 * 所以收成一個元件。沒有回報平台時顯示破折號，不要留空白讓人以為是壞掉。
 */
export function PlatformLabel({ platform, arch }: { platform?: DevicePlatform | undefined; arch?: string | undefined }) {
	if (!platform) return <span aria-hidden="true">—</span>;
	const os = osForPlatform(platform);
	return (
		<span className="huan-row huan-row--tight">
			{os && <OsIcon os={os} />}
			<span>{PLATFORM_LABELS[platform]}</span>
			{arch && <span className="huan-caption huan-numeric">{arch}</span>}
		</span>
	);
}

/**
 * 「需要注意」的定義只寫在這裡。
 *
 * 總覽與裝置列表如果各自判斷，遲早會出現一邊說正常、一邊說落後的情況。
 */
export function deviceNeedsAttention(device: Device): string | null {
	if (device.status === "revoked") return "憑證已撤銷，需要重新配對";
	if (!device.online) return "目前離線";
	if (device.reported?.storageError) return device.reported.storageError;
	if (device.reported && device.reported.desiredVersion !== device.desiredVersion) return `版本落後（期望 ${device.desiredVersion}，實際 ${device.reported.desiredVersion ?? "未知"}）`;
	if (device.reported && device.reported.pendingAssetIds.length > 0) return `尚有 ${device.reported.pendingAssetIds.length} 個檔案未同步`;
	return null;
}

export function DeviceOnlineBadge({ device }: { device: Device }) {
	if (device.status === "revoked") return <Badge variant="danger">已解除綁定</Badge>;
	return (
		<span className="huan-row huan-row--tight">
			<span className="huan-dot" data-online={device.online} aria-hidden="true" />
			<Badge variant={device.online ? "success" : "danger"}>{device.online ? "線上" : "離線"}</Badge>
		</span>
	);
}

export function DiskMeter({ device }: { device: Device }) {
	const free = device.reported?.diskFreeBytes ?? null;
	const total = device.reported?.diskTotalBytes ?? null;
	if (free === null || total === null || total <= 0) return <span className="huan-caption">未回報</span>;
	const used = total - free;
	const ratio = used / total;
	return (
		<div className="huan-stack huan-stack--sm">
			<Meter label="磁碟使用量" value={Math.round(ratio * 100)} status={ratio > 0.9 ? "danger" : ratio > 0.75 ? "warning" : "neutral"} showValue />
			<span className="huan-caption huan-numeric">剩餘 {formatBytes(free)}</span>
		</div>
	);
}
