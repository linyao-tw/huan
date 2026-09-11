import { useCurrentUser } from "@/features/auth/hooks";
import { useCreateUserMutation, useResetUserPasswordMutation, useUpdateUserMutation, useUserListQuery } from "@/features/users/hooks";
import "@/features/users/users.css";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { ListSkeleton, QueryErrorAlert } from "@/shared/components/QueryState";
import { useDocumentTitle } from "@/shared/hooks/use-document-title";
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

/** 畫面上一律用中文角色名；`user` / `super_admin` 是資料庫的值，不是給人看的。 */
const ROLE_LABELS: Record<UserRole, string> = { user: "一般使用者", super_admin: "系統管理員" };

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
	{ value: "user", label: ROLE_LABELS.user },
	{ value: "super_admin", label: ROLE_LABELS.super_admin }
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
											toast.add({ title: `已建立 ${user.username}`, description: "把密碼交給本人，並請他登入後自己改掉。", data: { status: "success" } });
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
								<Dialog.Description>帳號一律由系統管理員建立，不能自行註冊。</Dialog.Description>
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
										description="小寫英數字與 . _ -，3 到 32 個字元。"
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
										description="至少 12 個字元。已經先產生一組，也可以自己輸入。"
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
										description="系統管理員可以建立帳號、查看操作紀錄。"
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
											toast.add({ title: "已儲存", data: { status: "success" } });
											onClose();
										}
									}
								);
							}}
						>
							<Dialog.Header>
								<Dialog.Title>編輯 {user.username}</Dialog.Title>
								<Dialog.Description>Email 與帳號建立後不能改。要換密碼請用「重設密碼」。</Dialog.Description>
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
										<span className="huan-caption">停用後就不能登入，已經登入的裝置也會被登出。</span>
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
								<Dialog.Description>{done ? "密碼換好了，這一組只會顯示這一次。" : "可以用系統產生的密碼，也可以自己輸入一組。"}</Dialog.Description>
							</Dialog.Header>

							<Dialog.Body>
								<div className="huan-stack">
									{done ? (
										<>
											<Alert status="warning">
												<AlertTitle>現在就把密碼交給本人</AlertTitle>
												<AlertDescription>關掉這個視窗就看不到了，系統不會再顯示第二次。請他登入後自己改掉。</AlertDescription>
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
														.catch(() => toast.add({ title: "複製失敗", description: "瀏覽器不讓網頁用剪貼簿，請自己選取文字複製。", data: { status: "danger" } }));
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
	useDocumentTitle("使用者");

	const currentUser = useCurrentUser();
	const users = useUserListQuery(currentUser?.role === "super_admin");
	const update = useUpdateUserMutation();
	const toast = useToastManager();

	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<User | null>(null);
	const [resetting, setResetting] = useState<User | null>(null);
	const [toggling, setToggling] = useState<User | null>(null);

	const items = users.data?.items ?? [];

	/* 讀不到清單時不能說「還沒有其他使用者」——沒查到不等於沒有。 */
	const showEmptyState = !users.isPending && !users.isError && items.length === 0;

	return (
		<>
			<PageHeader
				title="使用者管理"
				description="只有系統管理員看得到這一頁。密碼不會顯示在任何地方。"
				actions={
					<Button startIcon={<PlusIcon weight="bold" />} onClick={() => setCreateOpen(true)}>
						建立使用者
					</Button>
				}
			/>

			{users.isError ? <QueryErrorAlert error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} title="讀不到使用者清單" /> : null}

			{users.isPending ? <ListSkeleton rows={4} label="正在載入使用者" /> : null}

			{showEmptyState ? (
				<EmptyState title="還沒有其他使用者" description="建立帳號之後，同事就能一起管理素材、版面與裝置。" actions={<Button onClick={() => setCreateOpen(true)}>建立使用者</Button>} />
			) : null}

			{items.length > 0 ? (
				<TableFrame>
					{/* 八個欄位加上一整排操作按鈕，給表格最小寬度，該捲的時候才會真的捲。 */}
					<Table className="huan-table--wide">
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
										<div className="huan-user-identity">
											<span>{user.displayName}</span>
											<span className="huan-caption">@{user.username}</span>
										</div>
									</TableCell>
									<TableCell className="huan-truncate">{user.email}</TableCell>
									<TableCell>
										<Badge variant={user.role === "super_admin" ? "accent" : "neutral"} size="sm">
											{ROLE_LABELS[user.role]}
										</Badge>
									</TableCell>
									{/* 常態寫成一般文字，徽章留給真的需要被看見的那幾列。 */}
									<TableCell>
										{user.status === "active" ? (
											<span className="huan-muted">啟用中</span>
										) : (
											<Badge variant="danger" size="sm">
												已停用
											</Badge>
										)}
									</TableCell>
									<TableCell>
										{user.totpEnabled ? (
											<Badge variant="success" size="sm">
												已開啟
											</Badge>
										) : (
											<span className="huan-muted">未開啟</span>
										)}
									</TableCell>
									<TableCell>{formatRelativeTime(user.lastLoginAt)}</TableCell>
									<TableCell>{formatDateTime(user.createdAt)}</TableCell>
									<TableCell textAlign="end">
										<div className="huan-user-actions">
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
			) : null}

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
				description={toggling?.status === "active" ? "停用後這個帳號不能登入，已經登入的裝置也會被登出。他做過的事情都會留著。" : "啟用後這個帳號馬上就能登入。"}
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
