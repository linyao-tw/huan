import type { ApiError } from "@/lib/api";
import { Alert, AlertActions, AlertDescription, AlertTitle, Button, Skeleton } from "@linyao.tw/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";

export function QueryErrorAlert({ error, onRetry, retrying, title = "載入失敗" }: { error: ApiError | Error | null; onRetry: () => void; retrying?: boolean; title?: string }) {
	return (
		<Alert status="danger" live="polite">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{error?.message ?? "發生未預期的錯誤，請稍後再試。"}</AlertDescription>
			<AlertActions>
				<Button variant="secondary" size="sm" onClick={onRetry} loading={retrying} startIcon={<ArrowClockwiseIcon weight="bold" />}>
					重試
				</Button>
			</AlertActions>
		</Alert>
	);
}

/** 骨架的長度刻意固定，避免每次載入都跳出不同高度造成版面彈跳。 */
export function ListSkeleton({ rows = 4, label = "載入中" }: { rows?: number; label?: string }) {
	return (
		<div className="huan-stack" aria-busy="true" aria-live="polite">
			<span className="huan-visually-hidden">{label}</span>
			{Array.from({ length: rows }, (_value, index) => (
				<Skeleton key={index} shape="rectangular" style={{ blockSize: "var(--control-height-lg)" }} />
			))}
		</div>
	);
}

export function CardsSkeleton({ cards = 4, label = "載入中" }: { cards?: number; label?: string }) {
	return (
		<div className="huan-card-grid" aria-busy="true" aria-live="polite">
			<span className="huan-visually-hidden">{label}</span>
			{Array.from({ length: cards }, (_value, index) => (
				<Skeleton key={index} shape="rectangular" style={{ blockSize: "var(--space-24)" }} />
			))}
		</div>
	);
}
