import { clientIp } from "@/lib/request-ip";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export interface RateLimitTuning {
	/** 每個 IP 在一個時間窗內對所有端點的總上限。 */
	global: number;
	/** `/auth/*` 的上限。密碼與 2FA 的猜測成本必須明顯高於一般 API。 */
	auth: number;
	/** 未驗證的配對端點。任何人都打得到，因此壓得比 auth 更低。 */
	pairing: number;
	timeWindow: string;
}

export const DEFAULT_RATE_LIMITS: RateLimitTuning = {
	global: 600,
	auth: 30,
	pairing: 20,
	timeWindow: "1 minute"
};

/**
 * 這一層擋的是「同一個來源打太多請求」，跟 `login_attempts` 的節流是兩件事。
 *
 * 前者是流量保護，計數在記憶體裡、重啟就歸零；後者是針對帳號的爆破防護，
 * 必須跨重啟保留，所以寫在資料庫。少了任何一層都會留下明顯的缺口。
 */
export async function registerRateLimit(app: FastifyInstance, tuning: RateLimitTuning): Promise<void> {
	await app.register(fastifyRateLimit, {
		global: true,
		max: tuning.global,
		timeWindow: tuning.timeWindow,
		/** 健康檢查是 orchestrator 高頻打的，被自己的節流擋住只會造成假的重啟迴圈。 */
		allowList: request => request.url.startsWith("/health"),
		keyGenerator: request => clientIp(request) ?? "unknown"
	});
}

export function routeRateLimit(max: number, timeWindow: string): { rateLimit: { max: number; timeWindow: string } } {
	return { rateLimit: { max, timeWindow } };
}
