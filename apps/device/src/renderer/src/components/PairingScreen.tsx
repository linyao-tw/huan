import type { PairingSnapshot } from "@/shared/ipc";
import { formatPairingCode } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Spinner } from "@linyao.tw/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";

interface PairingScreenProps {
	pairing: PairingSnapshot | null;
	serverUrl: string;
	onRetry: () => void;
}

export function PairingScreen({ pairing, serverUrl, onRetry }: PairingScreenProps): React.JSX.Element {
	return (
		<div className="huan-shell">
			<div className="huan-shell__inner">
				<div className="huan-brand">
					<span className="huan-brand__latin">HUAN</span>
					<span className="huan-brand__han">讙</span>
				</div>

				{pairing?.error ? (
					<Alert status="danger" live="polite">
						<AlertTitle>無法取得配對碼</AlertTitle>
						<AlertDescription>{pairing.error}</AlertDescription>
					</Alert>
				) : null}

				{pairing && pairing.code ? (
					<>
						<p className="huan-code">{formatPairingCode(pairing.code)}</p>
						{pairing.qrDataUrl ? <img className="huan-qr" src={pairing.qrDataUrl} alt="配對用 QR Code" /> : null}
						<p>
							請在 HUAN 後台掃描上方 QR Code，或到 <strong>{serverUrl}/pair</strong> 輸入這組配對碼。
						</p>
						<Badge variant="neutral">配對碼 10 分鐘後失效</Badge>
					</>
				) : (
					<>
						<Spinner label="正在取得配對碼" size="lg" />
						<p>正在連線 {serverUrl}…</p>
					</>
				)}

				<Button variant="secondary" startIcon={<ArrowsClockwiseIcon weight="bold" />} onClick={onRetry}>
					重新取得配對碼
				</Button>
			</div>
		</div>
	);
}
