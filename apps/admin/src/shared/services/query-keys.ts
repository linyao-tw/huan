import type { MediaListQuery } from "@huan/protocol";

/**
 * 所有 queryKey 集中在這裡。
 *
 * 散在各個畫面裡的字串陣列遲早會對不上，invalidate 就會靜靜地失效；
 * 集中之後「哪些查詢會被這次 mutation 影響」是可以直接讀出來的。
 */
export const queryKeys = {
	session: ["session"] as const,
	security: ["security"] as const,

	media: {
		all: ["media"] as const,
		list: (filters: Partial<MediaListQuery>) => ["media", "list", filters] as const,
		detail: (id: string) => ["media", "detail", id] as const,
		usage: (id: string) => ["media", "usage", id] as const
	},

	layouts: {
		all: ["layouts"] as const,
		list: () => ["layouts", "list"] as const,
		detail: (id: string) => ["layouts", "detail", id] as const,
		revision: (layoutId: string, revisionId: string) => ["layouts", "revision", layoutId, revisionId] as const
	},

	schedules: {
		all: ["schedules"] as const,
		list: () => ["schedules", "list"] as const
	},

	devices: {
		all: ["devices"] as const,
		list: () => ["devices", "list"] as const,
		detail: (id: string) => ["devices", "detail", id] as const
	},

	users: {
		all: ["users"] as const,
		list: () => ["users", "list"] as const
	},

	pairing: {
		lookup: (code: string) => ["pairing", code] as const
	}
} as const;
