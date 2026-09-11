import { bridge } from "@/renderer/src/bridge";
import { SANDBOX_PARTITION } from "@/shared/ipc";
import { computeFitTransform, computeLayoutGeometry, type SlotRect } from "@huan/layout-engine";
import type { LayoutDocument, SlotContent } from "@huan/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

export interface AssetResolver {
	/** 由目前啟用的 manifest 提供：assetId → 本機檔名。找不到就代表這個素材還沒同步完。 */
	fileNameFor(assetId: string): string | null;
}

interface LayoutRendererProps {
	document: LayoutDocument;
	assets: AssetResolver;
}

function useViewport(): { width: number; height: number } {
	const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
	useEffect(() => {
		const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return size;
}

/**
 * 把本機檔名換成自訂協定的網址。
 *
 * renderer 沒有 Node，也拿不到 `file://` —— 那等於把整個檔案系統交給沙箱裡的頁面。
 * `huan-media://` 由主行程處理，可讀範圍限制在媒體目錄裡的單一檔名。
 */
function useMediaUrl(fileName: string | null): string | null {
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
	return url;
}

function textStyle(content: Extract<SlotContent, { type: "text" | "ticker" }>): React.CSSProperties {
	return {
		background: content.backgroundColor,
		color: content.color,
		fontSize: `${content.fontSize}px`,
		fontWeight: content.fontWeight,
		padding: `${content.padding}px`
	};
}

const ALIGNMENT: Record<"start" | "center" | "end", string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end"
};

function TextSlot({ content }: { content: Extract<SlotContent, { type: "text" }> }): React.JSX.Element {
	return (
		<div
			className="huan-text"
			style={{
				...textStyle(content),
				justifyContent: ALIGNMENT[content.align],
				alignItems: ALIGNMENT[content.verticalAlign],
				textAlign: content.align === "start" ? "left" : content.align === "end" ? "right" : "center"
			}}
		>
			{content.text}
		</div>
	);
}

function TickerSlot({ content, width }: { content: Extract<SlotContent, { type: "ticker" }>; width: number }): React.JSX.Element {
	const trackRef = useRef<HTMLDivElement>(null);
	const [duration, setDuration] = useState(20);

	/**
	 * 動畫時間由「內容長度 ÷ 速度」決定，量一次就好。
	 * 每一幀重新計算會讓 60fps 的看板持續跑 layout，這正是要避免的事。
	 */
	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const measure = (): void => {
			const distance = track.scrollWidth / 2;
			if (distance > 0) setDuration(Math.max(2, distance / content.speed));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(track);
		return () => observer.disconnect();
	}, [content.text, content.speed, content.gap, content.fontSize, width]);

	const item = (
		<span className="huan-ticker__item" style={{ paddingInlineEnd: `${content.gap}px` }}>
			{content.text}
		</span>
	);

	return (
		<div className="huan-ticker" style={textStyle(content)}>
			<div ref={trackRef} className="huan-ticker__track" data-direction={content.direction} style={{ animationDuration: `${duration}s` }}>
				{item}
				{item}
			</div>
		</div>
	);
}

function ImageSlot({ content, assets }: { content: Extract<SlotContent, { type: "image" }>; assets: AssetResolver }): React.JSX.Element {
	const url = useMediaUrl(assets.fileNameFor(content.assetId));
	if (!url) return <div style={{ background: content.backgroundColor }} />;
	return <img src={url} alt="" style={{ objectFit: content.fit, background: content.backgroundColor, width: "100%", height: "100%" }} />;
}

function VideoSlot({ content, assets }: { content: Extract<SlotContent, { type: "video" }>; assets: AssetResolver }): React.JSX.Element {
	const url = useMediaUrl(assets.fileNameFor(content.assetId));
	const ref = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.volume = content.muted ? 0 : content.volume;
	}, [content.muted, content.volume, url]);

	/**
	 * 播放的一律是本機已驗證的檔案，不會在播放時去串流物件儲存。
	 * `key` 綁在網址上，換素材時強制重建 <video>，避免舊的緩衝殘留。
	 */
	if (!url) return <div style={{ background: content.backgroundColor }} />;
	return (
		<video
			key={url}
			ref={ref}
			src={url}
			autoPlay
			muted={content.muted}
			loop={content.loop}
			playsInline
			style={{ objectFit: content.fit, background: content.backgroundColor, width: "100%", height: "100%" }}
		/>
	);
}

function UrlSlot({ content }: { content: Extract<SlotContent, { type: "url" }> }): React.JSX.Element {
	/**
	 * 外部網站可能設定 X-Frame-Options 或 frame-ancestors 而無法嵌入。
	 * 那是對方的安全設定，播放器不會嘗試繞過，只會顯示空白區塊。
	 */
	return <iframe src={content.url} title="外部內容" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />;
}

function HtmlSlot({ content, assets }: { content: Extract<SlotContent, { type: "html" }>; assets: AssetResolver }): React.JSX.Element {
	const url = useMediaUrl(assets.fileNameFor(content.assetId));
	if (!url) return <div />;
	/**
	 * 上傳的 HTML 在獨立的 partition 與 sandbox iframe 裡執行：
	 * 沒有 same-origin、沒有 Node、沒有 preload，也拿不到播放器的任何 API。
	 */
	return <iframe src={url} title="自訂內容" sandbox="allow-scripts" referrerPolicy="no-referrer" data-partition={SANDBOX_PARTITION} />;
}

function SlotView({ slot, assets }: { slot: SlotRect; assets: AssetResolver }): React.JSX.Element | null {
	const content = slot.content;
	if (!content) return null;
	switch (content.type) {
		case "text":
			return <TextSlot content={content} />;
		case "ticker":
			return <TickerSlot content={content} width={slot.width} />;
		case "image":
			return <ImageSlot content={content} assets={assets} />;
		case "video":
			return <VideoSlot content={content} assets={assets} />;
		case "url":
			return <UrlSlot content={content} />;
		case "html":
			return <HtmlSlot content={content} assets={assets} />;
	}
}

/**
 * 用 `@huan/layout-engine` 算出每個區塊的位置，再把設計畫布等比縮放到實體螢幕。
 *
 * 這裡刻意沒有任何幾何計算：後台預覽走的是同一組函式，因此「後台看到 70/30、
 * 實機變成 68/32」這種偏差不可能發生。
 */
export function LayoutRenderer({ document, assets }: LayoutRendererProps): React.JSX.Element {
	const viewport = useViewport();
	const geometry = useMemo(() => computeLayoutGeometry(document), [document]);
	const fit = useMemo(() => computeFitTransform(document.canvas, viewport), [document.canvas, viewport]);
	const backgroundFileName = document.background.imageAssetId ? assets.fileNameFor(document.background.imageAssetId) : null;
	const backgroundUrl = useMediaUrl(backgroundFileName);

	return (
		<div className="huan-stage" style={{ background: document.background.color }}>
			<div
				className="huan-canvas"
				style={{
					width: `${document.canvas.width}px`,
					height: `${document.canvas.height}px`,
					left: `${fit.offsetX}px`,
					top: `${fit.offsetY}px`,
					transform: `scale(${fit.scale})`,
					background: backgroundUrl
						? `${document.background.color} url(${JSON.stringify(backgroundUrl)}) center / ${document.background.imageFit === "fill" ? "100% 100%" : document.background.imageFit} no-repeat`
						: document.background.color
				}}
			>
				{geometry.slots.map(slot => (
					<div key={slot.nodeId} className="huan-region" style={{ left: `${slot.x}px`, top: `${slot.y}px`, width: `${slot.width}px`, height: `${slot.height}px` }}>
						<SlotView slot={slot} assets={assets} />
					</div>
				))}
			</div>
		</div>
	);
}
