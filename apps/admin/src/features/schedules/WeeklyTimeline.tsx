import { buildTimelineBlocks } from "@/features/schedules/form";
import "@/features/schedules/schedules.css";
import { WEEKDAY_LABELS } from "@/shared/utils/format";
import type { Schedule } from "@huan/protocol";
import { useMemo } from "react";

/** 刻度與分隔線用同一組數字，畫面上永遠對得齊。0 點就是格子的上緣，不需要再畫一條線。 */
const HOUR_MARKS = [0, 6, 12, 18] as const;

function topPercent(hour: number): string {
	return `${(hour / 24) * 100}%`;
}

export function WeeklyTimeline({ schedules }: { schedules: readonly Schedule[] }) {
	const blocks = useMemo(() => buildTimelineBlocks(schedules), [schedules]);

	return (
		<div className="huan-scroll-x">
			<div className="huan-week" role="img" aria-label="一週的播放時段預覽，方塊重疊代表同一時間有多個排程">
				<span className="huan-week__label" aria-hidden="true">
					時間
				</span>
				{WEEKDAY_LABELS.map(label => (
					<span key={label} className="huan-week__label" aria-hidden="true">
						{label}
					</span>
				))}

				<div className="huan-week__axis" aria-hidden="true">
					{HOUR_MARKS.map(hour => (
						<span key={hour} className="huan-week__axis-mark" style={{ top: topPercent(hour) }}>
							{String(hour).padStart(2, "0")}:00
						</span>
					))}
				</div>
				{WEEKDAY_LABELS.map((label, weekday) => (
					<div key={label} className="huan-week__column">
						{HOUR_MARKS.filter(hour => hour > 0).map(hour => (
							<span key={hour} className="huan-week__hour" style={{ top: topPercent(hour) }} aria-hidden="true" />
						))}
						{blocks
							.filter(block => block.weekday === weekday)
							.map((block, index) => (
								<span
									key={`${block.scheduleId}-${index}`}
									className="huan-week__block"
									style={{ top: `${block.start * 100}%`, height: `${Math.max(0.02, block.end - block.start) * 100}%` }}
									title={`${block.name}${block.continuation ? "（前一天延續過來的）" : ""}`}
								>
									{block.continuation ? "" : block.name}
								</span>
							))}
					</div>
				))}
			</div>
		</div>
	);
}
