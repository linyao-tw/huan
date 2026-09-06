import type { AppContext } from "@/context";
import fastifySwagger from "@fastify/swagger";
import { API_PREFIX } from "@huan/protocol";
import scalarApiReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

const DOCS_PATH = `${API_PREFIX}/docs`;
const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;

/**
 * OpenAPI 文件完全由路由上的 zod schema 產生。
 *
 * 手寫的 API 文件一定會過期；這裡讓文件和驗證共用同一份定義，
 * 契約改了文件就跟著改，沒有第二份需要維護的真相。
 */
export async function registerDocs(app: FastifyInstance, ctx: AppContext): Promise<void> {
	await app.register(fastifySwagger, {
		openapi: {
			openapi: "3.1.0",
			info: {
				title: "HUAN 讙 API",
				description: "數位看板系統的管理與裝置 API。所有結構定義來自 @huan/protocol 的 zod schema。",
				version: "0.1.0"
			},
			servers: [{ url: ctx.env.PUBLIC_URL }],
			components: {
				securitySchemes: {
					sessionCookie: { type: "apiKey", in: "cookie", name: ctx.env.SESSION_COOKIE_NAME, description: "瀏覽器登入用的 HttpOnly cookie" },
					deviceBearer: { type: "http", scheme: "bearer", description: "裝置憑證，格式為 <deviceId>.<secret>" }
				}
			}
		},
		transform: jsonSchemaTransform
	});

	app.get(OPENAPI_PATH, { schema: { hide: true } }, async () => app.swagger());

	/** 互動式文件會把整份 API 攤開來，production 沒有提供的理由。 */
	if (ctx.env.NODE_ENV !== "production") {
		await app.register(scalarApiReference, {
			routePrefix: DOCS_PATH,
			configuration: { url: OPENAPI_PATH, title: "HUAN 讙 API" }
		});
	}
}
