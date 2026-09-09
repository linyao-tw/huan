import { useSessionQuery } from "@/features/auth/hooks";
import { PlatformLabel } from "@/features/devices/DeviceStatus";
import { useConfirmPairingMutation, usePairingLookupQuery } from "@/features/devices/hooks";
import { useLayoutListQuery } from "@/features/layouts/hooks";
import { QueryErrorAlert } from "@/shared/components/QueryState";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { isApiError } from "@/shared/services/http";
import { formatDateTime } from "@/shared/utils/format";
import { PairingCodeSchema } from "@huan/protocol";
import { formatPairingCode } from "@huan/shared";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardBody, EmptyState, Loader, SectionHeading, Select, TextField } from "@linyao.tw/ui";
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
								description={`「${confirm.data.name}」已經綁定到這個工作區，裝置會在下一次同步時取得內容。`}
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
											再配對一台
										</Button>
									</div>
								}
							/>
						</CardBody>
					</Card>
				) : !code ? (
					<Card variant="elevated">
						<CardBody>
							<form className="huan-stack" onSubmit={submitManualCode} noValidate>
								<SectionHeading level={2} size="md" description="播放器啟動後會在畫面上顯示 8 碼配對碼，格式為 XXXX-XXXX。">
									輸入配對碼
								</SectionHeading>
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
										title="配對碼無效或已過期"
										description={`「${formatPairingCode(code)}」查不到對應的裝置。配對碼有時效，請在播放器上重新產生一組，再輸入一次。`}
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
									<QueryErrorAlert error={lookup.error} onRetry={() => void lookup.refetch()} retrying={lookup.isFetching} title="查詢配對碼失敗" />
								)}
							</div>
						</CardBody>
					</Card>
				) : (
					<Card variant="elevated">
						<CardBody>
							<form
								className="huan-stack"
								onSubmit={event => {
									event.preventDefault();
									confirm.mutate({ code, deviceName, defaultLayoutId });
								}}
								noValidate
							>
								<SectionHeading level={2} size="md" description="請先確認畫面上顯示的裝置就是你眼前這一台，再完成綁定。">
									確認裝置
								</SectionHeading>

								<dl className="huan-definition">
									<dt>配對碼</dt>
									<dd className="huan-numeric">{formatPairingCode(lookup.data.code)}</dd>
									<dt>裝置回報名稱</dt>
									<dd>{lookup.data.deviceName}</dd>
									<dt>平台</dt>
									<dd>
										<PlatformLabel platform={lookup.data.platform} arch={lookup.data.arch} />
									</dd>
									<dt>播放器版本</dt>
									<dd>{lookup.data.appVersion}</dd>
									<dt>配對碼有效至</dt>
									<dd>{formatDateTime(lookup.data.expiresAt)}</dd>
								</dl>

								<TextField
									label="裝置名稱"
									name="deviceName"
									required
									value={deviceName}
									onChange={event => setDeviceName(event.target.value)}
									description="建議填寫實際位置，例如「一號店櫥窗」。"
									disabled={confirm.isPending}
								/>

								<Select
									label="預設版面"
									placeholder="沒有排程命中時顯示待命畫面"
									description="沒有任何排程生效時要播放的版面，之後可以再修改。"
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
									完成配對
								</Button>
							</form>
						</CardBody>
					</Card>
				)}
			</div>
		</div>
	);
}
