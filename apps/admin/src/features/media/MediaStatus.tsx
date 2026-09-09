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
 * 每一個狀態都要說得出「現在怎麼了」與「該做什麼」，而且用店長看得懂的話。
 *
 * `needs_reupload` 特別重要：伺服器上真的已經沒有這個檔案了。使用者需要知道的是
 * 這個後果與「再上傳一次」這個動作，不是回收與保留期怎麼運作。
 */
export const MEDIA_STATUS_DESCRIPTORS: Record<MediaStatus, MediaStatusDescriptor> = {
	uploading: { label: "上傳中", badge: "neutral", feedback: "neutral", busy: true, explanation: "正在上傳。關掉這個頁面會中斷。" },
	uploaded: { label: "等待處理", badge: "accent", feedback: "info", busy: true, explanation: "檔案已經收到，排隊等著處理。" },
	processing: { label: "處理中", badge: "accent", feedback: "info", busy: true, explanation: "正在處理，完成後就可以放進版面。" },
	ready: { label: "可使用", badge: "success", feedback: "success", busy: false, explanation: "可以放進版面與排程了。" },
	failed: { label: "轉檔失敗", badge: "danger", feedback: "danger", busy: false, explanation: "轉檔沒有成功。換成 MP4、JPEG 或 PNG 再上傳一次；同一個檔案重試通常還是會失敗。" },
	needs_reupload: {
		label: "需重新上傳",
		badge: "warning",
		feedback: "warning",
		busy: false,
		explanation: "伺服器上已經沒有這個檔案了。重新上傳同一個檔案，正在用它的版面就會恢復。"
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
