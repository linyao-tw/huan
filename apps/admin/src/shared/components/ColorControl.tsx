import { ColorSchema } from "@huan/protocol";
import { TextField } from "@linyao.tw/ui";
import { useEffect, useId, useState } from "react";

function expandShortHex(hex: string): string {
	return `#${hex
		.slice(1)
		.split("")
		.map(character => `${character}${character}`)
		.join("")}`;
}

function rgbToHex(value: string): string | null {
	const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(value);
	if (!match) return null;
	const channels = match.slice(1, 4).map(channel => Math.min(255, Number(channel)));
	return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** 原生色票只認得 `#RRGGBB`，因此其它合法寫法要先降階，透明度另外保留。 */
export function toPickerValue(value: string): string {
	if (/^#[0-9a-fA-F]{3}$/.test(value)) return expandShortHex(value).toLowerCase();
	if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
	if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7).toLowerCase();
	return rgbToHex(value) ?? "#000000";
}

/** 換顏色不應該把「這一塊是透明的」一起換掉，所以原本的 alpha 要跟著搬過去。 */
export function withPickerValue(previous: string, picked: string): string {
	if (/^#[0-9a-fA-F]{8}$/.test(previous)) return `${picked}${previous.slice(7)}`.toLowerCase();
	return picked.toLowerCase();
}

export function isValidColor(value: string): boolean {
	return ColorSchema.safeParse(value).success;
}

export interface ColorControlProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	description?: string;
	disabled?: boolean;
}

export function ColorControl({ label, value, onChange, description, disabled }: ColorControlProps) {
	const pickerId = useId();
	const [draft, setDraft] = useState(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	const valid = isValidColor(draft);

	return (
		<div className="huan-color-control">
			<div className="huan-color-control__row">
				<input
					id={pickerId}
					type="color"
					className="huan-color-swatch"
					aria-label={`${label}（色票）`}
					value={toPickerValue(draft)}
					disabled={disabled}
					onChange={event => {
						const next = withPickerValue(draft, event.target.value);
						setDraft(next);
						onChange(next);
					}}
				/>
				<TextField
					className="huan-grow"
					label={label}
					size="sm"
					technical
					value={draft}
					disabled={disabled}
					description={description}
					invalid={!valid}
					error={valid ? undefined : "請輸入 #RGB、#RRGGBB、#RRGGBBAA 或 rgb() 格式"}
					onChange={event => {
						const next = event.target.value;
						setDraft(next);
						if (isValidColor(next)) onChange(next);
					}}
				/>
			</div>
		</div>
	);
}
