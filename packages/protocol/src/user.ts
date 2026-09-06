import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

/**
 * HUAN 只有兩種角色。
 * - `super_admin`：可以管理使用者、所有裝置與稽核紀錄。
 * - `user`：可以操作素材、版面、排程與裝置，但不能管理其他使用者。
 */
export const UserRoleSchema = z.enum(["super_admin", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(["active", "disabled"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UsernameSchema = z
	.string()
	.min(3, "帳號至少 3 個字元")
	.max(32, "帳號最多 32 個字元")
	.regex(/^[a-z0-9][a-z0-9._-]*$/, "帳號只能使用小寫英數字與 . _ -");

export const EmailSchema = z.email("Email 格式不正確").max(254).toLowerCase();

/**
 * 密碼長度下限刻意設為 12。這是唯一的複雜度要求：
 * 強制混合大小寫與符號會讓使用者選出更容易預測的密碼。
 */
export const PasswordSchema = z.string().min(12, "密碼至少 12 個字元").max(200, "密碼最多 200 個字元");

export const UserSchema = z.object({
	id: IdSchema,
	email: z.email(),
	username: z.string(),
	displayName: z.string(),
	role: UserRoleSchema,
	status: UserStatusSchema,
	totpEnabled: z.boolean(),
	lastLoginAt: IsoDateTimeSchema.nullable(),
	createdAt: IsoDateTimeSchema,
	updatedAt: IsoDateTimeSchema
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserRequestSchema = z.object({
	email: EmailSchema,
	username: UsernameSchema,
	displayName: z.string().min(1, "請輸入顯示名稱").max(64),
	password: PasswordSchema,
	role: UserRoleSchema.default("user")
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
	.object({
		displayName: z.string().min(1).max(64).optional(),
		role: UserRoleSchema.optional(),
		status: UserStatusSchema.optional()
	})
	.refine(value => Object.keys(value).length > 0, "至少要修改一個欄位");
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const ResetUserPasswordRequestSchema = z.object({
	password: PasswordSchema
});
export type ResetUserPasswordRequest = z.infer<typeof ResetUserPasswordRequestSchema>;
