import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/components/QueryState";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useRegenerateRecoveryCodesMutation, useRevokeSessionMutation, useSecurityOverviewQuery, useTotpDisableMutation } from "@/lib/security";
import { useChangePasswordMutation, useCurrentUser } from "@/lib/session";
import { RecoveryCodePanel, TotpSetupDialog } from "@/pages/security/TotpSetupDialog";
import { PasswordSchema } from "@huan/protocol";
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
	const confirmError = confirm.length > 0 && confirm !== next ? "兩次輸入的新密碼不一致" : undefined;
	const canSubmit = current.length > 0 && next.length > 0 && !nextError && !confirmError && confirm === next;

	return (
		<Card variant="material">
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
					<SectionHeading level={2} size="sm" description="密碼至少 12 個字元。HUAN 不強制混合大小寫與符號，因為那通常只會讓人選出更好猜的密碼。">
						變更密碼
					</SectionHeading>

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
						label="再次輸入新密碼"
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
							<AlertTitle>無法變更密碼</AlertTitle>
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
	);
}

type TotpDialog = "setup" | "disable" | "regenerate" | null;

export function SecurityPage() {
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

	const closeDialog = (): void => {
		setDialog(null);
		setPassword("");
		setCode("");
		disable.reset();
		regenerate.reset();
	};

	const totpEnabled = overview.data?.totpEnabled ?? user?.totpEnabled ?? false;

	return (
		<>
			<PageHeader title="安全設定" description="兩階段驗證、登入工作階段與密碼。長期憑證不會存在瀏覽器的 localStorage 裡。" />

			{overview.isError ? <QueryErrorAlert error={overview.error} onRetry={() => void overview.refetch()} retrying={overview.isFetching} title="無法載入安全設定" /> : null}

			<Card variant="material">
				<CardBody>
					<div className="huan-stack">
						<SectionHeading
							level={2}
							size="sm"
							description="啟用後，登入時除了密碼還需要驗證器產生的一次性驗證碼。"
							annotation={
								totpEnabled ? (
									<Badge variant="success">
										<span className="huan-row huan-row--tight">
											<ShieldCheckIcon weight="bold" aria-hidden="true" /> 已啟用
										</span>
									</Badge>
								) : (
									<Badge variant="warning">
										<span className="huan-row huan-row--tight">
											<ShieldWarningIcon weight="bold" aria-hidden="true" /> 未啟用
										</span>
									</Badge>
								)
							}
						>
							兩階段驗證（TOTP）
						</SectionHeading>

						{overview.isPending ? (
							<ListSkeleton rows={2} label="正在載入兩階段驗證狀態" />
						) : totpEnabled ? (
							<div className="huan-stack huan-stack--sm">
								<p className="huan-muted">剩餘可用的復原碼：{overview.data?.recoveryCodesRemaining ?? 0} 組。</p>
								{overview.data && overview.data.recoveryCodesRemaining <= 2 ? (
									<Alert status="warning">
										<AlertTitle>復原碼快用完了</AlertTitle>
										<AlertDescription>復原碼是遺失驗證器時唯一的退路。建議立即重新產生一份並妥善保存。</AlertDescription>
									</Alert>
								) : null}
								<div className="huan-row huan-row--tight">
									<Button variant="secondary" onClick={() => setDialog("regenerate")}>
										重新產生復原碼
									</Button>
									<Button variant="danger" onClick={() => setDialog("disable")}>
										停用兩階段驗證
									</Button>
								</div>
							</div>
						) : (
							<div>
								<Button onClick={() => setDialog("setup")}>啟用兩階段驗證</Button>
							</div>
						)}
					</div>
				</CardBody>
			</Card>

			<Card variant="material">
				<CardBody>
					<div className="huan-stack">
						<SectionHeading level={2} size="sm" description="每一次登入都會建立一個工作階段。發現不認識的裝置時請立即撤銷。">
							登入中的工作階段
						</SectionHeading>

						{overview.isPending ? (
							<ListSkeleton rows={3} label="正在載入工作階段" />
						) : (overview.data?.sessions.length ?? 0) === 0 ? (
							<p className="huan-muted">目前沒有其他工作階段。</p>
						) : (
							<TableFrame>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>裝置與瀏覽器</TableHead>
											<TableHead>IP</TableHead>
											<TableHead>建立時間</TableHead>
											<TableHead>最後活動</TableHead>
											<TableHead>到期時間</TableHead>
											<TableHead textAlign="end">操作</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(overview.data?.sessions ?? []).map(session => (
											<TableRow key={session.id}>
												<TableCell>
													<div className="huan-row huan-row--tight">
														<span className="huan-truncate">{session.userAgent ?? "未知的用戶端"}</span>
														{session.current ? <Badge variant="accent">目前這個</Badge> : null}
													</div>
												</TableCell>
												<TableCell>{session.ipAddress ?? "—"}</TableCell>
												<TableCell>{formatDateTime(session.createdAt)}</TableCell>
												<TableCell>{formatRelativeTime(session.lastSeenAt)}</TableCell>
												<TableCell>{formatDateTime(session.expiresAt)}</TableCell>
												<TableCell textAlign="end">
													<Button
														variant="quiet"
														size="sm"
														disabled={session.current || revoke.isPending}
														onClick={() =>
															revoke.mutate(session.id, {
																onSuccess: () => toast.add({ title: "已撤銷工作階段", data: { status: "success" } }),
																onError: error => toast.add({ title: "撤銷失敗", description: error.message, data: { status: "danger" } })
															})
														}
													>
														{session.current ? "使用中" : "撤銷"}
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</TableFrame>
						)}
					</div>
				</CardBody>
			</Card>

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
													toast.add({ title: "已停用兩階段驗證", data: { status: "warning" } });
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
									<Dialog.Title>{dialog === "disable" ? "停用兩階段驗證" : "重新產生復原碼"}</Dialog.Title>
									<Dialog.Description>{dialog === "disable" ? "停用之後，只要知道密碼就能登入這個帳號。請確認你真的需要這麼做。" : "重新產生會讓舊的復原碼全部失效。"}</Dialog.Description>
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
										<CodeField label="驗證器產生的 6 位數字" length={6} value={code} onValueChange={setCode} autoComplete="one-time-code" disabled={disable.isPending || regenerate.isPending} />
										{disable.isError || regenerate.isError ? (
											<Alert status="danger" live="assertive">
												<AlertTitle>操作失敗</AlertTitle>
												<AlertDescription>{(disable.error ?? regenerate.error)?.message}</AlertDescription>
											</Alert>
										) : null}
									</div>
								</Dialog.Body>

								<Dialog.Footer>
									<Dialog.Close render={<Button variant="secondary">取消</Button>} />
									<Button type="submit" variant={dialog === "disable" ? "danger" : "primary"} loading={disable.isPending || regenerate.isPending} disabled={password.length === 0 || code.length !== 6}>
										{dialog === "disable" ? "停用" : "重新產生"}
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
								<Dialog.Title>新的復原碼</Dialog.Title>
								<Dialog.Description>舊的復原碼已經全部失效。</Dialog.Description>
							</Dialog.Header>
							<Dialog.Body>{newCodes ? <RecoveryCodePanel codes={newCodes} /> : null}</Dialog.Body>
							<Dialog.Footer>
								<Dialog.Close render={<Button>我已經保存好了</Button>} />
							</Dialog.Footer>
						</Dialog.Popup>
					</Dialog.Viewport>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
