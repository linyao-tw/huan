import { describe, expect, it } from "vitest";
import { isEntrypoint, resolveTelemetryConfig } from "./config.js";

describe("resolveTelemetryConfig", () => {
	it("沒有端點就不啟用，而且說得出原因", () => {
		const config = resolveTelemetryConfig({}, { serviceName: "huan-server" });
		expect(config.enabled).toBe(false);
		expect(config.reason).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
	});

	it("有端點就啟用，服務名稱用預設值", () => {
		expect(resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example" }, { serviceName: "huan-server" })).toEqual({ enabled: true, serviceName: "huan-server", reason: null });
	});

	it("只設了 traces 專用端點也算啟用", () => {
		expect(resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.example/v1/traces" }, { serviceName: "huan-worker" }).enabled).toBe(true);
	});

	it("OTEL_SERVICE_NAME 可以覆寫服務名稱", () => {
		expect(resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example", OTEL_SERVICE_NAME: "huan-server-staging" }, { serviceName: "huan-server" }).serviceName).toBe(
			"huan-server-staging"
		);
	});

	it("OTEL_SDK_DISABLED 優先於端點設定", () => {
		const config = resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example", OTEL_SDK_DISABLED: "true" }, { serviceName: "huan-server" });
		expect(config.enabled).toBe(false);
		expect(config.reason).toContain("OTEL_SDK_DISABLED");
	});

	it("空白的端點當成沒設定", () => {
		expect(resolveTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " }, { serviceName: "huan-server" }).enabled).toBe(false);
	});
});

describe("isEntrypoint", () => {
	it("正式環境的主程式", () => {
		expect(isEntrypoint("/app/apps/server/dist/main.js", "main")).toBe(true);
	});

	it("開發時的主程式", () => {
		expect(isEntrypoint("/Users/me/huan/apps/server/src/main.ts", "main")).toBe(true);
	});

	it("migration 與其他 CLI 不算", () => {
		expect(isEntrypoint("/app/apps/server/dist/cli/migrate.js", "main")).toBe(false);
	});

	it("健康檢查的 node -e 沒有腳本路徑", () => {
		expect(isEntrypoint(undefined, "main")).toBe(false);
	});

	it("名稱只是剛好以 main 開頭的不算", () => {
		expect(isEntrypoint("/app/dist/main-legacy.js", "main")).toBe(false);
	});
});
