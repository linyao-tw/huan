import { createContext, type AppContext } from "@/context";
import { loadEnv } from "@/env";
import { clientIp } from "@/lib/request-ip";
import { registerDocs } from "@/plugins/docs";
import { registerErrorHandler, sendNotFound } from "@/plugins/error-handler";
import { DEFAULT_RATE_LIMITS, registerRateLimit, type RateLimitTuning } from "@/plugins/rate-limit";
import { registerStatic } from "@/plugins/static";
import { auditRoutes } from "@/routes/audit";
import { authRoutes } from "@/routes/auth";
import { deviceApiRoutes } from "@/routes/device-api";
import { deviceAdminRoutes } from "@/routes/devices";
import { healthRoutes } from "@/routes/health";
import { layoutRoutes } from "@/routes/layouts";
import { mediaRoutes } from "@/routes/media";
import { scheduleRoutes } from "@/routes/schedules";
import { securityRoutes } from "@/routes/security";
import { userRoutes } from "@/routes/users";
import { registerAdminSocket } from "@/ws/admin-socket";
import { registerDeviceSocket } from "@/ws/device-socket";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import type { ServerEnv } from "@huan/config";
import { API_PREFIX } from "@huan/protocol";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, ServerResponse } from "node:http";

export type HuanServer = FastifyInstance<ReturnType<typeof Fastify>["server"], IncomingMessage, ServerResponse, FastifyBaseLogger, ZodTypeProvider>;

export interface BuildServerOptions {
	env?: ServerEnv;
	/** 測試會傳入共用的 context，讓多個測試檔共用同一個連線池。 */
	context?: AppContext;
	rateLimits?: Partial<RateLimitTuning>;
	logger?: FastifyServerOptions["logger"];
}

/**
 * pino 的遮蔽設定。
 *
 * cookie 與 Authorization 標頭直接帶著可用的憑證，一旦寫進日誌，日誌檔就變成
 * 另一份憑證副本。配對 token 同理。這裡用 `remove` 而不是換成 `[Redacted]`，
 * 因為連「這個請求有帶 cookie」都不是日誌需要知道的事。
 */
const REDACT_PATHS = ["req.headers.cookie", "req.headers.authorization", 'req.headers["x-huan-pairing-token"]', 'res.headers["set-cookie"]'];

function buildLoggerOptions(env: ServerEnv): FastifyServerOptions["logger"] {
	return {
		level: env.LOG_LEVEL,
		redact: { paths: REDACT_PATHS, remove: true },
		/**
		 * 只記錄路由層面的資訊。
		 * 請求內容會包含密碼、TOTP 驗證碼與復原碼，任何環境都不寫進日誌。
		 */
		serializers: {
			req(request: FastifyRequest) {
				return { id: request.id, method: request.method, url: request.url, ip: clientIp(request) };
			}
		},
		...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } } : {})
	};
}

export async function buildServer(options: BuildServerOptions = {}): Promise<HuanServer> {
	const env = options.env ?? loadEnv();
	const ownsContext = options.context === undefined;
	const ctx = options.context ?? createContext({ env });
	const rateLimits: RateLimitTuning = { ...DEFAULT_RATE_LIMITS, ...options.rateLimits };

	const app = Fastify({
		logger: options.logger ?? buildLoggerOptions(env),
		/** 部署上一定隔著反向代理，否則所有請求的來源 IP 都會是代理本身。 */
		trustProxy: true,
		bodyLimit: 2 * 1024 * 1024,
		ajv: { customOptions: { coerceTypes: false } }
	}).withTypeProvider<ZodTypeProvider>();

	app.decorate("ctx", ctx);
	app.decorateRequest("sessionActor", null);
	app.decorateRequest("deviceActor", null);

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	registerErrorHandler(app);

	await app.register(fastifyCookie);
	await app.register(fastifyCors, { origin: env.CORS_ORIGINS, credentials: true });
	await registerRateLimit(app, rateLimits);
	await app.register(fastifyWebsocket);
	await registerDocs(app, ctx);

	await app.register(healthRoutes);

	await app.register(authRoutes, { prefix: API_PREFIX, rateLimits });
	await app.register(securityRoutes, { prefix: API_PREFIX, rateLimits });
	await app.register(userRoutes, { prefix: API_PREFIX });
	await app.register(mediaRoutes, { prefix: API_PREFIX });
	await app.register(layoutRoutes, { prefix: API_PREFIX });
	await app.register(scheduleRoutes, { prefix: API_PREFIX });
	await app.register(deviceAdminRoutes, { prefix: API_PREFIX });
	await app.register(deviceApiRoutes, { prefix: API_PREFIX, rateLimits });
	await app.register(auditRoutes, { prefix: API_PREFIX });

	await app.register(
		async instance => {
			registerDeviceSocket(instance);
			registerAdminSocket(instance);
		},
		{ prefix: API_PREFIX }
	);

	if (env.ADMIN_DIST_DIR) {
		await registerStatic(app, env.ADMIN_DIST_DIR);
	} else {
		app.setNotFoundHandler(sendNotFound);
	}

	/**
	 * 物件儲存桶不存在時自動建立，但失敗不阻擋啟動。
	 * Server 少了 RustFS 仍然能提供 Admin API 與 desired state，
	 * 為了一個還沒起來的相依服務就讓整個 Server 起不來並不划算。
	 */
	app.addHook("onReady", async () => {
		try {
			await ctx.storage.ensureBucket();
		} catch (error) {
			app.log.warn({ err: error }, "無法確認物件儲存桶是否存在，素材相關功能可能無法使用");
		}
	});

	app.addHook("onClose", async () => {
		ctx.hub.closeAll();
		if (ownsContext) await ctx.close();
	});

	return app;
}
