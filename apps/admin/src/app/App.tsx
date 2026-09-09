import { AppProviders } from "@/app/AppProviders";
import { NotFoundPage } from "@/app/NotFoundPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { RequireAuth, RequireSuperAdmin } from "@/features/auth/RequireAuth";
import { LandingPage } from "@/features/marketing/LandingPage";
import { Loader } from "@linyao.tw/ui";
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

/**
 * 官網、登入與 404 直接打包進入口：它們是未登入訪客唯一會看到的畫面，
 * 不應該為了載入後台的編輯器程式碼而多等一次網路往返。後台則整包延後載入。
 */
const AppShell = lazy(async () => ({ default: (await import("@/layouts/AppShell")).AppShell }));
const DashboardPage = lazy(async () => ({ default: (await import("@/features/dashboard/DashboardPage")).DashboardPage }));
const MediaPage = lazy(async () => ({ default: (await import("@/features/media/MediaPage")).MediaPage }));
const LayoutsPage = lazy(async () => ({ default: (await import("@/features/layouts/LayoutsPage")).LayoutsPage }));
const LayoutEditorPage = lazy(async () => ({ default: (await import("@/features/layouts/LayoutEditorPage")).LayoutEditorPage }));
const SchedulesPage = lazy(async () => ({ default: (await import("@/features/schedules/SchedulesPage")).SchedulesPage }));
const DevicesPage = lazy(async () => ({ default: (await import("@/features/devices/DevicesPage")).DevicesPage }));
const DeviceDetailPage = lazy(async () => ({ default: (await import("@/features/devices/DeviceDetailPage")).DeviceDetailPage }));
const SecurityPage = lazy(async () => ({ default: (await import("@/features/security/SecurityPage")).SecurityPage }));
const UsersPage = lazy(async () => ({ default: (await import("@/features/users/UsersPage")).UsersPage }));
const PairPage = lazy(async () => ({ default: (await import("@/features/devices/PairPage")).PairPage }));

function RouteFallback({ label }: { label: string }) {
	return (
		<div className="huan-centered">
			<Loader label={label} size="lg" />
		</div>
	);
}

function Lazy({ children, label = "載入中" }: { children: ReactNode; label?: string }) {
	return <Suspense fallback={<RouteFallback label={label} />}>{children}</Suspense>;
}

export function AppRoutes() {
	return (
		<Routes>
			<Route path="/" element={<LandingPage />} />
			<Route path="/login" element={<LoginPage />} />
			<Route
				path="/pair"
				element={
					<Lazy label="正在載入配對畫面">
						<PairPage />
					</Lazy>
				}
			/>
			<Route
				path="/app"
				element={
					<RequireAuth>
						<Lazy label="正在載入後台">
							<AppShell />
						</Lazy>
					</RequireAuth>
				}
			>
				<Route
					index
					element={
						<Lazy>
							<DashboardPage />
						</Lazy>
					}
				/>
				<Route
					path="media"
					element={
						<Lazy>
							<MediaPage />
						</Lazy>
					}
				/>
				<Route
					path="layouts"
					element={
						<Lazy>
							<LayoutsPage />
						</Lazy>
					}
				/>
				<Route
					path="layouts/:layoutId"
					element={
						<Lazy label="正在載入版面編輯器">
							<LayoutEditorPage />
						</Lazy>
					}
				/>
				<Route
					path="schedules"
					element={
						<Lazy>
							<SchedulesPage />
						</Lazy>
					}
				/>
				<Route
					path="devices"
					element={
						<Lazy>
							<DevicesPage />
						</Lazy>
					}
				/>
				<Route
					path="devices/:deviceId"
					element={
						<Lazy>
							<DeviceDetailPage />
						</Lazy>
					}
				/>
				<Route
					path="security"
					element={
						<Lazy>
							<SecurityPage />
						</Lazy>
					}
				/>
				<Route
					path="users"
					element={
						<RequireSuperAdmin>
							<Lazy>
								<UsersPage />
							</Lazy>
						</RequireSuperAdmin>
					}
				/>
			</Route>
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}

export function App() {
	return (
		<AppProviders>
			<BrowserRouter>
				<AppRoutes />
			</BrowserRouter>
		</AppProviders>
	);
}
