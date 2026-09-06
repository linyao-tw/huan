import { App } from "@/renderer/src/App";
import "@/renderer/src/styles.css";
import { LinyaoProvider } from "@linyao.tw/ui";
import "@linyao.tw/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 容器");

createRoot(container).render(
	<StrictMode>
		<LinyaoProvider locale="zh-TW">
			<App />
		</LinyaoProvider>
	</StrictMode>
);
