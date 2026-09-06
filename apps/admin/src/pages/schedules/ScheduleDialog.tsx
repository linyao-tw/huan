import { WEEKDAY_LABELS } from "@/lib/format";
import { buildTimeZoneOptions } from "@/lib/timezones";
import { emptyScheduleForm, isScheduleFormValid, toScheduleRequest, validateScheduleForm, type ScheduleFormValues } from "@/pages/schedules/form";
import { SchedulePrioritySchema, type Device, type LayoutSummary } from "@huan/protocol";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	CalendarDate,
	CheckboxGroup,
	CheckboxItem,
	Combobox,
	DatePicker,
	Dialog,
	EmptyState,
	NumberField,
	Select,
	Switch,
	TextField,
	Time,
	TimeField,
	Toggle,
	ToggleGroup,
	parseDate,
	parseTime
} from "@linyao.tw/ui";
import { useMemo, useState } from "react";

function toCalendarDate(value: string | null): CalendarDate | null {
	if (!value) return null;
	try {
		return parseDate(value);
	} catch {
		return null;
	}
}

function toTime(value: string): Time | null {
	try {
		return parseTime(value);
	} catch {
		return null;
	}
}

function fromTime(value: Time | null, fallback: string): string {
	if (!value) return fallback;
	return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

export interface ScheduleDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	initialValues?: ScheduleFormValues;
	defaultTimeZone: string;
	layouts: readonly LayoutSummary[];
	devices: readonly Device[];
	pending: boolean;
	errorMessage: string | null;
	onSubmit: (values: ScheduleFormValues) => void;
}

export function ScheduleDialog({ open, onOpenChange, title, initialValues, defaultTimeZone, layouts, devices, pending, errorMessage, onSubmit }: ScheduleDialogProps) {
	const [values, setValues] = useState<ScheduleFormValues>(() => initialValues ?? emptyScheduleForm(defaultTimeZone));
	const [submitted, setSubmitted] = useState(false);

	const timeZoneOptions = useMemo(() => buildTimeZoneOptions().map(option => ({ value: option.value, label: option.curated ? `${option.label}（常用）` : option.label })), []);
	const errors = validateScheduleForm(values);
	const showErrors = submitted;

	const patch = (next: Partial<ScheduleFormValues>): void => setValues(current => ({ ...current, ...next }));

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								setSubmitted(true);
								if (!isScheduleFormValid(validateScheduleForm(values))) return;
								onSubmit(values);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>{title}</Dialog.Title>
								<Dialog.Description>排程以指定時區的牆上時間判定，因此夏令時間切換由平台的時區資料庫處理，不需要手動調整。</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									<TextField
										label="排程名稱"
										required
										value={values.name}
										onChange={event => patch({ name: event.target.value })}
										invalid={showErrors && Boolean(errors.name)}
										error={showErrors ? errors.name : undefined}
										disabled={pending}
									/>

									<label className="huan-row huan-row--between">
										<span className="huan-stack huan-stack--sm">
											<span>啟用這個排程</span>
											<span className="huan-caption">停用後仍會保留設定，但不會影響任何裝置。</span>
										</span>
										<Switch checked={values.enabled} onCheckedChange={checked => patch({ enabled: checked })} disabled={pending} />
									</label>

									<Select
										label="播放版面"
										required
										placeholder="選擇一個版面"
										value={values.layoutId}
										onValueChange={value => patch({ layoutId: value })}
										options={layouts.map(layout => ({ value: layout.id, label: layout.publishedRevisionNumber === null ? `${layout.name}（尚未發布）` : layout.name }))}
										invalid={showErrors && Boolean(errors.layoutId)}
										error={showErrors ? errors.layoutId : undefined}
										disabled={pending}
									/>

									<Combobox
										label="時區"
										value={values.timezone}
										onValueChange={value => patch({ timezone: value ?? values.timezone })}
										options={timeZoneOptions}
										placeholder="搜尋 IANA 時區"
										emptyMessage="找不到符合的時區"
										description="以 IANA 時區名稱判定，例如 Asia/Taipei。"
										disabled={pending}
									/>

									<NumberField
										label="優先度"
										min={0}
										max={1000}
										step={10}
										value={values.priority}
										onValueChange={value => patch({ priority: SchedulePrioritySchema.catch(100).parse(value ?? 100) })}
										description="數字大的優先。相同優先度時再比較視窗長度等條件。"
										disabled={pending}
									/>

									<div className="huan-row">
										<DatePicker
											className="huan-grow"
											label="開始日期"
											value={toCalendarDate(values.startDate)}
											onValueChange={value => patch({ startDate: value ? value.toString() : null })}
											description="選填。留白代表沒有起始限制。"
											disabled={pending}
										/>
										<DatePicker
											className="huan-grow"
											label="結束日期"
											value={toCalendarDate(values.endDate)}
											onValueChange={value => patch({ endDate: value ? value.toString() : null })}
											invalid={showErrors && Boolean(errors.endDate)}
											error={showErrors ? errors.endDate : undefined}
											description="選填。展覽或檔期結束後會自動失效。"
										/>
									</div>

									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted" id="schedule-weekdays-label">
											生效星期
										</span>
										<ToggleGroup
											aria-labelledby="schedule-weekdays-label"
											multiple
											value={values.daysOfWeek.map(String)}
											onValueChange={next => patch({ daysOfWeek: next.map(Number).sort((a, b) => a - b) })}
											disabled={pending}
										>
											{WEEKDAY_LABELS.map((label, index) => (
												<Toggle key={label} value={String(index)}>
													{label}
												</Toggle>
											))}
										</ToggleGroup>
										{showErrors && errors.daysOfWeek ? (
											<Alert status="danger" live="polite">
												<AlertDescription>{errors.daysOfWeek}</AlertDescription>
											</Alert>
										) : null}
									</div>

									<div className="huan-row">
										<TimeField
											className="huan-grow"
											label="開始時間"
											hourCycle={24}
											granularity="minute"
											value={toTime(values.startTime)}
											onValueChange={value => patch({ startTime: fromTime(value, values.startTime) })}
										/>
										<TimeField
											className="huan-grow"
											label="結束時間"
											hourCycle={24}
											granularity="minute"
											value={toTime(values.endTime)}
											onValueChange={value => patch({ endTime: fromTime(value, values.endTime) })}
											invalid={showErrors && Boolean(errors.endTime)}
											error={showErrors ? errors.endTime : undefined}
											description="結束時間早於開始時間代表跨午夜，例如 22:00 到 02:00。"
										/>
									</div>

									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">目標裝置</span>
										{devices.length === 0 ? (
											<EmptyState title="還沒有配對任何裝置" description="沒有目標裝置的排程仍可建立，之後配對裝置再回來勾選即可。" />
										) : (
											<CheckboxGroup value={values.deviceIds} onValueChange={next => patch({ deviceIds: next })} aria-label="目標裝置">
												{devices.map(device => (
													<CheckboxItem key={device.id} name={device.id} label={device.name} description={device.online ? "線上" : "離線"} disabled={pending} />
												))}
											</CheckboxGroup>
										)}
									</div>

									{errorMessage ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>儲存失敗</AlertTitle>
											<AlertDescription>{errorMessage}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={pending}>
									儲存排程
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export { toScheduleRequest };
