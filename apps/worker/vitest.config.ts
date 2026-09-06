import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url))
		}
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
		testTimeout: 120_000,
		hookTimeout: 120_000,
		pool: "forks",
		fileParallelism: false
	}
});
