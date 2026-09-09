import type { MediaAsset, SlotContent, TickerContent } from "@huan/protocol";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const ALIGN_TO_FLEX: Record<"start" | "center" | "end", CSSProperties["justifyContent"]> = { start: "flex-start", center: "center", end: "flex-end" };
const ALIGN_TO_TEXT: Record<"start" | "center" | "end", CSSProperties["textAlign"]> = { start: "start", center: "center", end: "end" };

export interface SlotPreviewProps {
	content: SlotContent | null;
	assets: Map<string, MediaAsset>;
	/** 設計 px → 畫面 px 的倍率。所有來自版面文件的長度都要乘上它才會與實機一致。 */
	scale: number;
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

export function SlotPreview({ content, assets, scale }: SlotPreviewProps) {
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

	if (content.type === "url") {
		return <iframe className="huan-preview-frame" src={content.url} title="網頁內容預覽" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" loading="lazy" />;
	}

	const asset = assets.get(content.assetId);
	if (!asset?.previewUrl) return <div className="huan-preview-placeholder">{asset ? "HTML 預覽尚未產生" : "素材不存在"}</div>;
	return <iframe className="huan-preview-frame" src={asset.previewUrl} title="HTML 素材預覽" sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" />;
}
