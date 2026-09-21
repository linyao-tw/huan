import { checkEnvironment, createHarness, type TestHarness } from "@/test/helpers";
import { users } from "@huan/db";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const environment = await checkEnvironment();
const suite = environment.ready ? describe : describe.skip;
if (!environment.ready) console.warn(`[跳過] 資料庫查詢追蹤整合測試：${environment.reason}`);

/**
 * 資料庫 span 是靠替換 drizzle 內部類別的方法產生的，drizzle 一改版就可能悄悄失效，
 * 單元測試只驗得到 SQL 解析，驗不到「真的有 span」。這裡對真實 PostgreSQL 跑一遍。
 */
suite("資料庫查詢追蹤", () => {
	let harness: TestHarness;
	const exporter = new InMemorySpanExporter();
	const tracer = trace.getTracer("huan-test");

	beforeAll(async () => {
		context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
		trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
		harness = await createHarness();
	});

	afterAll(async () => {
		await harness.close();
		trace.disable();
		context.disable();
	});

	beforeEach(() => {
		exporter.reset();
	});

	it("請求裡的查詢成為子 span，名稱是操作與資料表，只記 SQL 樣板不記參數", async () => {
		const secret = "never-log-this-value";
		const parentSpanId = await tracer.startActiveSpan("request", async span => {
			await harness.ctx.db.select({ id: users.id }).from(users).where(eq(users.username, secret));
			await harness.ctx.db.update(users).set({ displayName: secret }).where(eq(users.username, secret));
			span.end();
			return span.spanContext().spanId;
		});

		const spans = exporter.getFinishedSpans().filter(span => span.name !== "request");
		expect(spans.map(span => span.name)).toEqual(["SELECT users", "UPDATE users"]);
		for (const span of spans) {
			expect(span.parentSpanContext?.spanId).toBe(parentSpanId);
			expect(span.attributes["db.system.name"]).toBe("postgresql");
			expect(span.attributes["db.collection.name"]).toBe("users");
			expect(String(span.attributes["db.query.text"])).toContain("$1");
			expect(JSON.stringify(span.attributes)).not.toContain(secret);
		}
	});

	it("不在任何 span 裡的查詢不追蹤", async () => {
		await harness.ctx.db.select({ id: users.id }).from(users).limit(1);
		expect(exporter.getFinishedSpans()).toHaveLength(0);
	});

	it("查詢失敗時 span 標成錯誤", async () => {
		await tracer.startActiveSpan("request", async span => {
			await expect(harness.ctx.db.execute("select * from table_that_does_not_exist")).rejects.toThrow();
			span.end();
		});
		const failed = exporter.getFinishedSpans().find(span => span.name !== "request");
		expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
	});
});
