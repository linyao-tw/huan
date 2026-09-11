import { useChangePasswordMutation, useCurrentUser } from "@/features/auth/hooks";
import { useRegenerateRecoveryCodesMutation, useRevokeSessionMutation, useSecurityOverviewQuery, useTotpDisableMutation } from "@/features/security/hooks";
import "@/features/security/security.css";
import { RecoveryCodePanel, TotpSetupDialog } from "@/features/security/TotpSetupDialog";
import { describeUserAgent } from "@/features/security/user-agent";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";
import { formatDate, formatDateTime, formatRelativeTime } from "@/shared/utils/format";
import { PasswordSchema, type SessionSummary } from "@huan/protocol";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	Card,
	CardBody,
	CodeField,
	Dialog,
	PasswordField,
	SectionHeading,
	Table,
	TableBody,
	TableCell,
	TableFrame,
	TableHead,
	TableHeader,
	TableRow,
	useToastManager
} from "@linyao.tw/ui";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { ShieldWarningIcon } from "@phosphor-icons/react/dist/csr/ShieldWarning";
import { useState } from "react";

function ChangePasswordCard() {
	const changePassword = useChangePasswordMutation();
	const toast = useToastManager();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");

	const nextError = next.length > 0 ? (PasswordSchema.safeParse(next).error?.issues[0]?.message ?? undefined) : undefined;
	const confirmError = confirm.length > 0 && confirm !== next ? "兩次輸入的新密碼不一樣" : undefined;
	const canSubmit = current.length > 0 && next.length > 0 && !nextError && !confirmError && confirm === next;

	return (
		<section className="huan-stack" aria-label="換一組密碼">
			<SectionHeading level={2} size="md" description="密碼至少 12 個字。不必混大小寫和符號，那通常只會逼人挑出更短、更好猜的密碼。">
				換一組密碼
			</SectionHeading>

			<Card variant="material" className="huan-password-card">
				<CardBody>
					<form
						className="huan-stack"
						onSubmit={event => {
							event.preventDefault();
							changePassword.mutate(
								{ currentPassword: current, newPassword: next },
								{
									onSuccess: () => {
										toast.add({ title: "密碼已更新", data: { status: "success" } });
										setCurrent("");
										setNext("");
										setConfirm("");
									}
								}
							);
						}}
					>
						<PasswordField label="目前的密碼" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} disabled={changePassword.isPending} />
						<PasswordField
							label="新密碼"
							autoComplete="new-password"
							required
							value={next}
							onChange={event => setNext(event.target.value)}
							invalid={Boolean(nextError)}
							error={nextError}
							disabled={changePassword.isPending}
						/>
						<PasswordField
							label="再輸入一次新密碼"
							autoComplete="new-password"
							required
							value={confirm}
							onChange={event => setConfirm(event.target.value)}
							invalid={Boolean(confirmError)}
							error={confirmError}
							disabled={changePassword.isPending}
						/>

						{changePassword.isError ? (
							<Alert status="danger" live="assertive">
								<AlertTitle>密碼沒有換成功</AlertTitle>
								<AlertDescription>{changePassword.error.message}</AlertDescription>
							</Alert>
						) : null}

						<div>
							<Button type="submit" loading={changePassword.isPending} disabled={!canSubmit}>
								更新密碼
							</Button>
						</div>
					</form>
				</CardBody>
			</Card>
		</section>
	);
}

/** 自己這一個排最前面，其餘依最後使用時間由新到舊 —— 要撤掉的通常是最陌生、最舊的那幾筆。 */
function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
	return [...sessions].sort((a, b) => {
		if (a.current !== b.current) return a.current ? -1 : 1;
		return b.lastSeenAt.localeCompare(a.lastSeenAt);
	});
}

/** 每天在不同瀏覽器登入的人很快就會累積出幾十筆，全部攤開會把這一頁變成四千像素長。 */
const SESSION_PREVIEW_COUNT = 8;

type TotpDialog = "setup" | "disable" | "regenerate" | null;

export function SecurityPage() {
	useDocumentTitle("安全設定");

	const user = useCurrentUser();
	const overview = useSecurityOverviewQuery();
	const disable = useTotpDisableMutation();
	const regenerate = useRegenerateRecoveryCodesMutation();
	const revoke = useRevokeSessionMutation();
	const toast = useToastManager();

	const [dialog, setDialog] = useState<TotpDialog>(null);
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [newCodes, setNewCodes] = useState<string[] | null>(null);
	const [showAllSessions, setShowAllSessions] = useState(false);

	const closeDialog = (): void => {
		setDialog(null);
		setPassword("");
		setCode("");
		disable.reset();
		regenerate.reset();
	};

	const totpEnabled = overview.data?.totpEnabled ?? user?.totpEnabled ?? false;
	const codesLeft = overview.data?.recoveryCodesRemaining ?? 0;
	const sessions = sortSessions(overview.data?.sessions ?? []);
	const visibleSessions = showAllSessions ? sessions : sessions.slice(0, SESSION_PREVIEW_COUNT);

	return (
		<>
			<PageHeader title="安全設定" description="管理這個帳號的密碼、兩步驟驗證，以及正在登入的裝置。" />

			{overview.isError ? <QueryErrorAlert error={overview.error} onRetry={() => void overview.refetch()} retrying={overview.isFetching} title="安全設定載入失敗" /> : null}

			<section className="huan-stack" aria-label="兩步驟驗證">
				<SectionHeading
					level={2}
					size="md"
					description="開啟之後，登入除了密碼，還要輸入驗證器 App 上的 6 位數字。就算密碼外流，別人也進不來。"
					annotation={
						totpEnabled ? (
							<Badge variant="success">
								<span className="huan-row huan-row--tight">
									<ShieldCheckIcon weight="bold" aria-hidden="true" /> 已開啟
								</span>
							</Badge>
						) : (
							<Badge variant="warning">
								<span className="huan-row huan-row--tight">
									<ShieldWarningIcon weight="bold" aria-hidden="true" /> 未開啟
								</span>
							</Badge>
						)
					}
				>
					兩步驟驗證
				</SectionHeading>

				<Card variant="material">
					<CardBody>
						{overview.isPending ? (
							<ListSkeleton rows={2} label="正在讀取兩步驟驗證狀態" />
						) : totpEnabled ? (
							<div className="huan-stack huan-stack--sm">
								<p className="huan-muted">
									備用碼還剩 <span className="huan-numeric">{codesLeft}</span> 組。手機不在身邊時，用備用碼登入。
								</p>
								{codesLeft <= 2 ? (
									<Alert status="warning">
										<AlertTitle>備用碼快用完了</AlertTitle>
										<AlertDescription>手機掉了、換手機了，就只剩備用碼能進來。現在重新產生一份，收在手機以外的地方。</AlertDescription>
									</Alert>
								) : null}
								<div className="huan-row huan-row--tight">
									<Button variant="secondary" onClick={() => setDialog("regenerate")}>
										重新產生備用碼
									</Button>
									<Button variant="danger" onClick={() => setDialog("disable")}>
										關閉兩步驟驗證
									</Button>
								</div>
							</div>
						) : (
							<div className="huan-stack huan-stack--sm">
								<p className="huan-muted">現在只要有密碼就能登入這個帳號。</p>
								<div>
									<Button onClick={() => setDialog("setup")}>開啟兩步驟驗證</Button>
								</div>
							</div>
						)}
					</CardBody>
				</Card>
			</section>

			<section className="huan-stack" aria-label="登入中的裝置">
				<SectionHeading level={2} size="md" description="這些瀏覽器現在可以直接進入後台。看到不認識的，就把它登出。">
					登入中的裝置
				</SectionHeading>

				{overview.isPending ? (
					<ListSkeleton rows={3} label="正在讀取登入中的裝置" />
				) : sessions.length === 0 ? (
					<p className="huan-muted">目前沒有登入中的裝置。</p>
				) : (
					<TableFrame className="huan-session-table">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>裝置</TableHead>
									<TableHead>最後使用</TableHead>
									<TableHead>登入時間</TableHead>
									<TableHead textAlign="end">操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{visibleSessions.map(session => (
									<TableRow key={session.id}>
										<TableCell>
											<div className="huan-session-cell">
												<span className="huan-row huan-row--tight">
													{/* 完整的 User-Agent 留在 title，需要時看得到，但不佔版面。 */}
													<span title={session.userAgent ?? undefined}>{describeUserAgent(session.userAgent)}</span>
													{session.current ? <Badge variant="accent">你正在用的</Badge> : null}
												</span>
												<span className="huan-caption huan-numeric">{session.ipAddress ?? "沒有記錄來源位址"}</span>
											</div>
										</TableCell>
										<TableCell>{formatRelativeTime(session.lastSeenAt)}</TableCell>
										<TableCell>
											<div className="huan-session-cell">
												<span className="huan-numeric">{formatDateTime(session.createdAt)}</span>
												<span className="huan-caption huan-numeric">{formatDate(session.expiresAt)} 自動登出</span>
											</div>
										</TableCell>
										<TableCell textAlign="end">
											<Button
												variant="quiet"
												size="sm"
												disabled={session.current || revoke.isPending}
												onClick={() =>
													revoke.mutate(session.id, {
														onSuccess: () => toast.add({ title: "已登出這台裝置", data: { status: "success" } }),
														onError: error => toast.add({ title: "登出失敗", description: error.message, data: { status: "danger" } })
													})
												}
											>
												{session.current ? "使用中" : "登出"}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableFrame>
				)}

				{sessions.length > SESSION_PREVIEW_COUNT ? (
					<div>
						<Button variant="secondary" size="sm" onClick={() => setShowAllSessions(current => !current)}>
							{showAllSessions ? `只看最近 ${SESSION_PREVIEW_COUNT} 個` : `還有 ${sessions.length - SESSION_PREVIEW_COUNT} 個，全部顯示`}
						</Button>
					</div>
				) : null}
			</section>

			<ChangePasswordCard />

			<TotpSetupDialog open={dialog === "setup"} onOpenChange={open => (open ? setDialog("setup") : closeDialog())} />

			<Dialog.Root open={dialog === "disable" || dialog === "regenerate"} onOpenChange={open => (open ? undefined : closeDialog())}>
				<Dialog.Portal>
					<Dialog.Backdrop />
					<Dialog.Viewport>
						<Dialog.Popup closeButton={false}>
							<form
								onSubmit={event => {
									event.preventDefault();
									if (dialog === "disable") {
										disable.mutate(
											{ password, code },
											{
												onSuccess: () => {
													toast.add({ title: "已關閉兩步驟驗證", data: { status: "warning" } });
													closeDialog();
												}
											}
										);
										return;
									}
									regenerate.mutate({ password, code }, { onSuccess: result => setNewCodes(result.recoveryCodes) });
								}}
							>
								<Dialog.Header>
									<Dialog.Title>{dialog === "disable" ? "關閉兩步驟驗證" : "重新產生備用碼"}</Dialog.Title>
									<Dialog.Description>{dialog === "disable" ? "關閉之後，只要知道密碼就能登入這個帳號。" : "舊的備用碼會立刻失效，之後只能用新的這一份。"}</Dialog.Description>
								</Dialog.Header>

								<Dialog.Body>
									<div className="huan-stack">
										<PasswordField
											label="目前的密碼"
											autoComplete="current-password"
											required
											value={password}
											onChange={event => setPassword(event.target.value)}
											disabled={disable.isPending || regenerate.isPending}
										/>
										<CodeField label="驗證器上的 6 位數字" length={6} value={code} onValueChange={setCode} autoComplete="one-time-code" disabled={disable.isPending || regenerate.isPending} />
										{disable.isError || regenerate.isError ? (
											<Alert status="danger" live="assertive">
												<AlertTitle>沒有完成</AlertTitle>
												<AlertDescription>{(disable.error ?? regenerate.error)?.message}</AlertDescription>
											</Alert>
										) : null}
									</div>
								</Dialog.Body>

								<Dialog.Footer>
									<Dialog.Close render={<Button variant="secondary">取消</Button>} />
									<Button type="submit" variant={dialog === "disable" ? "danger" : "primary"} loading={disable.isPending || regenerate.isPending} disabled={password.length === 0 || code.length !== 6}>
										{dialog === "disable" ? "關閉" : "重新產生"}
									</Button>
								</Dialog.Footer>
							</form>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>

			<Dialog.Root
				open={newCodes !== null}
				onOpenChange={open => {
					if (!open) {
						setNewCodes(null);
						closeDialog();
					}
				}}
			>
				<Dialog.Portal>
					<Dialog.Backdrop />
					<Dialog.Viewport>
						<Dialog.Popup closeButton={false}>
							<Dialog.Header>
								<Dialog.Title>新的備用碼</Dialog.Title>
								<Dialog.Description>舊的備用碼已經失效。</Dialog.Description>
							</Dialog.Header>
							<Dialog.Body>{newCodes ? <RecoveryCodePanel codes={newCodes} /> : null}</Dialog.Body>
							<Dialog.Footer>
								<Dialog.Close render={<Button>我存好了</Button>} />
							</Dialog.Footer>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
