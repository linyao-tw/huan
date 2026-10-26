import "@/features/layouts/layouts.css";
import type { MediaAsset, PlaylistContent, SlotContent, TickerContent } from "@huan/protocol";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const ALIGN_TO_FLEX: Record<"start" | "center" | "end", CSSProperties["justifyContent"]> = { start: "flex-start", center: "center", end: "flex-end" };
const ALIGN_TO_TEXT: Record<"start" | "center" | "end", CSSProperties["textAlign"]> = { start: "start", center: "center", end: "end" };

export interface SlotPreviewProps {
	content: SlotContent | null;
	assets: Map<string, MediaAsset>;
	/** 設計 px → 畫面 px 的倍率。所有來自版面文件的長度都要乘上它才會與實機一致。 */
	scale: number;
	/** 編輯時在清單上點到的那一則；沒有指定就是第一則。 */
	playlistIndex?: number | undefined;
	/** 預覽模式：輪播真的會依秒數與影片長度往下換，跟實機一樣。 */
	live?: boolean;
}

function TickerPreview({ content, scale }: { content: TickerContent; scale: number }) {
	const copyRef = useRef<HTMLSpanElement>(null);
	const [copyWidth, setCopyWidth] = useState(0);

	// 量一次寬度就能算出動畫長度，之後完全交給 CSS；跑馬燈不需要每一幀都讓 React 重繪。
	useEffect(() => {
		const element = copyRef.current;
		if (!element) return;
		const observer = new ResizeObserver(entries => {
			const entry = entries[0];
			if (entry) setCopyWidth(entry.contentRect.width);
		});
		observer.observe(element);
		setCopyWidth(element.getBoundingClientRect().width);
		return () => observer.disconnect();
	}, [content.text, content.fontSize, content.fontWeight, scale]);

	const gapPx = content.gap * scale;
	const cycleWidth = copyWidth + gapPx;
	const speedPx = Math.max(1, content.speed * scale);
	const duration = cycleWidth > 0 ? cycleWidth / speedPx : 1;

	const textStyle: CSSProperties = {
		color: content.color,
		fontSize: `${content.fontSize * scale}px`,
		fontWeight: content.fontWeight,
		lineHeight: 1.2
	};

	return (
		<div className="huan-ticker" style={{ background: content.backgroundColor, paddingBlock: `${content.padding * scale}px` }}>
			<div className="huan-ticker__track" data-direction={content.direction} style={{ ["--huan-ticker-duration" as string]: `${duration}s`, columnGap: `${gapPx}px` }}>
				<span className="huan-ticker__copy" ref={copyRef} style={textStyle}>
					{content.text}
				</span>
				<span className="huan-ticker__copy" aria-hidden="true" style={textStyle}>
					{content.text}
				</span>
			</div>
		</div>
	);
}

/**
 * 編輯時顯示清單上點到的那一則，預覽模式才真的跑計時器。
 *
 * 換則的規則和播放器一致：圖片停 `imageDurationMs`，影片播完整段才換。只有一則
 * 影片時直接循環，否則 `ended` 之後同一支影片不會再觸發任何事件，畫面會停在最後一格。
 */
function PlaylistPreview({ content, assets, index, live }: { content: PlaylistContent; assets: Map<string, MediaAsset>; index: number; live: boolean }) {
	const [liveIndex, setLiveIndex] = useState(0);
	const count = content.items.length;
	const current = Math.min(Math.max(live ? liveIndex : index, 0), Math.max(count - 1, 0));
	const item = content.items[current];
	const asset = item ? assets.get(item.assetId) : undefined;
	const advance = (): void => setLiveIndex(value => (count > 0 ? (value + 1) % count : 0));

	/** 影片靠 `ended` 換下一則；預覽檔還沒產生的影片沒有 `ended` 可等，改用圖片的秒數，免得卡住。 */
	const waitsForEnded = item?.kind === "video" && Boolean(asset?.previewUrl);

	// 依賴 current 而不是 item：同一張圖連續出現在清單兩處時，計時器也要重新開始。
	useEffect(() => {
		if (!live || !item || waitsForEnded || count <= 1) return;
		const timer = setTimeout(() => setLiveIndex(value => (value + 1) % count), content.imageDurationMs);
		return () => clearTimeout(timer);
	}, [live, item, waitsForEnded, current, count, content.imageDurationMs]);

	return (
		<div className="huan-preview-playlist" style={{ background: content.backgroundColor }}>
			{asset?.previewUrl ? (
				item?.kind === "video" ? (
					<video
						key={`${current}-${asset.id}`}
						className="huan-preview-media"
						src={asset.previewUrl}
						style={{ objectFit: content.fit }}
						muted
						autoPlay
						playsInline
						loop={!live || count <= 1}
						preload="metadata"
						onEnded={live ? advance : undefined}
					/>
				) : (
					<img className="huan-preview-media" src={asset.previewUrl} alt="" style={{ objectFit: content.fit }} />
				)
			) : (
				<div className="huan-preview-placeholder">{item ? "預覽尚未產生" : "尚未加入素材"}</div>
			)}
			{live ? null : (
				<span className="huan-preview-playlist__count">
					輪播 · 第 {current + 1} / {count} 則
				</span>
			)}
		</div>
	);
}

export function SlotPreview({ content, assets, scale, playlistIndex, live = false }: SlotPreviewProps) {
	if (!content) return null;

	if (content.type === "text") {
		return (
			<div
				className="huan-preview-text"
				style={{
					background: content.backgroundColor,
					color: content.color,
					fontSize: `${content.fontSize * scale}px`,
					fontWeight: content.fontWeight,
					padding: `${content.padding * scale}px`,
					justifyContent: ALIGN_TO_FLEX[content.align],
					alignItems: ALIGN_TO_FLEX[content.verticalAlign],
					textAlign: ALIGN_TO_TEXT[content.align],
					lineHeight: 1.25
				}}
			>
				<span>{content.text}</span>
			</div>
		);
	}

	if (content.type === "ticker") return <TickerPreview content={content} scale={scale} />;

	if (content.type === "image") {
		const asset = assets.get(content.assetId);
		if (!asset?.previewUrl) return <div className="huan-preview-placeholder">{asset ? "預覽尚未產生" : "素材不存在"}</div>;
		return <img className="huan-preview-media" src={asset.previewUrl} alt="" style={{ objectFit: content.fit, background: content.backgroundColor }} />;
	}

	if (content.type === "video") {
		const asset = assets.get(content.assetId);
		if (!asset?.previewUrl) return <div className="huan-preview-placeholder">{asset ? "預覽尚未產生" : "素材不存在"}</div>;
		// 預覽一律靜音：編輯版面時不應該突然發出聲音，實機音量由 `volume` 決定。
		return (
			<video
				className="huan-preview-media"
				src={asset.previewUrl}
				style={{ objectFit: content.fit, background: content.backgroundColor }}
				muted
				autoPlay
				playsInline
				loop={content.loop}
				preload="metadata"
			/>
		);
	}

	if (content.type === "playlist") return <PlaylistPreview content={content} assets={assets} index={playlistIndex ?? 0} live={live} />;

	if (content.type === "url") {
		return <iframe className="huan-preview-frame" src={content.url} title="網頁內容預覽" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" loading="lazy" />;
	}

	const asset = assets.get(content.assetId);
	if (!asset?.previewUrl) return <div className="huan-preview-placeholder">{asset ? "HTML 預覽尚未產生" : "素材不存在"}</div>;
	return <iframe className="huan-preview-frame" src={asset.previewUrl} title="HTML 素材預覽" sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" />;
}
