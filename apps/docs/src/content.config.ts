import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

/**
 * 文件只有兩個區塊：`guide/**` 給使用者，`dev/**` 給開發者。
 * 根目錄的 `index.md` 是使用者的入口，沒有行銷首頁。
 */
const docs = defineCollection({
	loader: glob({ base: "./src/content/docs", pattern: "**/*.md" }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional()
	})
});

export const collections = { docs };
