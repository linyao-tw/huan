import { CONTENT_TYPE_LABELS, playlistItemForAsset } from "@/features/layouts/editor/content";
import { AssetPicker } from "@/features/media/AssetPicker";
import { ColorControl } from "@/shared/components/ColorControl";
import {
	ExternalUrlSchema,
	PLAYLIST_MAX_IMAGE_DURATION_MS,
	PLAYLIST_MIN_IMAGE_DURATION_MS,
	type MediaAsset,
	type MediaKind,
	type ObjectFit,
	type PlaylistContent,
	type PlaylistItem,
	type SlotContent,
	type TextAlign,
	type TickerDirection,
	type VerticalAlign
} from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Badge, Button, IconButton, NumberField, SegmentedControl, SegmentedControlItem, Select, Slider, Switch, TextField, TextView } from "@linyao.tw/ui";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
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

/**
 * 目前選到的素材，加上一顆「換一個」。
 *
 * 從下拉換成對話框是刻意的：下拉只看得到名稱，而「哪一支影片」這件事光靠
 * 「宣傳片_final_v3」是分不出來的。選擇器裡看得到縮圖、預覽與資料夾。
 */
function AssetField({
	label,
	kind,
	assets,
	value,
	onChange,
	emptyHint
}: {
	label: string;
	kind: MediaKind;
	assets: MediaAsset[];
	value: string;
	onChange: (assetId: string) => void;
	emptyHint: string;
}) {
	const [open, setOpen] = useState(false);
	const current = assets.find(asset => asset.id === value) ?? null;

	return (
		<div className="huan-stack huan-stack--sm">
			<span className="huan-muted">{label}</span>
			<div className="huan-asset-field">
				<span className="huan-asset-field__thumb">{current?.thumbnailUrl ? <img src={current.thumbnailUrl} alt="" loading="lazy" /> : <ImagesSquareIcon weight="bold" aria-hidden="true" />}</span>
				<span className="huan-asset-field__text huan-truncate">{current ? current.name : "素材已不存在"}</span>
				<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
					換一個
				</Button>
			</div>
			<span className="huan-caption">{emptyHint}</span>
			<AssetPicker open={open} onOpenChange={setOpen} title={label} kinds={[kind]} initialSelectedIds={value ? [value] : []} onConfirm={picked => picked[0] && onChange(picked[0].id)} />
		</div>
	);
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
 * 只收圖片與影片，順序就是播放順序。停留秒數是整份清單共用的一個數字：實際在排播的
 * 人幾乎都讓每一則停一樣久，逐則設定只是把「改成 10 秒」變成要點很多次。影片不受它
 * 影響，一律播完整段才換。
 */
function PlaylistForm({ content, assets, onChange }: { content: PlaylistContent; assets: MediaAsset[]; onChange: (next: SlotContent) => void }) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const nameOf = new Map(assets.map(asset => [asset.id, asset.name]));
	const thumbOf = new Map(assets.map(asset => [asset.id, asset.thumbnailUrl]));

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

	/** 已經在清單裡的素材不重複加入：同一則連播兩次是輸入錯誤，不是需求。 */
	const addMany = (picked: readonly MediaAsset[]): void => {
		const existing = new Set(content.items.map(item => item.assetId));
		const additions = picked
			.filter(asset => !existing.has(asset.id))
			.map(playlistItemForAsset)
			.filter((item): item is PlaylistItem => item !== null);
		if (additions.length > 0) setItems([...content.items, ...additions]);
	};

	return (
		<div className="huan-stack">
			<ol className="huan-playlist">
				{content.items.map((item, index) => (
					<li key={`${item.assetId}-${index}`} className="huan-playlist__item">
						<span className="huan-playlist__index huan-numeric">{index + 1}</span>
						<span className="huan-playlist__thumb">
							{thumbOf.get(item.assetId) ? <img src={thumbOf.get(item.assetId) ?? ""} alt="" loading="lazy" /> : <ImagesSquareIcon weight="bold" aria-hidden="true" />}
						</span>
						<span className="huan-playlist__body">
							<span className="huan-row huan-row--tight">
								<Badge variant="neutral" size="sm">
									{item.kind === "video" ? "影片" : "圖片"}
								</Badge>
								<span className="huan-truncate">{nameOf.get(item.assetId) ?? "素材已不存在"}</span>
							</span>
							<span className="huan-caption">{item.kind === "video" ? "播完整段才換" : `停留 ${Math.round(content.imageDurationMs / 1000)} 秒`}</span>
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

			<Button size="sm" variant="secondary" startIcon={<PlusIcon weight="bold" />} onClick={() => setPickerOpen(true)}>
				加入素材
			</Button>

			<NumberField
				label="每張圖片停留秒數"
				min={Math.round(PLAYLIST_MIN_IMAGE_DURATION_MS / 1000)}
				max={Math.round(PLAYLIST_MAX_IMAGE_DURATION_MS / 1000)}
				step={1}
				value={Math.round(content.imageDurationMs / 1000)}
				onValueChange={value => {
					if (value === null) return;
					onChange({ ...content, imageDurationMs: value * 1000 });
				}}
				description="整份清單共用這個秒數。影片不受影響，一律播完整段才換下一則。"
			/>

			<Select label="縮放方式" value={content.fit} onValueChange={value => value && onChange({ ...content, fit: value })} options={FIT_OPTIONS} />
			<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} description="素材沒填滿這一塊時，露出來的顏色。" />

			<AssetPicker
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				title="加入輪播素材"
				description="可以一次勾很多個，也可以把整個資料夾一次加進來。順序照勾選的清單排，加完再上下調整。"
				kinds={["image", "video"]}
				multiple
				confirmLabel="加入清單"
				onConfirm={addMany}
			/>
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
				<AssetField label="圖片素材" kind="image" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="只會列出處理完成的圖片。" />
				<Select label="縮放方式" value={content.fit} onValueChange={value => value && onChange({ ...content, fit: value })} options={FIT_OPTIONS} />
				<ColorControl label="背景色" value={content.backgroundColor} onChange={value => onChange({ ...content, backgroundColor: value })} description="圖片沒有填滿這一塊時，露出來的顏色。" />
			</div>
		);
	}

	if (content.type === "video") {
		return (
			<div className="huan-stack">
				<AssetField label="影片素材" kind="video" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="只會列出處理完成的影片。" />
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
			<AssetField label="HTML 素材" kind="html" assets={assets} value={content.assetId} onChange={assetId => onChange({ ...content, assetId })} emptyHint="只會列出處理完成的 HTML 檔案。" />
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
