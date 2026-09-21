import { describe, expect, it } from "vitest";
import { describeQuery } from "./tracing.js";

describe("describeQuery", () => {
	it("SELECT 取 from 後面的表", () => {
		expect(describeQuery('select "id", "name" from "media_assets" where "owner_id" = $1')).toEqual({ operation: "SELECT", collection: "media_assets" });
	});

	it("INSERT 取 into 後面的表", () => {
		expect(describeQuery('insert into "worker_jobs" ("kind") values ($1)')).toEqual({ operation: "INSERT", collection: "worker_jobs" });
	});

	it("UPDATE 就是 UPDATE（drizzle 自己的 metadata 會把它標成 insert）", () => {
		expect(describeQuery('update "sessions" set "last_seen_at" = $1 where "sessions"."id" = $2').operation).toBe("UPDATE");
	});

	it("UPDATE 取 update 後面的表，不會被 updated_at 這種欄位名騙到", () => {
		expect(describeQuery('update "devices" set "updated_at" = $1 where "id" = $2')).toEqual({ operation: "UPDATE", collection: "devices" });
		expect(describeQuery('select "updated_at" from "layouts"')).toEqual({ operation: "SELECT", collection: "layouts" });
	});

	it("前面有空白與換行也認得出來", () => {
		expect(describeQuery("\n\t\tselect v.id from media_variants v")).toEqual({ operation: "SELECT", collection: "media_variants" });
	});

	it("找不到表時只回操作", () => {
		expect(describeQuery("select 1")).toEqual({ operation: "SELECT", collection: null });
	});

	it("空字串不會炸", () => {
		expect(describeQuery("")).toEqual({ operation: "QUERY", collection: null });
	});
});
