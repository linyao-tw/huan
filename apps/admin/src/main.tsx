import { App } from "@/app/App";
import "@/styles/app.css";
import "@linyao.tw/ui/fonts.css";
import "@linyao.tw/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 掛載點");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>
);
