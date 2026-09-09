import { emptyScheduleForm, isScheduleFormValid, toScheduleRequest, validateScheduleForm, type ScheduleFormValues } from "@/features/schedules/form";
import { timeZoneOptionLabel } from "@/features/schedules/timezone-labels";
import { WEEKDAY_LABELS } from "@/shared/utils/format";
import { buildTimeZoneOptions } from "@/shared/utils/timezones";
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

	const timeZoneOptions = useMemo(() => buildTimeZoneOptions().map(option => ({ value: option.value, label: timeZoneOptionLabel(option.value) })), []);
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
								<Dialog.Description>時間以你選的時區為準，不用自己換算時差，日光節約時間也會自動跟著調。</Dialog.Description>
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
											<span className="huan-caption">停用後設定會留著，但不會影響任何裝置。</span>
										</span>
										<Switch checked={values.enabled} onCheckedChange={checked => patch({ enabled: checked })} disabled={pending} />
									</label>

									<Select
										label="播哪一個版面"
										required
										placeholder="挑一個版面"
										value={values.layoutId}
										onValueChange={value => patch({ layoutId: value })}
										options={layouts.map(layout => ({ value: layout.id, label: layout.publishedRevisionNumber === null ? `${layout.name}（還沒發布，不會播）` : layout.name }))}
										invalid={showErrors && Boolean(errors.layoutId)}
										error={showErrors ? errors.layoutId : undefined}
										disabled={pending}
									/>

									<Combobox
										label="時區"
										value={values.timezone}
										onValueChange={value => patch({ timezone: value ?? values.timezone })}
										options={timeZoneOptions}
										placeholder="搜尋城市或時區"
										emptyMessage="找不到這個時區"
										description="排程的時間以這個時區為準。台灣選台北。"
										disabled={pending}
									/>

									<NumberField
										label="優先度"
										min={0}
										max={1000}
										step={10}
										value={values.priority}
										onValueChange={value => patch({ priority: SchedulePrioritySchema.catch(100).parse(value ?? 100) })}
										description="數字大的先播。數字一樣時，時段短的先播。"
										disabled={pending}
									/>

									<div className="huan-row">
										<DatePicker
											className="huan-grow"
											label="開始日期"
											value={toCalendarDate(values.startDate)}
											onValueChange={value => patch({ startDate: value ? value.toString() : null })}
											description="不填就是從今天開始。"
											disabled={pending}
										/>
										<DatePicker
											className="huan-grow"
											label="結束日期"
											value={toCalendarDate(values.endDate)}
											onValueChange={value => patch({ endDate: value ? value.toString() : null })}
											invalid={showErrors && Boolean(errors.endDate)}
											error={showErrors ? errors.endDate : undefined}
											description="不填就是一直有效。檔期結束日填進去，時間到就自動停。"
										/>
									</div>

									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted" id="schedule-weekdays-label">
											哪幾天播
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
											description="結束時間比開始時間早，代表跨過半夜，例如 22:00 到隔天 02:00。"
										/>
									</div>

									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">播給哪些裝置</span>
										{devices.length === 0 ? (
											<EmptyState title="還沒有配對任何裝置" description="現在就建立也可以，但沒有勾裝置的排程不會播。配對好裝置之後再回來勾。" />
										) : (
											<>
												<CheckboxGroup value={values.deviceIds} onValueChange={next => patch({ deviceIds: next })} aria-label="播給哪些裝置">
													{devices.map(device => (
														<CheckboxItem key={device.id} name={device.id} label={device.name} description={device.online ? "線上" : "離線"} disabled={pending} />
													))}
												</CheckboxGroup>
												{/* 空的裝置清單在後端等於「不派給任何人」，不是「派給所有人」。 */}
												<span className="huan-caption">一台都沒勾的話，這個排程不會播。</span>
											</>
										)}
									</div>

									{errorMessage ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>沒有存成功</AlertTitle>
											<AlertDescription>{errorMessage}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={pending}>
									儲存
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
