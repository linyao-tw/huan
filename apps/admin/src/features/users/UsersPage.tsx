import { useCurrentUser } from "@/features/auth/hooks";
import { useCreateUserMutation, useResetUserPasswordMutation, useUpdateUserMutation, useUserListQuery } from "@/features/users/hooks";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { formatDateTime, formatRelativeTime } from "@/shared/utils/format";
import { EmailSchema, PasswordSchema, UsernameSchema, type User, type UserRole } from "@huan/protocol";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	Dialog,
	EmptyState,
	PasswordField,
	SegmentedControl,
	SegmentedControlItem,
	Select,
	Table,
	TableBody,
	TableCell,
	TableFrame,
	TableHead,
	TableHeader,
	TableRow,
	TextField,
	useToastManager
} from "@linyao.tw/ui";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
	{ value: "user", label: "user（一般使用者）" },
	{ value: "super_admin", label: "super_admin（可管理使用者）" }
];

const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 產生的密碼用 crypto 取亂數，並排除易混淆的字元，方便口頭或紙本轉交。 */
export function generatePassword(length = 20): string {
	const values = new Uint32Array(length);
	crypto.getRandomValues(values);
	return Array.from(values, value => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length] ?? "x").join("");
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const create = useCreateUserMutation();
	const toast = useToastManager();
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState(() => generatePassword());
	const [role, setRole] = useState<UserRole>("user");

	const emailError = email.length > 0 ? (EmailSchema.safeParse(email).error?.issues[0]?.message ?? undefined) : undefined;
	const usernameError = username.length > 0 ? (UsernameSchema.safeParse(username).error?.issues[0]?.message ?? undefined) : undefined;
	const passwordError = password.length > 0 ? (PasswordSchema.safeParse(password).error?.issues[0]?.message ?? undefined) : undefined;
	const canSubmit = email.length > 0 && !emailError && username.length > 0 && !usernameError && displayName.trim().length > 0 && password.length > 0 && !passwordError;

	return (
		<Dialog.Root
			open={open}
			onOpenChange={next => {
				onOpenChange(next);
				if (!next) create.reset();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								create.mutate(
									{ email, username, displayName: displayName.trim(), password, role },
									{
										onSuccess: user => {
											toast.add({ title: `已建立使用者 ${user.username}`, description: "請把初始密碼安全地交給對方，並提醒他登入後立即更換。", data: { status: "success" } });
											onOpenChange(false);
											setEmail("");
											setUsername("");
											setDisplayName("");
											setPassword(generatePassword());
											setRole("user");
										}
									}
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>建立使用者</Dialog.Title>
								<Dialog.Description>HUAN 不開放自助註冊，所有帳號都由 super_admin 建立。</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									<TextField
										label="Email"
										type="email"
										required
										autoComplete="off"
										value={email}
										onChange={event => setEmail(event.target.value)}
										invalid={Boolean(emailError)}
										error={emailError}
										disabled={create.isPending}
									/>
									<TextField
										label="帳號"
										required
										autoComplete="off"
										value={username}
										onChange={event => setUsername(event.target.value)}
										invalid={Boolean(usernameError)}
										error={usernameError}
										description="只能使用小寫英數字與 . _ -，3 到 32 個字元。"
										disabled={create.isPending}
									/>
									<TextField label="顯示名稱" required value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={create.isPending} />
									<PasswordField
										label="初始密碼"
										autoComplete="new-password"
										required
										value={password}
										onChange={event => setPassword(event.target.value)}
										invalid={Boolean(passwordError)}
										error={passwordError}
										description="至少 12 個字元。系統已先產生一組，也可以自行輸入。"
										disabled={create.isPending}
									/>
									<Button variant="quiet" size="sm" onClick={() => setPassword(generatePassword())} disabled={create.isPending}>
										重新產生密碼
									</Button>
									<Select
										label="角色"
										value={role}
										onValueChange={value => setRole(value ?? "user")}
										options={ROLE_OPTIONS}
										description="super_admin 可以管理使用者與檢視稽核紀錄。"
										disabled={create.isPending}
									/>

									{create.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>建立失敗</AlertTitle>
											<AlertDescription>{create.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={create.isPending} disabled={!canSubmit}>
									建立
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function EditUserDialog({ user, onClose }: { user: User; onClose: () => void }) {
	const update = useUpdateUserMutation();
	const toast = useToastManager();
	const [displayName, setDisplayName] = useState(user.displayName);
	const [role, setRole] = useState<UserRole>(user.role);
	const [status, setStatus] = useState(user.status);

	return (
		<Dialog.Root
			open
			onOpenChange={open => {
				if (!open) {
					update.reset();
					onClose();
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								update.mutate(
									{ id: user.id, body: { displayName: displayName.trim(), role, status } },
									{
										onSuccess: () => {
											toast.add({ title: "已更新使用者", data: { status: "success" } });
											onClose();
										}
									}
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>編輯 {user.username}</Dialog.Title>
								<Dialog.Description>Email 與帳號建立後不可變更。密碼請使用「重設密碼」。</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									<TextField label="顯示名稱" required value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={update.isPending} />
									<Select label="角色" value={role} onValueChange={value => setRole(value ?? role)} options={ROLE_OPTIONS} disabled={update.isPending} />
									<div className="huan-stack huan-stack--sm">
										<span className="huan-muted">帳號狀態</span>
										<SegmentedControl aria-label="帳號狀態" value={status} onValueChange={value => value && setStatus(value as User["status"])}>
											<SegmentedControlItem value="active">啟用</SegmentedControlItem>
											<SegmentedControlItem value="disabled">停用</SegmentedControlItem>
										</SegmentedControl>
										<span className="huan-caption">停用後無法登入，既有的工作階段也會失效。</span>
									</div>

									{update.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>更新失敗</AlertTitle>
											<AlertDescription>{update.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								<Dialog.Close render={<Button variant="secondary">取消</Button>} />
								<Button type="submit" loading={update.isPending} disabled={displayName.trim().length === 0}>
									儲存
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
	const reset = useResetUserPasswordMutation();
	const toast = useToastManager();
	const [password, setPassword] = useState(() => generatePassword());
	const [done, setDone] = useState(false);

	const passwordError = password.length > 0 ? (PasswordSchema.safeParse(password).error?.issues[0]?.message ?? undefined) : undefined;

	return (
		<Dialog.Root
			open
			onOpenChange={open => {
				if (!open) {
					reset.reset();
					onClose();
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop />
				<Dialog.Viewport>
					<Dialog.Popup closeButton={false}>
						<form
							onSubmit={event => {
								event.preventDefault();
								reset.mutate({ id: user.id, body: { password } }, { onSuccess: () => setDone(true) });
							}}
						>
							<Dialog.Header>
								<Dialog.Title>重設 {user.username} 的密碼</Dialog.Title>
								<Dialog.Description>{done ? "密碼已更新。這組密碼只會顯示這一次。" : "可以使用系統產生的密碼，或自行輸入一組。"}</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									{done ? (
										<>
											<Alert status="warning">
												<AlertTitle>請立刻把密碼交給本人</AlertTitle>
												<AlertDescription>伺服器只保存 Argon2id 雜湊，關閉視窗後就無法再取得這組明文密碼。請提醒對方登入後立即更換。</AlertDescription>
											</Alert>
											<code className="huan-code-block">{password}</code>
											<Button
												variant="secondary"
												size="sm"
												startIcon={<CopyIcon weight="bold" />}
												onClick={() => {
													void navigator.clipboard
														.writeText(password)
														.then(() => toast.add({ title: "已複製密碼", data: { status: "success" } }))
														.catch(() => toast.add({ title: "複製失敗", description: "瀏覽器拒絕存取剪貼簿，請手動選取後複製。", data: { status: "danger" } }));
												}}
											>
												複製密碼
											</Button>
										</>
									) : (
										<>
											<PasswordField
												label="新密碼"
												autoComplete="new-password"
												required
												value={password}
												onChange={event => setPassword(event.target.value)}
												invalid={Boolean(passwordError)}
												error={passwordError}
												disabled={reset.isPending}
											/>
											<Button variant="quiet" size="sm" onClick={() => setPassword(generatePassword())} disabled={reset.isPending}>
												重新產生
											</Button>
										</>
									)}

									{reset.isError ? (
										<Alert status="danger" live="assertive">
											<AlertTitle>重設失敗</AlertTitle>
											<AlertDescription>{reset.error.message}</AlertDescription>
										</Alert>
									) : null}
								</div>
							</Dialog.Body>

							<Dialog.Footer>
								{done ? (
									<Dialog.Close render={<Button>我已經記下來了</Button>} />
								) : (
									<>
										<Dialog.Close render={<Button variant="secondary">取消</Button>} />
										<Button type="submit" loading={reset.isPending} disabled={Boolean(passwordError)}>
											重設密碼
										</Button>
									</>
								)}
							</Dialog.Footer>
						</form>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function UsersPage() {
	const currentUser = useCurrentUser();
	const users = useUserListQuery(currentUser?.role === "super_admin");
	const update = useUpdateUserMutation();
	const toast = useToastManager();

	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<User | null>(null);
	const [resetting, setResetting] = useState<User | null>(null);
	const [toggling, setToggling] = useState<User | null>(null);

	const items = users.data?.items ?? [];

	return (
		<>
			<PageHeader
				title="使用者管理"
				description="只有 super_admin 看得到這個頁面。這裡不會顯示任何密碼雜湊。"
				actions={
					<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)}>
						建立使用者
					</Button>
				}
			/>

			{users.isError ? <QueryErrorAlert error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} title="無法載入使用者列表" /> : null}

			{users.isPending ? (
				<ListSkeleton rows={4} label="正在載入使用者" />
			) : items.length === 0 ? (
				<EmptyState title="還沒有其他使用者" description="建立帳號之後，同事就能一起管理素材、版面與裝置。" actions={<Button onClick={() => setCreateOpen(true)}>建立使用者</Button>} />
			) : (
				<TableFrame>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>使用者</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>角色</TableHead>
								<TableHead>狀態</TableHead>
								<TableHead>兩階段驗證</TableHead>
								<TableHead>最後登入</TableHead>
								<TableHead>建立時間</TableHead>
								<TableHead textAlign="end">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(user => (
								<TableRow key={user.id}>
									<TableCell>
										<div className="huan-stack huan-stack--sm">
											<span>{user.displayName}</span>
											<span className="huan-caption">@{user.username}</span>
										</div>
									</TableCell>
									<TableCell className="huan-truncate">{user.email}</TableCell>
									<TableCell>
										<Badge variant={user.role === "super_admin" ? "accent" : "neutral"}>{user.role}</Badge>
									</TableCell>
									<TableCell>
										<Badge variant={user.status === "active" ? "success" : "danger"}>{user.status === "active" ? "啟用" : "停用"}</Badge>
									</TableCell>
									<TableCell>{user.totpEnabled ? <Badge variant="success">已啟用</Badge> : <Badge variant="neutral">未啟用</Badge>}</TableCell>
									<TableCell>{formatRelativeTime(user.lastLoginAt)}</TableCell>
									<TableCell>{formatDateTime(user.createdAt)}</TableCell>
									<TableCell textAlign="end">
										<div className="huan-row huan-row--end huan-row--tight">
											<Button variant="quiet" size="sm" onClick={() => setEditing(user)}>
												編輯
											</Button>
											<Button variant="quiet" size="sm" onClick={() => setResetting(user)}>
												重設密碼
											</Button>
											<Button variant="quiet" size="sm" disabled={user.id === currentUser?.id} onClick={() => setToggling(user)}>
												{user.status === "active" ? "停用" : "啟用"}
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableFrame>
			)}

			<CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
			{editing ? <EditUserDialog key={editing.id} user={editing} onClose={() => setEditing(null)} /> : null}
			{resetting ? <ResetPasswordDialog key={resetting.id} user={resetting} onClose={() => setResetting(null)} /> : null}

			<ConfirmDialog
				open={toggling !== null}
				onOpenChange={open => {
					if (!open) {
						setToggling(null);
						update.reset();
					}
				}}
				destructive={toggling?.status === "active"}
				title={toggling?.status === "active" ? `停用「${toggling.displayName}」？` : `啟用「${toggling?.displayName ?? ""}」？`}
				description={toggling?.status === "active" ? "停用後這個帳號無法登入，既有的工作階段也會失效。設定與稽核紀錄都會保留。" : "啟用後這個帳號可以立即登入。"}
				confirmLabel={toggling?.status === "active" ? "停用帳號" : "啟用帳號"}
				pending={update.isPending}
				errorMessage={update.error?.message ?? null}
				onConfirm={() => {
					if (!toggling) return;
					update.mutate(
						{ id: toggling.id, body: { status: toggling.status === "active" ? "disabled" : "active" } },
						{
							onSuccess: () => {
								toast.add({ title: toggling.status === "active" ? "已停用帳號" : "已啟用帳號", data: { status: "success" } });
								setToggling(null);
							}
						}
					);
				}}
			/>
		</>
	);
}
