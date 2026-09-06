import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url))
		}
	},
	server: {
		port: 5173,
		/**
		 * 開發時把 API 與 WebSocket 代理到 Fastify，讓瀏覽器把兩者視為同源。
		 * 少了這一層，session cookie 會因為跨站而被瀏覽器擋掉。
		 */
		proxy: {
			"/api": { target: apiTarget, changeOrigin: true, ws: true },
			"/health": { target: apiTarget, changeOrigin: true }
		}
	},
	build: {
		outDir: "dist",
		sourcemap: true
	}
});
