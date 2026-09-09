import { useTotpActivateMutation, useTotpSetupMutation } from "@/features/security/hooks";
import { Alert, AlertDescription, AlertTitle, Button, CodeField, Dialog, PasswordField, useToastManager } from "@linyao.tw/ui";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useState } from "react";

type Step = "password" | "verify" | "codes";

/** 備用碼只會出現這一次，因此下載與複製都必須在同一個畫面上提供。 */
export function downloadRecoveryCodes(codes: readonly string[]): void {
	const blob = new Blob([`HUAN 讙 兩步驟驗證備用碼\n產生時間：${new Date().toISOString()}\n\n${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "huan-recovery-codes.txt";
	anchor.click();
	URL.revokeObjectURL(url);
}

export function RecoveryCodePanel({ codes }: { codes: readonly string[] }) {
	const toast = useToastManager();
	return (
		<div className="huan-stack">
			<Alert status="warning">
				<AlertTitle>這些備用碼只會出現這一次</AlertTitle>
				<AlertDescription>關掉這個視窗就再也看不到，我們這邊也查不回來。現在複製或下載，收在手機以外的地方。每一組只能用一次。</AlertDescription>
			</Alert>

			<ul className="huan-recovery-grid">
				{codes.map(code => (
					<li key={code}>{code}</li>
				))}
			</ul>

			<div className="huan-row huan-row--tight">
				<Button
					variant="secondary"
					size="sm"
					startIcon={<CopyIcon weight="bold" />}
					onClick={() => {
						void navigator.clipboard
							.writeText(codes.join("\n"))
							.then(() => toast.add({ title: "已複製備用碼", data: { status: "success" } }))
							.catch(() => toast.add({ title: "複製失敗", description: "瀏覽器不讓網頁用剪貼簿，請自己選取後複製。", data: { status: "danger" } }));
					}}
				>
					複製
				</Button>
				<Button variant="secondary" size="sm" startIcon={<DownloadSimpleIcon weight="bold" />} onClick={() => downloadRecoveryCodes(codes)}>
					下載為文字檔
				</Button>
			</div>
		</div>
	);
}

export function TotpSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const setup = useTotpSetupMutation();
	const activate = useTotpActivateMutation();
	const [step, setStep] = useState<Step>("password");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [codes, setCodes] = useState<string[]>([]);

	const reset = (): void => {
		setStep("password");
		setPassword("");
		setCode("");
		setCodes([]);
		setup.reset();
		activate.reset();
	};

	return (
		<Dialog.Root
			open={open}
			onOpenChange={next => {
				onOpenChange(next);
				if (!next) reset();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<Dialog.Header>
							<Dialog.Title>開啟兩步驟驗證</Dialog.Title>
							<Dialog.Description>
								{step === "password" ? "先輸入目前的密碼，確認是本人在操作。" : step === "verify" ? "用手機上的驗證器 App 掃描這個 QR code，再輸入它顯示的 6 位數字。" : "最後一步：把備用碼存起來。"}
							</Dialog.Description>
						</Dialog.Header>

						<Dialog.Body>
							{step === "password" ? (
								<form
									id="totp-password-form"
									className="huan-stack"
									onSubmit={event => {
										event.preventDefault();
										setup.mutate({ password }, { onSuccess: () => setStep("verify") });
									}}
								>
									<PasswordField label="目前的密碼" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={setup.isPending} />
									{setup.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>沒辦法開始設定</AlertTitle>
											<AlertDescription>{setup.error.message}</AlertDescription>
										</Alert>
									) : null}
								</form>
							) : null}

							{step === "verify" && setup.data ? (
								<form
									id="totp-verify-form"
									className="huan-stack"
									onSubmit={event => {
										event.preventDefault();
										activate.mutate(
											{ code },
											{
												onSuccess: result => {
													setCodes(result.recoveryCodes);
													setStep("codes");
												}
											}
										);
									}}
								>
									<img className="huan-qr" src={setup.data.qrCodeDataUrl} alt="兩步驟驗證的 QR code" />
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">不能掃描的話，在驗證器 App 裡手動輸入這一串：</span>
										<code className="huan-code-block">{setup.data.secret}</code>
									</div>
									<CodeField label="驗證器上的 6 位數字" length={6} value={code} onValueChange={setCode} autoComplete="one-time-code" disabled={activate.isPending} />
									{activate.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>數字不對</AlertTitle>
											<AlertDescription>{activate.error.message}</AlertDescription>
										</Alert>
									) : null}
								</form>
							) : null}

							{step === "codes" ? <RecoveryCodePanel codes={codes} /> : null}
						</Dialog.Body>

						<Dialog.Footer>
							{step === "codes" ? (
								<Dialog.Close render={<Button>我存好了</Button>} />
							) : (
								<>
									<Dialog.Close render={<Button variant="secondary">取消</Button>} />
									{step === "password" ? (
										<Button type="submit" form="totp-password-form" loading={setup.isPending} disabled={password.length === 0}>
											下一步
										</Button>
									) : (
										<Button type="submit" form="totp-verify-form" loading={activate.isPending} disabled={code.length !== 6}>
											開啟
										</Button>
									)}
								</>
							)}
						</Dialog.Footer>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
