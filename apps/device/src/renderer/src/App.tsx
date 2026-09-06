import { bridge } from "@/renderer/src/bridge";
import { DevicePanel } from "@/renderer/src/components/DevicePanel";
import { IdleScreen } from "@/renderer/src/components/IdleScreen";
import { LayoutRenderer, type AssetResolver } from "@/renderer/src/components/LayoutRenderer";
import { PairingScreen } from "@/renderer/src/components/PairingScreen";
import type { DeviceSnapshot, PairingSnapshot } from "@/shared/ipc";
import type { ScheduleTarget } from "@huan/device-core";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 目前啟用版本的 assetId → 本機檔名對照。
 *
 * renderer 只知道檔名，不知道路徑：實際位置由主行程的自訂協定解析，
 * 沙箱裡的頁面因此不可能推導出媒體目錄以外的任何路徑。
 */
function useAssetResolver(target: ScheduleTarget | null): AssetResolver {
	const [manifest, setManifest] = useState<Record<string, string>>({});

	useEffect(() => {
		let cancelled = false;
		void bridge.getAssets().then(entries => {
			if (!cancelled) setManifest(entries);
		});
		return () => {
			cancelled = true;
		};
	}, [target?.layoutRevisionId]);

	return useMemo(
		() => ({
			fileNameFor: (assetId: string): string | null => manifest[assetId] ?? null
		}),
		[manifest]
	);
}

export function App(): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
	const [pairing, setPairing] = useState<PairingSnapshot | null>(null);
	const [target, setTarget] = useState<ScheduleTarget | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const assets = useAssetResolver(target);

	useEffect(() => {
		void bridge.getSnapshot().then(setSnapshot);
		void bridge.getPairing().then(setPairing);
		void bridge.getLayout().then(setTarget);

		const unsubscribers = [bridge.onSnapshot(setSnapshot), bridge.onPairing(setPairing), bridge.onLayout(setTarget), bridge.onOpenPanel(() => setPanelOpen(open => !open))];
		return () => unsubscribers.forEach(unsubscribe => unsubscribe());
	}, []);

	const handleSync = useCallback(() => {
		void bridge.sync();
	}, []);

	const handleUnbind = useCallback(() => {
		setPanelOpen(false);
		void bridge.unbind();
	}, []);

	const handleRetryPairing = useCallback(() => {
		void bridge.restartPairing();
	}, []);

	if (!snapshot) {
		return <IdleScreen message="正在啟動…" />;
	}

	/** 未綁定時只顯示配對畫面，不會有任何內容或裝置面板。 */
	if (snapshot.status === "unpaired" || snapshot.status === "pairing" || snapshot.status === "unbound") {
		return <PairingScreen pairing={pairing} serverUrl={snapshot.serverUrl} onRetry={handleRetryPairing} />;
	}

	return (
		<>
			{target?.layout ? (
				<LayoutRenderer document={target.layout.document} assets={assets} />
			) : (
				<IdleScreen message="目前沒有排定播放的內容" detail={snapshot.online ? "請在 HUAN 後台為這台裝置指定預設版面或排程。" : "目前離線，將在恢復連線後同步。"} />
			)}

			{panelOpen ? <DevicePanel snapshot={snapshot} onClose={() => setPanelOpen(false)} onSync={handleSync} onUnbind={handleUnbind} /> : null}
		</>
	);
}
