import { useDeviceListQuery } from "@/features/devices/hooks";
import { useCreateLayoutMutation } from "@/features/layouts/hooks";
import { LAYOUT_MAX_CANVAS, LAYOUT_MIN_CANVAS, type Canvas } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, Dialog, NumberField, RadioGroup, RadioItem, Select, TextField, TextView } from "@linyao.tw/ui";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

interface Preset {
	id: string;
	label: string;
	canvas: Canvas;
}

export const CANVAS_PRESETS: Preset[] = [
	{ id: "fhd-landscape", label: "1920 × 1080（Full HD 橫向）", canvas: { width: 1920, height: 1080 } },
	{ id: "fhd-portrait", label: "1080 × 1920（Full HD 直向）", canvas: { width: 1080, height: 1920 } },
	{ id: "uhd-landscape", label: "3840 × 2160（4K 橫向）", canvas: { width: 3840, height: 2160 } },
	{ id: "hd-landscape", label: "1280 × 720（HD 橫向）", canvas: { width: 1280, height: 720 } }
];

type SizeSource = "preset" | "device" | "custom";

export function CreateLayoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const navigate = useNavigate();
	const devices = useDeviceListQuery();
	const create = useCreateLayoutMutation();

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [source, setSource] = useState<SizeSource>("preset");
	const [presetId, setPresetId] = useState(CANVAS_PRESETS[0]?.id ?? "fhd-landscape");
	const [displayKey, setDisplayKey] = useState<string | null>(null);
	const [customWidth, setCustomWidth] = useState(1920);
	const [customHeight, setCustomHeight] = useState(1080);

	/** 已配對裝置回報的實際解析度。取不到 reported 的裝置不會出現在這裡，因為那只是猜測。 */
	const displayOptions = useMemo(() => {
		const seen = new Map<string, { value: string; label: string; canvas: Canvas }>();
		for (const device of devices.data?.items ?? []) {
			for (const display of device.reported?.displays ?? []) {
				const key = `${display.width}x${display.height}`;
				if (seen.has(key)) continue;
				seen.set(key, {
					value: key,
					label: `${display.width} × ${display.height} — ${device.name}${display.primary ? "（主要顯示器）" : ""}`,
					canvas: { width: display.width, height: display.height }
				});
			}
		}
		return [...seen.values()];
	}, [devices.data]);

	const canvas: Canvas = useMemo(() => {
		if (source === "preset") return CANVAS_PRESETS.find(preset => preset.id === presetId)?.canvas ?? { width: 1920, height: 1080 };
		if (source === "device") return displayOptions.find(option => option.value === displayKey)?.canvas ?? { width: 1920, height: 1080 };
		return { width: customWidth, height: customHeight };
	}, [source, presetId, displayKey, displayOptions, customWidth, customHeight]);

	const sizeValid = canvas.width >= LAYOUT_MIN_CANVAS && canvas.width <= LAYOUT_MAX_CANVAS && canvas.height >= LAYOUT_MIN_CANVAS && canvas.height <= LAYOUT_MAX_CANVAS;
	const canSubmit = name.trim().length > 0 && sizeValid && (source !== "device" || displayKey !== null);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								create.mutate(
									{ name: name.trim(), description: description.trim().length > 0 ? description.trim() : null, canvas },
									{ onSuccess: layout => void navigate(`/app/layouts/${layout.id}`) }
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>建立版面</Dialog.Title>
								<Dialog.Description>畫布尺寸決定設計座標系。實機播放時會等比縮放並置中，長寬比不同的部分以版面背景色填滿。</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									<TextField label="版面名稱" required value={name} onChange={event => setName(event.target.value)} disabled={create.isPending} />
									<TextView label="說明" rows={2} value={description} onChange={event => setDescription(event.target.value)} disabled={create.isPending} description="選填，方便日後辨識用途。" />

									<RadioGroup value={source} onValueChange={value => setSource(value as SizeSource)} aria-label="畫布尺寸來源">
										<div className="huan-stack huan-stack--sm">
											<RadioItem value="preset" label="使用常見尺寸" />
											<RadioItem
												value="device"
												label="使用裝置解析度"
												description={displayOptions.length === 0 ? "目前沒有任何已配對裝置回報顯示器資訊。" : "從已配對裝置實際回報的顯示器解析度中挑一個。"}
												disabled={displayOptions.length === 0}
											/>
											<RadioItem value="custom" label="自訂尺寸" />
										</div>
									</RadioGroup>

									{source === "preset" ? (
										<Select
											label="常見尺寸"
											value={presetId}
											onValueChange={value => setPresetId(value ?? presetId)}
											options={CANVAS_PRESETS.map(preset => ({ value: preset.id, label: preset.label }))}
										/>
									) : null}

									{source === "device" ? (
										<Select
											label="裝置解析度"
											placeholder="選擇一台裝置的顯示器"
											value={displayKey}
											onValueChange={value => setDisplayKey(value)}
											options={displayOptions.map(option => ({ value: option.value, label: option.label }))}
										/>
									) : null}

									{source === "custom" ? (
										<div className="huan-row">
											<NumberField
												className="huan-grow"
												label="寬（px）"
												min={LAYOUT_MIN_CANVAS}
												max={LAYOUT_MAX_CANVAS}
												step={2}
												value={customWidth}
												onValueChange={value => setCustomWidth(value ?? customWidth)}
											/>
											<NumberField
												className="huan-grow"
												label="高（px）"
												min={LAYOUT_MIN_CANVAS}
												max={LAYOUT_MAX_CANVAS}
												step={2}
												value={customHeight}
												onValueChange={value => setCustomHeight(value ?? customHeight)}
											/>
										</div>
									) : null}

									<p className="huan-caption huan-numeric">
										目前畫布：{canvas.width} × {canvas.height}
									</p>

									{!sizeValid ? (
										<Alert status="warning">
											<AlertTitle>尺寸超出範圍</AlertTitle>
											<AlertDescription>
												寬與高都必須介於 {LAYOUT_MIN_CANVAS} 與 {LAYOUT_MAX_CANVAS} 之間。
											</AlertDescription>
										</Alert>
									) : null}

									{create.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>建立失敗</AlertTitle>
											<AlertDescription>{create.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={create.isPending} disabled={!canSubmit}>
									建立並開始編輯
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
