import { bridge } from "@/renderer/src/bridge";
import type { AssetResolver } from "@/renderer/src/components/LayoutRenderer";
import type { DeviceIdle } from "@huan/protocol";
import { useEffect, useState } from "react";

interface IdleScreenProps {
	message: string;
	detail?: string;
}

/** 沒有排程也沒有預設版面時的待命畫面。刻意保持極簡，看板不該顯示除錯訊息。 */
export function IdleScreen({ message, detail }: IdleScreenProps): React.JSX.Element {
	return (
		<div className="huan-shell">
			<div className="huan-shell__inner">
				<div className="huan-brand">
					<span className="huan-brand__latin">HUAN</span>
					<span className="huan-brand__han">讙</span>
				</div>
				<p>{message}</p>
				{detail ? <p style={{ color: "var(--text-secondary)" }}>{detail}</p> : null}
			</div>
		</div>
	);
}

/**
 * 依後台的設定決定待命時螢幕上是什麼。
 *
 * 選了圖片但檔案還沒同步下來時退回全黑，不退回品牌畫面：使用者刻意挑了一張圖，
 * 代表他不要那個畫面出現在現場，暫時黑著比擅自換成別的東西誠實。
 */
export function DeviceIdleScreen({ idle, assets, message, detail }: { idle: DeviceIdle; assets: AssetResolver; message: string; detail?: string }): React.JSX.Element {
	const fileName = idle.mode === "image" && idle.imageAssetId ? assets.fileNameFor(idle.imageAssetId) : null;
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!fileName) {
			setUrl(null);
			return;
		}
		void bridge.mediaUrl(fileName).then(value => {
			if (!cancelled) setUrl(value);
		});
		return () => {
			cancelled = true;
		};
	}, [fileName]);

	if (idle.mode === "black") return <div className="huan-idle-black" />;

	if (idle.mode === "image") {
		if (!url) return <div className="huan-idle-black" />;
		return <img className="huan-idle-image" src={url} alt="" />;
	}

	return <IdleScreen message={message} {...(detail === undefined ? {} : { detail })} />;
}
