const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
	if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
	if (bytes < 1) return "0 B";
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
	const value = bytes / 1024 ** exponent;
	const unit = BYTE_UNITS[exponent] ?? "B";
	return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`;
}

export function formatDurationMs(durationMs: number | null | undefined): string {
	if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) return "—";
	const totalSeconds = Math.round(durationMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number): string => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatUptimeSeconds(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days} 天 ${hours} 小時`;
	if (hours > 0) return `${hours} 小時 ${minutes} 分`;
	return `${minutes} 分`;
}

/** 配對碼在畫面上一律以 `XXXX-XXXX` 呈現，比對時則忽略連字號。 */
export function formatPairingCode(code: string): string {
	const compact = code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
	if (compact.length !== 8) return compact;
	return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
