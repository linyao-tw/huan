---
title: "PostgreSQL"
description: "HUAN 只用一個資料庫。它同時是資料儲存與工作佇列。"
---

HUAN 只用一個資料庫。它同時是資料儲存與工作佇列。

## 版本

PostgreSQL 18。`compose.yaml` 使用 `postgres:18.2-alpine`。

需要的功能：

- `gen_random_uuid()`（PostgreSQL 13 起內建於核心，不需要 `pgcrypto` 擴充）
- `jsonb`
- `FOR UPDATE SKIP LOCKED`（9.5 起提供）
- 陣列欄位（`smallint[]` 用於排程的星期設定）

## Schema

Schema 定義在 `packages/db/src/schema.ts`，用 Drizzle 撰寫，migration 由 `drizzle-kit` 產生。

```text
users                  帳號
sessions               瀏覽器登入狀態（只存 token 雜湊）
auth_challenges        通過密碼但還沒完成 2FA 的中繼狀態
totp_credentials       TOTP 密鑰與重放防護
totp_recovery_codes    復原碼雜湊
login_attempts         登入節流

devices                裝置與目標／回報狀態
device_credentials     裝置憑證雜湊
device_pairing_codes   配對碼

media_assets           素材與 ffprobe 中繼資料
media_variants         各種產物與其物件鍵
media_device_sync      每台裝置對每個產物的同步狀態

layouts                版面與草稿
layout_revisions       不可變的發布快照

schedules              排程
schedule_devices       排程與裝置的關聯

worker_jobs            工作佇列
audit_logs             稽核紀錄
```

## Migration

```sh
pnpm db:migrate
```

改動 schema 之後產生新的 migration：

```sh
pnpm --filter @huan/db db:generate
```

**不要手寫 migration SQL，也不要修改已經產生的檔案。** 已套用的 migration 是不可變的歷史。

Migration 檔案跟著 `@huan/db` 一起發布（`package.json` 的 `files` 列了 `migrations`），因此 Docker 映像不需要另外複製 SQL。

## 為什麼工作佇列在資料庫裡

```sql
SELECT * FROM worker_jobs
WHERE status = 'pending' AND run_after <= now()
ORDER BY run_after, created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

`FOR UPDATE SKIP LOCKED` 是 PostgreSQL 為佇列設計的原語。取件的交易鎖住那一列，其他 Worker 直接跳過。

這讓「建立素材紀錄」與「排入轉檔工作」可以在同一個交易裡完成。用外部佇列就變成跨兩個系統的寫入，必須自己處理其中一邊失敗的情況。

完整理由見 [ADR-0007](/dev/adr/0007-postgres-job-queue)。

## 備份

```sh
docker compose -f docker/compose.yaml exec postgres \
	pg_dump -U huan --format=custom huan > huan-$(date +%F).dump
```

還原：

```sh
docker compose -f docker/compose.yaml exec -T postgres \
	pg_restore -U huan -d huan --clean --if-exists < huan-2026-09-06.dump
```

**PostgreSQL 是 HUAN 唯一不可重建的資料。** RustFS 裡只有暫存內容，裝置本機的素材可以重新派送（只要素材還有可用的副本），但帳號、版面、修訂、排程與稽核紀錄一旦遺失就沒有了。

## 維護

`worker_jobs` 與 `login_attempts` 會持續成長。已完成的工作與過期的登入紀錄可以定期清理：

```sql
DELETE FROM worker_jobs
WHERE status IN ('success', 'failed') AND finished_at < now() - interval '30 days';

DELETE FROM login_attempts WHERE created_at < now() - interval '30 days';
```

`audit_logs` **不要自動刪除**——那是稽核紀錄，保留期應該由組織的政策決定。
