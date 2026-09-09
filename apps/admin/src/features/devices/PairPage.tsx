import { useSessionQuery } from "@/features/auth/hooks";
import "@/features/devices/devices.css";
import { PlatformLabel } from "@/features/devices/DeviceStatus";
import { useConfirmPairingMutation, usePairingLookupQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { QueryErrorAlert } from "@/shared/components/QueryState";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { isApiError } from "@/shared/services/http";
import { formatDateTime } from "@/shared/utils/format";
import { PairingCodeSchema } from "@huan/protocol";
import { formatPairingCode } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, EmptyState, Loader, Select, TextField } from "@linyao.tw/ui";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, Link as RouterLink, useSearchParams } from "react-router";

export function PairPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const session = useSessionQuery();
	const rawCode = searchParams.get("code");

	const [manualCode, setManualCode] = useState(rawCode ?? "");
	const [deviceName, setDeviceName] = useState("");
	const [defaultLayoutId, setDefaultLayoutId] = useState<string | null>(null);

	const normalized = PairingCodeSchema.safeParse(rawCode ?? "");
	const code = normalized.success ? normalized.data : null;

	const lookup = usePairingLookupQuery(code);
	const layouts = useLayoutListQuery();
	const confirm = useConfirmPairingMutation();

	useEffect(() => {
		if (lookup.data) setDeviceName(current => (current.length > 0 ? current : lookup.data.deviceName));
	}, [lookup.data]);

	if (session.isPending) {
		return (
			<div className="huan-centered">
				<Loader label="正在確認登入狀態" size="lg" />
			</div>
		);
	}

	if (!session.data) {
		const next = `/pair${rawCode ? `?code=${encodeURIComponent(rawCode)}` : ""}`;
		return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
	}

	const submitManualCode = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const parsed = PairingCodeSchema.safeParse(manualCode);
		if (!parsed.success) return;
		setSearchParams({ code: parsed.data });
	};

	const manualParsed = PairingCodeSchema.safeParse(manualCode);

	return (
		<div className="huan-centered">
			<div className="huan-centered__inner huan-centered__inner--wide">
				<h1 className="huan-visually-hidden">裝置配對</h1>
				<div className="huan-row huan-row--between">
					<RouterLink to="/app" className="huan-shell__brand">
						<span className="huan-shell__brand-mark">HUAN</span>
						<span className="huan-shell__brand-han">讙</span>
					</RouterLink>
					<ThemeToggle />
				</div>

				{confirm.isSuccess && confirm.data ? (
					<Card variant="elevated">
						<CardBody>
							<EmptyState
								status="success"
								icon={<CheckCircleIcon weight="bold" />}
								title="配對完成"
								description={`「${confirm.data.name}」已經加進來了，它會自己開始下載要播的內容。`}
								actions={
									<div className="huan-row huan-row--tight">
										<Button render={<RouterLink to={`/app/devices/${confirm.data.id}`} />} nativeButton={false}>
											查看裝置
										</Button>
										<Button
											variant="secondary"
											onClick={() => {
												confirm.reset();
												setManualCode("");
												setDeviceName("");
												setDefaultLayoutId(null);
												setSearchParams({});
											}}
										>
											再加一台
										</Button>
									</div>
								}
							/>
						</CardBody>
					</Card>
				) : !code ? (
					<Card variant="elevated">
						{/*
						 * 卡片標題用 CardTitle。
						 *
						 * SectionHeading 在設計系統裡是列表軌道標籤，自帶背景與縮排，而且字級是
						 * --font-size-xs；app.css 的修正只作用在 .huan-shell 底下，配對頁不在裡面，
						 * 所以那條修正到不了這裡，標題會變成一塊比說明文字還小的灰色面板。
						 */}
						<CardHeader>
							<CardTitle level={2}>輸入配對碼</CardTitle>
							<CardDescription>播放器開機後，螢幕上會顯示一組 8 位數的配對碼，格式是 XXXX-XXXX。</CardDescription>
						</CardHeader>
						<CardBody>
							<form className="huan-stack" onSubmit={submitManualCode} noValidate>
								<TextField
									label="配對碼"
									name="pairingCode"
									technical
									placeholder="XXXX-XXXX"
									value={manualCode}
									onChange={event => setManualCode(event.target.value)}
									invalid={manualCode.length > 0 && !manualParsed.success}
									error={manualCode.length > 0 && !manualParsed.success ? "配對碼是 8 個字元，不包含 0、O、1、I。" : undefined}
								/>
								<Button type="submit" disabled={!manualParsed.success}>
									查詢裝置
								</Button>
							</form>
						</CardBody>
					</Card>
				) : lookup.isPending ? (
					<Card variant="elevated">
						<CardBody>
							<Loader label="正在查詢配對碼" />
						</CardBody>
					</Card>
				) : lookup.isError ? (
					<Card variant="elevated">
						<CardBody>
							<div className="huan-stack">
								{isApiError(lookup.error) && (lookup.error.code === "pairing_expired" || lookup.error.status === 404) ? (
									<EmptyState
										status="warning"
										icon={<PlugsIcon weight="bold" />}
										title="這組配對碼用不了"
										description={`查不到「${formatPairingCode(code)}」對應的裝置。配對碼有時效，請在播放器上重新產生一組，再輸入一次。`}
										actions={
											<Button
												variant="secondary"
												onClick={() => {
													setManualCode("");
													setSearchParams({});
												}}
											>
												重新輸入配對碼
											</Button>
										}
									/>
								) : (
									<QueryErrorAlert error={lookup.error} onRetry={() => void lookup.refetch()} retrying={lookup.isFetching} title="查詢時發生問題" />
								)}
							</div>
						</CardBody>
					</Card>
				) : (
					<Card variant="elevated">
						<CardHeader>
							<CardTitle level={2}>確認裝置</CardTitle>
							<CardDescription>先確認下面這台就是你眼前的螢幕，再繼續。</CardDescription>
						</CardHeader>
						<CardBody>
							<form
								className="huan-stack"
								onSubmit={event => {
									event.preventDefault();
									confirm.mutate({ code, deviceName, defaultLayoutId });
								}}
								noValidate
							>
								<dl className="huan-device-def">
									<dt>配對碼</dt>
									<dd className="huan-device-def__atom huan-numeric">{formatPairingCode(lookup.data.code)}</dd>
									<dt>裝置目前的名稱</dt>
									<dd>{lookup.data.deviceName}</dd>
									<dt>系統</dt>
									<dd>
										<PlatformLabel platform={lookup.data.platform} arch={lookup.data.arch} />
									</dd>
									<dt>播放器版本</dt>
									<dd>{lookup.data.appVersion}</dd>
									<dt>有效到</dt>
									<dd className="huan-device-def__atom huan-numeric">{formatDateTime(lookup.data.expiresAt)}</dd>
								</dl>

								<TextField
									label="裝置名稱"
									name="deviceName"
									required
									value={deviceName}
									onChange={event => setDeviceName(event.target.value)}
									description="填實際位置最好認，例如「一號店櫥窗」。"
									disabled={confirm.isPending}
								/>

								<Select
									label="預設版面"
									placeholder="沒有排程時顯示待命畫面"
									description="沒有排程的時段要播的版面，之後可以再改。"
									disabled={confirm.isPending || layouts.isPending}
									value={defaultLayoutId}
									onValueChange={value => setDefaultLayoutId(value)}
									options={(layouts.data?.items ?? []).map(layout => ({ value: layout.id, label: layout.name }))}
								/>

								{confirm.isError ? (
									<Alert status="danger" live="assertive">
										<AlertTitle>配對失敗</AlertTitle>
										<AlertDescription>{confirm.error.message}</AlertDescription>
									</Alert>
								) : null}

								<Button type="submit" loading={confirm.isPending} disabled={deviceName.trim().length === 0}>
									加入這台裝置
								</Button>
							</form>
						</CardBody>
					</Card>
				)}
			</div>
		</div>
	);
}
