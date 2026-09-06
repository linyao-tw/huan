import type { MediaAsset, MediaStatus } from "@huan/protocol";
import type { BadgeVariant, FeedbackStatus } from "@linyao.tw/ui";
import { Badge, Spinner } from "@linyao.tw/ui";

interface MediaStatusDescriptor {
	label: string;
	badge: BadgeVariant;
	feedback: FeedbackStatus;
	busy: boolean;
	explanation: string;
}

/**
 * 每一個狀態都要說得出「現在發生什麼事」與「使用者能做什麼」。
 *
 * `needs_reupload` 特別重要：HUAN 不長期保存原始檔，播放產物回收後檔案就真的不在了。
 * 這裡必須誠實講出來，不能假裝伺服器還留著。
 */
export const MEDIA_STATUS_DESCRIPTORS: Record<MediaStatus, MediaStatusDescriptor> = {
	uploading: { label: "上傳中", badge: "neutral", feedback: "neutral", busy: true, explanation: "檔案正在直接傳送到儲存空間，離開頁面會中斷上傳。" },
	uploaded: { label: "等待處理", badge: "accent", feedback: "info", busy: true, explanation: "檔案已送達，正在排隊等待轉檔工作。" },
	processing: { label: "處理中", badge: "accent", feedback: "info", busy: true, explanation: "轉檔中，完成後會自動產生縮圖、預覽與播放版本。" },
	ready: { label: "可使用", badge: "success", feedback: "success", busy: false, explanation: "已完成轉檔，可以放進版面與排程。" },
	failed: { label: "轉檔失敗", badge: "danger", feedback: "danger", busy: false, explanation: "轉檔沒有成功，請確認檔案格式後重新上傳。" },
	needs_reupload: {
		label: "需重新上傳",
		badge: "warning",
		feedback: "warning",
		busy: false,
		explanation: "HUAN 不長期保存原始檔：轉檔完成後原始檔就會刪除，播放版本在所有裝置確認並過了保留期後也會回收。這份素材現在沒有可派送的檔案，必須重新上傳同一個檔案才能繼續使用。"
	}
};

export function mediaStatusDescriptor(status: MediaStatus): MediaStatusDescriptor {
	return MEDIA_STATUS_DESCRIPTORS[status];
}

export function MediaStatusBadge({ status }: { status: MediaStatus }) {
	const descriptor = mediaStatusDescriptor(status);
	return (
		<span className="huan-row huan-row--tight">
			{descriptor.busy ? <Spinner size="sm" decorative /> : null}
			<Badge variant={descriptor.badge}>{descriptor.label}</Badge>
		</span>
	);
}

/** Worker 的失敗訊息是 Server 已經整理過的使用者可讀版本，不含指令與路徑。 */
export function mediaStatusDetail(asset: Pick<MediaAsset, "status" | "errorMessage">): string {
	const descriptor = mediaStatusDescriptor(asset.status);
	if (asset.status === "failed" && asset.errorMessage) return asset.errorMessage;
	return descriptor.explanation;
}
