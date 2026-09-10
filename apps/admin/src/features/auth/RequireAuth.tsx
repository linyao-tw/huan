import { useSessionQuery } from "@/features/auth/hooks";
import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Loader } from "@linyao.tw/ui";
import { ProhibitIcon } from "@phosphor-icons/react/dist/csr/Prohibit";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";

function FullPageLoader({ label }: { label: string }) {
	return (
		<div className="huan-centered">
			<Loader label={label} size="lg" />
		</div>
	);
}

/** `/app/*` 的守衛。未登入時帶著原本要去的位址轉往登入頁，登入完成後才回得來。 */
export function RequireAuth({ children }: { children: ReactNode }) {
	const location = useLocation();
	const session = useSessionQuery();

	if (session.isPending) return <FullPageLoader label="正在確認登入狀態" />;

	if (session.isError) {
		return (
			<div className="huan-centered">
				<div className="huan-centered__inner">
					<Alert status="danger">
						<AlertTitle>無法確認登入狀態</AlertTitle>
						<AlertDescription>{session.error.message}</AlertDescription>
					</Alert>
					<Button onClick={() => void session.refetch()} loading={session.isFetching}>
						重試
					</Button>
				</div>
			</div>
		);
	}

	if (!session.data) {
		const next = `${location.pathname}${location.search}`;
		return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
	}

	return children;
}

/** 權限不足要看得見原因。直接導回總覽會讓人以為連結壞了。 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
	const session = useSessionQuery();

	if (session.isPending) return <FullPageLoader label="正在確認權限" />;

	if (session.data?.user.role !== "super_admin") {
		return (
			<EmptyState
				status="danger"
				icon={<ProhibitIcon weight="bold" />}
				eyebrow="403"
				title="沒有存取這個頁面的權限"
				description="使用者管理只開放給 super_admin。如果你需要這項權限，請聯絡系統管理員。"
				actions={
					<Button render={<Link to="/app" />} variant="secondary">
						回到總覽
					</Button>
				}
			/>
		);
	}

	return children;
}

/**
 * 素材、版面、排程與裝置的守衛，方向和 `RequireSuperAdmin` 相反。
 *
 * 這些資源屬於個別使用者，系統管理員一筆也不擁有，伺服器對這些路由回 403。
 * 沒有這一層的話，深連結進來看到的會是一張空表格——那讀起來像「你的東西被刪光了」，
 * 而不是「這個角色沒有這項功能」。權限不足要看得見原因。
 */
export function RequireResourceUser({ children }: { children: ReactNode }) {
	const session = useSessionQuery();

	if (session.isPending) return <FullPageLoader label="正在確認權限" />;

	if (session.data?.user.role === "super_admin") {
		return (
			<EmptyState
				status="danger"
				icon={<ProhibitIcon weight="bold" />}
				eyebrow="403"
				title="這個角色沒有這項功能"
				description="系統管理員只負責帳號管理。素材、版面、排程與裝置都屬於各個使用者，系統管理員看不到，也不能代為操作。要自己放內容，請用一般使用者帳號登入。"
				actions={
					<Button render={<Link to="/app/users" />} variant="secondary">
						去使用者管理
					</Button>
				}
			/>
		);
	}

	return children;
}
