import { CONTENT_TYPE_LABELS, playlistItemForAsset } from "@/features/layouts/editor/content";
import { ColorControl } from "@/shared/components/ColorControl";
import { ExternalUrlSchema, type MediaAsset, type ObjectFit, type PlaylistContent, type SlotContent, type TextAlign, type TickerDirection, type VerticalAlign } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Badge, EmptyState, IconButton, NumberField, SegmentedControl, SegmentedControlItem, Select, Slider, Switch, TextField, TextView } from "@linyao.tw/ui";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId, useState } from "react";

const FIT_OPTIONS: { value: ObjectFit; label: string }[] = [
	{ value: "contain", label: "完整顯示（留邊）" },
	{ value: "cover", label: "填滿裁切" },
	{ value: "fill", label: "拉伸變形" }
];

const FONT_WEIGHT_OPTIONS = [
	{ value: 300, label: "300 細" },
	{ value: 400, label: "400 一般" },
	{ value: 500, label: "500 中等" },
	{ value: 600, label: "600 半粗" },
	{ value: 700, label: "700 粗" },
	{ value: 800, label: "800 特粗" }
] as const;

type FontWeight = (typeof FONT_WEIGHT_OPTIONS)[number]["value"];

export interface ContentFormProps {
	content: SlotContent;
	assets: MediaAsset[];
	onChange: (next: SlotContent) => void;
}

function SwitchRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
	return (
		<label className="huan-switch-row">
			<span className="huan-switch-row__text">
				<span>{label}</span>
				{description ? <span className="huan-caption">{description}</span> : null}
			</span>
			<Switch checked={checked} onCheckedChange={onCheckedChange} />
		</label>
	);
}

function AssetSelect({ label, assets, value, onChange, emptyHint }: { label: string; assets: MediaAsset[]; value: string; onChange: (assetId: string) => void; emptyHint: string }) {
	if (assets.length === 0) return <EmptyState title="沒有可用的素材" description={emptyHint} />;
	return <Select label={label} value={value} onValueChange={next => next && onChange(next)} options={assets.map(asset => ({ value: asset.id, label: asset.name }))} />;
}

function TextStyleFields({ content, onChange }: { content: Extract<SlotContent, { type: "text" | "ticker" }>; onChange: (next: SlotContent) => void }) {
	return (
		<>
			<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} description="色碼最後兩碼是透明度，00 就是完全透明。" />
			<ColorControl label="文字色" value={content.color} onChange={value => onChange({ ...content, color: value })} />
			<NumberField label="字級（px）" min={8} max={400} step={2} value={content.fontSize} onValueChange={value => onChange({ ...content, fontSize: value ?? content.fontSize })} />
			<Select
				label="字重"
				value={content.fontWeight}
				onValueChange={value => onChange({ ...content, fontWeight: (value ?? content.fontWeight) as FontWeight })}
				options={FONT_WEIGHT_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
			/>
			<NumberField label="文字與邊界的距離（px）" min={0} max={400} step={4} value={content.padding} onValueChange={value => onChange({ ...content, padding: value ?? content.padding })} />
		</>
	);
}

/**
 * 媒體輪播的編排。
 *
 * 只收圖片與影片，順序就是播放順序。圖片可以設停留秒數；影片播完整段就換，所以
 * 不給它設時間。加素材、上下移、刪除都在這裡，實機依這份清單依序輪播。
 */
function PlaylistForm({ content, assets, onChange }: { content: PlaylistContent; assets: MediaAsset[]; onChange: (next: SlotContent) => void }) {
	const playable = assets.filter(asset => asset.kind === "image" || asset.kind === "video");
	const nameOf = new Map(assets.map(asset => [asset.id, asset.name]));

	const setItems = (items: PlaylistContent["items"]): void => onChange({ ...content, items });

	const move = (index: number, delta: number): void => {
		const next = [...content.items];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target]!, next[index]!];
		setItems(next);
	};

	const remove = (index: number): void => {
		if (content.items.length <= 1) return; // 至少留一則，否則會變成不合法的空輪播
		setItems(content.items.filter((_item, current) => current !== index));
	};

	const add = (assetId: string): void => {
		const asset = playable.find(item => item.id === assetId);
		const item = asset ? playlistItemForAsset(asset) : null;
		if (item) setItems([...content.items, item]);
	};

	return (
		<div className="huan-stack">
			<ol className="huan-playlist">
				{content.items.map((item, index) => (
					<li key={`${item.assetId}-${index}`} className="huan-playlist__item">
						<span className="huan-playlist__index huan-numeric">{index + 1}</span>
						<span className="huan-playlist__body">
							<span className="huan-row huan-row--tight">
								<Badge variant="neutral" size="sm">
									{item.kind === "video" ? "影片" : "圖片"}
								</Badge>
								<span className="huan-truncate">{nameOf.get(item.assetId) ?? "素材已不存在"}</span>
							</span>
							{item.kind === "image" ? (
								<NumberField
									label="停留秒數"
									size="sm"
									min={1}
									max={600}
									step={1}
									value={Math.round(item.durationMs / 1000)}
									onValueChange={value => {
										if (value === null) return;
										setItems(content.items.map((current, at) => (at === index ? { ...current, durationMs: value * 1000 } : current)));
									}}
								/>
							) : (
								<span className="huan-caption">影片播完整段才換</span>
							)}
						</span>
						<span className="huan-playlist__actions">
							<IconButton aria-label="往前移" variant="quiet" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
								<ArrowUpIcon weight="bold" />
							</IconButton>
							<IconButton aria-label="往後移" variant="quiet" size="sm" disabled={index === content.items.length - 1} onClick={() => move(index, 1)}>
								<ArrowDownIcon weight="bold" />
							</IconButton>
							<IconButton aria-label="移除" variant="quiet" size="sm" disabled={content.items.length <= 1} onClick={() => remove(index)}>
								<TrashIcon weight="bold" />
							</IconButton>
						</span>
					</li>
				))}
			</ol>

			{playable.length === 0 ? (
				<p className="huan-caption">素材庫裡還沒有處理完成的圖片或影片。</p>
			) : (
				<Select label="加入素材" placeholder="挑一個圖片或影片" value={null} onValueChange={value => value && add(value)} options={playable.map(asset => ({ value: asset.id, label: asset.name }))} />
			)}

			<Select label="縮放方式" value={content.fit} onValueChange={value => value && onChange({ ...content, fit: value })} options={FIT_OPTIONS} />
			<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} description="素材沒填滿這一塊時，露出來的顏色。" />
		</div>
	);
}

export function ContentForm({ content, assets, onChange }: ContentFormProps) {
	const volumeLabelId = useId();
	const [urlDraft, setUrlDraft] = useState(content.type === "url" ? content.url : "");

	if (content.type === "text") {
		return (
			<div className="huan-stack">
				<TextView label="文字內容" rows={4} value={content.text} onChange={event => onChange({ ...content, text: event.target.value })} description="換行會照樣顯示，最多 4000 個字。" />
				<TextStyleFields content={content} onChange={onChange} />
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">水平對齊</span>
					<SegmentedControl aria-label="水平對齊" size="sm" value={content.align} onValueChange={value => value && onChange({ ...content, align: value as TextAlign })}>
						<SegmentedControlItem value="start">靠左</SegmentedControlItem>
						<SegmentedControlItem value="center">置中</SegmentedControlItem>
						<SegmentedControlItem value="end">靠右</SegmentedControlItem>
					</SegmentedControl>
				</div>
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">垂直對齊</span>
					<SegmentedControl aria-label="垂直對齊" size="sm" value={content.verticalAlign} onValueChange={value => value && onChange({ ...content, verticalAlign: value as VerticalAlign })}>
						<SegmentedControlItem value="start">靠上</SegmentedControlItem>
						<SegmentedControlItem value="center">置中</SegmentedControlItem>
						<SegmentedControlItem value="end">靠下</SegmentedControlItem>
					</SegmentedControl>
				</div>
			</div>
		);
	}

	if (content.type === "ticker") {
		return (
			<div className="huan-stack">
				<TextView label="跑馬燈文字" rows={3} value={content.text} onChange={event => onChange({ ...content, text: event.target.value })} />
				<TextStyleFields content={content} onChange={onChange} />
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted">捲動方向</span>
					<SegmentedControl aria-label="捲動方向" size="sm" value={content.direction} onValueChange={value => value && onChange({ ...content, direction: value as TickerDirection })}>
						<SegmentedControlItem value="left">向左</SegmentedControlItem>
						<SegmentedControlItem value="right">向右</SegmentedControlItem>
					</SegmentedControl>
				</div>
				<NumberField label="捲動速度（每秒 px）" min={10} max={600} step={10} value={content.speed} onValueChange={value => onChange({ ...content, speed: value ?? content.speed })} />
				<NumberField label="每一輪之間的間隔（px）" min={0} max={2000} step={20} value={content.gap} onValueChange={value => onChange({ ...content, gap: value ?? content.gap })} />
			</div>
		);
	}

	if (content.type === "image") {
		return (
			<div className="huan-stack">
				<AssetSelect label="圖片素材" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="請先到素材庫上傳圖片，等處理完成才會出現在這裡。" />
				<Select label="縮放方式" value={content.fit} onValueChange={value => value && onChange({ ...content, fit: value })} options={FIT_OPTIONS} />
				<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} description="圖片沒有填滿這一塊時，露出來的顏色。" />
			</div>
		);
	}

	if (content.type === "video") {
		return (
			<div className="huan-stack">
				<AssetSelect label="影片素材" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="請先到素材庫上傳影片，等處理完成才會出現在這裡。" />
				<Select label="縮放方式" value={content.fit} onValueChange={value => value && onChange({ ...content, fit: value })} options={FIT_OPTIONS} />
				<SwitchRow label="重複播放" checked={content.loop} onCheckedChange={checked => onChange({ ...content, loop: checked })} />
				<SwitchRow label="靜音" description="看板現場多半不需要聲音。關掉靜音，下面的音量才有作用。" checked={content.muted} onCheckedChange={checked => onChange({ ...content, muted: checked })} />
				<div className="huan-stack huan-stack--sm">
					<span className="huan-muted" id={volumeLabelId}>
						音量（%）
					</span>
					{/* 文件裡的音量是 0–1，但畫面上「音量 1」看不出是最大還是最小，所以用百分比呈現。 */}
					<Slider
						aria-labelledby={volumeLabelId}
						showValue
						min={0}
						max={100}
						step={5}
						value={Math.round(content.volume * 100)}
						disabled={content.muted}
						onValueChange={value => onChange({ ...content, volume: typeof value === "number" ? value / 100 : content.volume })}
					/>
				</div>
				<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} />
			</div>
		);
	}

	if (content.type === "playlist") {
		return <PlaylistForm content={content} assets={assets} onChange={onChange} />;
	}

	if (content.type === "url") {
		const parsed = ExternalUrlSchema.safeParse(urlDraft);
		return (
			<div className="huan-stack">
				<TextField
					label="網址"
					type="url"
					inputMode="url"
					value={urlDraft}
					onChange={event => {
						const next = event.target.value;
						setUrlDraft(next);
						const result = ExternalUrlSchema.safeParse(next);
						if (result.success) onChange({ ...content, url: result.data });
					}}
					invalid={!parsed.success}
					error={parsed.success ? undefined : "請輸入完整的 http 或 https 網址，網址裡不能有帳號密碼。"}
					description="建議用 https。這個網頁會直接顯示在畫面上。"
				/>
				<Alert status="warning">
					<AlertTitle>很多網站不讓別人放進畫面</AlertTitle>
					<AlertDescription>這是對方網站自己的設定，遇到時這一塊會是空白的，HUAN 沒有辦法繞過。請改用對方提供的嵌入用網址，或把內容做成圖片、影片再上傳。</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="huan-stack">
			<AssetSelect label="HTML 素材" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="請先到素材庫上傳 .html 檔案。" />
			<Alert status="info">
				<AlertTitle>HTML 是隔離執行的</AlertTitle>
				<AlertDescription>上傳的 HTML 讀不到播放裝置上的檔案，也不能操作裝置。需要外部資料時，讓網頁自己上網去取。</AlertDescription>
			</Alert>
		</div>
	);
}

export function contentTypeLabel(content: SlotContent | null): string {
	return content ? CONTENT_TYPE_LABELS[content.type] : "空白";
}
