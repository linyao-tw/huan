import { MediaStatusBadge, mediaStatusDetail } from "@/components/MediaStatus";
import { MediaStatusSchema, type MediaStatus } from "@huan/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const EXPECTED_LABELS: Record<MediaStatus, string> = {
	uploading: "上傳中",
	uploaded: "等待處理",
	processing: "處理中",
	ready: "可使用",
	failed: "轉檔失敗",
	needs_reupload: "需重新上傳"
};

describe("素材狀態機的呈現", () => {
	it("每一個協定定義的狀態都有對應的標籤", () => {
		// 協定新增狀態時這個測試會失敗，避免 UI 悄悄漏掉一種狀態。
		for (const status of MediaStatusSchema.options) {
			const { unmount } = render(<MediaStatusBadge status={status} />);
			expect(screen.getByText(EXPECTED_LABELS[status])).toBeInTheDocument();
			unmount();
		}
	});

	it("進行中的狀態會顯示 spinner，完成或失敗則不會", () => {
		const { container: uploading } = render(<MediaStatusBadge status="uploading" />);
		expect(uploading.querySelector(".lyds-spinner")).not.toBeNull();

		const { container: ready } = render(<MediaStatusBadge status="ready" />);
		expect(ready.querySelector(".lyds-spinner")).toBeNull();

		const { container: failed } = render(<MediaStatusBadge status="failed" />);
		expect(failed.querySelector(".lyds-spinner")).toBeNull();
	});

	it("轉檔失敗顯示伺服器整理過的訊息，而不是通用說明", () => {
		expect(mediaStatusDetail({ status: "failed", errorMessage: "影片沒有可用的視訊軌，請確認檔案是否完整。" })).toBe("影片沒有可用的視訊軌，請確認檔案是否完整。");
	});

	it("沒有錯誤訊息時退回該狀態的一般說明", () => {
		expect(mediaStatusDetail({ status: "failed", errorMessage: null })).toContain("轉檔沒有成功");
	});

	it("needs_reupload 必須說明伺服器沒有保留原始檔", () => {
		const detail = mediaStatusDetail({ status: "needs_reupload", errorMessage: null });
		expect(detail).toContain("不長期保存原始檔");
		expect(detail).toContain("重新上傳");
	});
});
