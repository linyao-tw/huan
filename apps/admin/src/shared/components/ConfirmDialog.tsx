import { Alert, AlertDescription, AlertDialog, AlertTitle, Button } from "@linyao.tw/ui";
import type { ReactNode } from "react";

export interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description: ReactNode;
	children?: ReactNode;
	confirmLabel: string;
	cancelLabel?: string;
	destructive?: boolean;
	pending?: boolean;
	errorMessage?: string | null;
	confirmDisabled?: boolean;
	onConfirm: () => void;
}

/**
 * 破壞性操作一律走這個對話框。
 *
 * `window.confirm` 不但無法在地化、無法排版，也無法解釋「這個裝置正在被三個排程使用」，
 * 而那正是使用者按下按鈕前最需要看到的資訊。
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	confirmLabel,
	cancelLabel = "取消",
	destructive = false,
	pending = false,
	errorMessage = null,
	confirmDisabled = false,
	onConfirm
}: ConfirmDialogProps) {
	return (
		<AlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop />
				<AlertDialog.Viewport>
					<AlertDialog.Popup>
						<AlertDialog.Header>
							<AlertDialog.Title>{title}</AlertDialog.Title>
							<AlertDialog.Description>{description}</AlertDialog.Description>
						</AlertDialog.Header>
						{children || errorMessage ? (
							<AlertDialog.Body>
								<div className="huan-stack">
									{children}
									{errorMessage ? (
										<Alert status="danger" live="polite">
											<AlertTitle>操作失敗</AlertTitle>
											<AlertDescription>{errorMessage}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</AlertDialog.Body>
						) : null}
						<AlertDialog.Actions>
							<AlertDialog.Close render={<Button variant="secondary">{cancelLabel}</Button>} />
							<Button variant={destructive ? "danger" : "primary"} loading={pending} disabled={confirmDisabled} onClick={onConfirm}>
								{confirmLabel}
							</Button>
						</AlertDialog.Actions>
					</AlertDialog.Popup>
				</AlertDialog.Viewport>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
