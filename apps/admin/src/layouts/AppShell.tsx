import { useLogoutMutation, useSessionQuery } from "@/features/auth/hooks";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { useAdminSocket } from "@/shared/hooks/use-admin-socket";
import { Badge, Button } from "@linyao.tw/ui";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { GaugeIcon } from "@phosphor-icons/react/dist/csr/Gauge";
import { ImagesSquareIcon } from "@phosphor-icons/react/dist/csr/ImagesSquare";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

interface NavItem {
	to: string;
	label: string;
	icon: ReactNode;
	end?: boolean;
	superAdminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
	{ to: "/app", label: "總覽", icon: <GaugeIcon weight="bold" />, end: true },
	{ to: "/app/media", label: "素材庫", icon: <ImagesSquareIcon weight="bold" /> },
	{ to: "/app/layouts", label: "版面", icon: <SquaresFourIcon weight="bold" /> },
	{ to: "/app/schedules", label: "排程", icon: <CalendarBlankIcon weight="bold" /> },
	{ to: "/app/devices", label: "裝置", icon: <MonitorIcon weight="bold" /> },
	{ to: "/app/security", label: "安全設定", icon: <ShieldCheckIcon weight="bold" /> },
	{ to: "/app/users", label: "使用者", icon: <UsersThreeIcon weight="bold" />, superAdminOnly: true }
];

export function AppShell() {
	const session = useSessionQuery();
	const logout = useLogoutMutation();
	const navigate = useNavigate();
	const user = session.data?.user ?? null;
	const isSuperAdmin = user?.role === "super_admin";

	useAdminSocket(Boolean(user));

	const items = NAV_ITEMS.filter(item => !item.superAdminOnly || isSuperAdmin);

	return (
		<div className="huan-shell">
			<a className="huan-skip-link" href="#main-content">
				跳到主要內容
			</a>

			<aside className="huan-shell__sidebar">
				<NavLink to="/" className="huan-shell__brand">
					<span className="huan-shell__brand-mark">HUAN</span>
					<span className="huan-shell__brand-han">讙</span>
				</NavLink>

				<nav className="huan-shell__nav" aria-label="主要導覽">
					{items.map(item => (
						<NavLink key={item.to} to={item.to} end={item.end} className="huan-shell__nav-link">
							<span className="huan-shell__nav-icon" aria-hidden="true">
								{item.icon}
							</span>
							{item.label}
						</NavLink>
					))}
				</nav>

				<div className="huan-shell__footer">
					<ThemeToggle />
					{user ? (
						<div className="huan-stack huan-stack--sm">
							<span className="huan-truncate">{user.displayName}</span>
							<span className="huan-caption huan-truncate">{user.email}</span>
							<Badge variant={isSuperAdmin ? "accent" : "neutral"} size="sm">
								{isSuperAdmin ? "super_admin" : "user"}
							</Badge>
						</div>
					) : null}
					<Button
						variant="quiet"
						size="sm"
						startIcon={<SignOutIcon weight="bold" />}
						loading={logout.isPending}
						onClick={() => {
							logout.mutate(undefined, { onSettled: () => void navigate("/login", { replace: true }) });
						}}
					>
						登出
					</Button>
				</div>
			</aside>

			<div className="huan-shell__main">
				<main className="huan-shell__content" id="main-content" tabIndex={-1}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
