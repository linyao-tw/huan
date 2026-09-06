interface IdleScreenProps {
	message: string;
	detail?: string;
}

/** 沒有排程也沒有預設版面時的待命畫面。刻意保持極簡，看板不該顯示除錯訊息。 */
export function IdleScreen({ message, detail }: IdleScreenProps): React.JSX.Element {
	return (
		<div className="huan-shell">
			<div className="huan-shell__inner">
				<div className="huan-brand">
					<span className="huan-brand__latin">HUAN</span>
					<span className="huan-brand__han">讙</span>
				</div>
				<p>{message}</p>
				{detail ? <p style={{ color: "var(--text-secondary)" }}>{detail}</p> : null}
			</div>
		</div>
	);
}
