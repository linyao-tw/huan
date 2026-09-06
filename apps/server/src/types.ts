import type { AppContext } from "@/context";
import type { DeviceActor } from "@/lib/device-auth";
import type { SessionActor } from "@/lib/session";

declare module "fastify" {
	interface FastifyInstance {
		ctx: AppContext;
	}

	interface FastifyRequest {
		/** 由 `requireSession` 守衛填入。沒有經過守衛的路由永遠是 `null`。 */
		sessionActor: SessionActor | null;
		/** 由 `requireDevice` 守衛填入。 */
		deviceActor: DeviceActor | null;
	}
}

export {};
