import { buildTimelineBlocks } from "@/features/schedules/form";
import "@/features/schedules/schedules.css";
import { WEEKDAY_LABELS } from "@/shared/utils/format";
import type { Schedule } from "@huan/protocol";
import { useMemo } from "react";

const HOUR_MARKS = [6, 12, 18];

export function WeeklyTimeline({ schedules }: { schedules: readonly Schedule[] }) {
	const blocks = useMemo(() => buildTimelineBlocks(schedules), [schedules]);

	return (
		<div className="huan-scroll-x">
			<div className="huan-week" role="img" aria-label="一週排程時段預覽，重疊的方塊代表同時生效的排程">
				<span className="huan-week__label" aria-hidden="true">
					時段
				</span>
				{WEEKDAY_LABELS.map(label => (
					<span key={label} className="huan-week__label" aria-hidden="true">
						{label}
					</span>
				))}

				<span className="huan-week__label huan-caption" aria-hidden="true">
					00–24
				</span>
				{WEEKDAY_LABELS.map((label, weekday) => (
					<div key={label} className="huan-week__column">
						{HOUR_MARKS.map(hour => (
							<span key={hour} className="huan-week__hour" style={{ top: `${(hour / 24) * 100}%` }} aria-hidden="true" />
						))}
						{blocks
							.filter(block => block.weekday === weekday)
							.map((block, index) => (
								<span
									key={`${block.scheduleId}-${index}`}
									className="huan-week__block"
									style={{ top: `${block.start * 100}%`, height: `${Math.max(0.02, block.end - block.start) * 100}%` }}
									title={`${block.name}${block.continuation ? "（前一天延續）" : ""}`}
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
