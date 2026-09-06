import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 登入狀態的存放位置。
 *
 * 每個測試各自登入一次會撞上 `/auth/*` 的速率限制 —— 那是產品該有的行為，
 * 不該為了讓測試好跑而放寬。改成整份測試只登入兩次（管理員與一般使用者），
 * 其餘測試重用 cookie。
 */
export const ADMIN_STATE = resolve(HERE, "../.auth/admin.json");
export const USER_STATE = resolve(HERE, "../.auth/user.json");
export const ANONYMOUS_STATE: { cookies: []; origins: [] } = { cookies: [], origins: [] };
