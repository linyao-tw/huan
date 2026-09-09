import "@/features/devices/devices.css";
import { OsIcon, osForPlatform } from "@/shared/components/OsIcon";
import type { Device, DevicePlatform } from "@huan/protocol";
import { formatBytes } from "@huan/shared";
import { Badge, Meter, type BadgeVariant } from "@linyao.tw/ui";

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
 *
 * 回傳的句子會直接出現在畫面上，所以講的是後果，不是機制：使用者要知道的是
 * 「畫面現在播什麼、還會不會更新」，不是伺服器與裝置各自宣告了第幾版。
 */
export function deviceNeedsAttention(device: Device): string | null {
	if (device.status === "revoked") return "已經移出系統，要重新加入才會再收到內容";
	if (!device.online) return "連不上，畫面還在播最後收到的內容";
	if (device.reported?.storageError) return "裝置存不下檔案，新內容沒辦法下載";
	if (device.reported && device.reported.desiredVersion !== device.desiredVersion) return "還在下載新內容，下載完會自己換過去";
	if (device.reported && device.reported.pendingAssetIds.length > 0) return `還有 ${device.reported.pendingAssetIds.length} 個檔案在下載`;
	return null;
}

export interface DeviceContentState {
	label: string;
	variant: BadgeVariant;
	/** 補一句「還差什麼」，只在有具體數字時才有值。 */
	detail: string | null;
}

/**
 * 「這台裝置的內容是不是最新的」。
 *
 * 協定上這是 desired 與 reported 兩個版本號的比較，但版本號對使用這套系統的人
 * 沒有意義 —— 他要決定的是「現在能不能放心離開」。所以對外只有三種答案：
 * 最新、更新中、還沒連上過。
 */
export function deviceContentState(device: Device): DeviceContentState {
	if (device.status === "revoked") return { label: "不再更新", variant: "neutral", detail: null };
	if (!device.reported) return { label: "還沒連上過", variant: "neutral", detail: null };
	if (device.reported.desiredVersion !== device.desiredVersion) return { label: "更新中", variant: "warning", detail: "正在取得新內容" };
	const pending = device.reported.pendingAssetIds.length;
	if (pending > 0) return { label: "更新中", variant: "warning", detail: `還有 ${pending} 個檔案要下載` };
	return { label: "最新", variant: "success", detail: null };
}

/**
 * 只有「不是最新」才上色。
 *
 * 每一列都掛一顆綠色徽章等於沒有訊號 —— 正常本來就是多數。把正常寫成一般文字，
 * 顏色就留給真正需要被看見的那幾列。
 */
export function DeviceContentBadge({ device }: { device: Device }) {
	const state = deviceContentState(device);
	if (state.variant === "success") return <span className="huan-muted">{state.label}</span>;
	return (
		<Badge variant={state.variant} size="sm">
			{state.label}
		</Badge>
	);
}

export function DeviceOnlineBadge({ device }: { device: Device }) {
	if (device.status === "revoked")
		return (
			<Badge variant="neutral" size="sm">
				已移除
			</Badge>
		);
	/* Badge 自己就會畫一顆狀態圓點，外面不需要再補一顆。 */
	return (
		<Badge variant={device.online ? "success" : "danger"} size="sm">
			{device.online ? "線上" : "離線"}
		</Badge>
	);
}

/**
 * 儲存空間。
 *
 * `compact` 是給表格列用的：只留「還剩多少」與一條軌道。詳情頁用完整版本，
 * 那裡有空間把百分比與總容量一起寫清楚。
 */
export function DiskMeter({ device, compact = false }: { device: Device; compact?: boolean }) {
	const free = device.reported?.diskFreeBytes ?? null;
	const total = device.reported?.diskTotalBytes ?? null;

	if (device.reported?.storageError)
		return (
			<Badge variant="danger" size="sm">
				存不下檔案
			</Badge>
		);
	if (free === null || total === null || total <= 0) return <span className="huan-caption">未回報</span>;

	const used = total - free;
	const ratio = used / total;
	const status = ratio > 0.9 ? "danger" : ratio > 0.75 ? "warning" : "neutral";

	if (compact)
		return (
			<div className="huan-device-disk">
				<Meter label={`剩 ${formatBytes(free)}`} value={Math.round(ratio * 100)} status={status} showValue={false} />
			</div>
		);

	return (
		<div className="huan-stack huan-stack--sm">
			<Meter label="已用空間" value={Math.round(ratio * 100)} status={status} showValue />
			<span className="huan-caption huan-numeric">
				還剩 {formatBytes(free)}，總共 {formatBytes(total)}
			</span>
		</div>
	);
}
