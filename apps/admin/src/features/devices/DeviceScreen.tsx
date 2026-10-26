import "@/features/devices/devices.css";
import { useDeviceScreenQuery } from "@/features/devices/hooks";
import { QueryErrorAlert } from "@/shared/components/QueryState";
import type { Device } from "@huan/protocol";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from "@linyao.tw/ui";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { useEffect, useState } from "react";

/** 開始看之後這麼久都沒有畫面，就不再說「等待中」，改說可能的原因。 */
const NO_FRAME_HINT_MS = 10_000;

function useObjectUrl(blob: Blob | undefined): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!blob) {
			setUrl(null);
			return;
		}
		const next = URL.createObjectURL(blob);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [blob]);
	return url;
}

function secondsAgo(iso: string | null, now: number): string {
	if (!iso) return "";
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	return seconds <= 1 ? "剛剛擷取" : `${seconds} 秒前擷取`;
}

/**
 * 裝置畫面的即時截圖，一秒一張。
 *
 * 打開裝置頁就開始看，因為「現在螢幕上到底是什麼」是點進來最常想知道的事；
 * 不想讓裝置持續上傳時可以暫停。離線的裝置不輪詢，反正叫不醒它。
 */
export function DeviceScreenCard({ device }: { device: Device }) {
	const [watching, setWatching] = useState(true);
	const [startedAt, setStartedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const active = watching && device.online;
	const screen = useDeviceScreenQuery(device.id, active);
	const frame = screen.data ?? null;
	const imageUrl = useObjectUrl(frame?.blob);

	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, [active]);

	const start = (): void => {
		setStartedAt(Date.now());
		setNow(Date.now());
		setWatching(true);
	};

	const waitingTooLong = active && !frame && now - startedAt > NO_FRAME_HINT_MS;

	return (
		<Card variant="material">
			<CardHeader>
				<div className="huan-row huan-row--between huan-device-screen__header">
					<CardTitle level={2}>即時畫面</CardTitle>
					{device.online ? (
						watching ? (
							<Button size="sm" variant="secondary" startIcon={<PauseIcon weight="bold" />} onClick={() => setWatching(false)}>
								暫停
							</Button>
						) : (
							<Button size="sm" variant="secondary" startIcon={<PlayIcon weight="bold" />} onClick={start}>
								繼續看
							</Button>
						)
					) : null}
				</div>
			</CardHeader>
			<CardBody>
				<div className="huan-stack">
					{screen.isError ? <QueryErrorAlert error={screen.error} onRetry={() => void screen.refetch()} retrying={screen.isFetching} title="無法取得即時畫面" /> : null}

					{waitingTooLong ? (
						<Alert status="warning">
							<AlertTitle>裝置沒有傳回畫面</AlertTitle>
							<AlertDescription>播放器要 0.1.5 以上的版本才會回傳即時畫面。如果版本夠新，可能是網路不穩，畫面會在連上後自己出現。</AlertDescription>
						</Alert>
					) : null}

					<div className="huan-device-screen" data-paused={!active || undefined}>
						{imageUrl ? <img src={imageUrl} alt={`${device.name} 目前的畫面`} /> : null}
						{!device.online ? (
							<span className="huan-device-screen__overlay">裝置離線，看不到即時畫面</span>
						) : !watching ? (
							<span className="huan-device-screen__overlay">已暫停</span>
						) : !imageUrl && !waitingTooLong ? (
							<span className="huan-device-screen__overlay huan-row huan-row--tight">
								<Spinner size="sm" decorative /> 正在等裝置傳送畫面…
							</span>
						) : null}
					</div>

					<span className="huan-caption">
						{frame ? `${secondsAgo(frame.capturedAt, now)}・大約每秒更新一次，只是確認畫面用，不是錄影。` : "大約每秒更新一次。看的時候裝置才會上傳截圖，離開這一頁就會停止。"}
					</span>
				</div>
			</CardBody>
		</Card>
	);
}
