export interface Page<Item> {
	items: Item[];
	total: number;
	limit: number;
	offset: number;
}

export function page<Item>(items: Item[], total: number, limit: number, offset: number): Page<Item> {
	return { items, total, limit, offset };
}

/**
 * Drizzle 的 `count()` 在 postgres-js 底下回傳字串或數字都有可能，
 * 這裡統一收斂成整數，讓回應的型別檢查不會因為驅動版本而漂移。
 */
export function toCount(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") return Number.parseInt(value, 10) || 0;
	if (typeof value === "bigint") return Number(value);
	return 0;
}
