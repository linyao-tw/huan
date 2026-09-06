---
title: "疑難排解"
description: "面向架設與開發的問題。使用者端的問題見使用教學的疑難排解。"
---

面向架設與開發的問題。使用者端的問題見[使用教學的疑難排解](/guide/troubleshooting)。

## 安裝與啟動

### `pnpm dev` 說找不到 `@huan/protocol`

`apps/*` 依賴共用套件的建置產物。先執行：

```sh
pnpm build:packages
```

`pnpm dev`、`pnpm test` 與 `pnpm typecheck` 都會自動先做這一步，直接執行 `pnpm --filter @huan/server dev` 則不會。

### `pnpm dev` 報 `EADDRINUSE: port 4000`

`pnpm docker:up` 會啟動 `server` 容器，它同樣佔用 4000 埠。兩者只能擇一：

```sh
docker compose -f docker/compose.yaml stop server worker
pnpm dev
```

只需要資料庫與物件儲存時，啟動這兩個服務就好：

```sh
docker compose -f docker/compose.yaml up -d postgres rustfs
```

### `pnpm install` 被擋下來

repository 只接受 pnpm。`npm install` 或 `yarn` 會被 `preinstall` 腳本拒絕。

```sh
corepack enable pnpm
```

### Server 啟動時報環境變數錯誤

`@huan/config` 會在啟動時驗證所有環境變數，並明確指出哪一個有問題。對照 `.env.example` 補齊，特別是 `DATABASE_URL`、`S3_ENDPOINT`、`S3_ACCESS_KEY_ID` 與 `S3_SECRET_ACCESS_KEY`。

## 資料庫

### `pnpm db:migrate` 連不上

確認容器已經起來且通過健康檢查：

```sh
docker compose -f docker/compose.yaml ps
```

`.env` 裡 `DATABASE_URL` 的密碼必須和 `POSTGRES_PASSWORD` 一致。改過密碼之後舊的 volume 仍然保留著舊密碼，需要重建：

```sh
docker compose -f docker/compose.yaml down -v
pnpm docker:up
pnpm db:migrate
```

:::danger[這會刪掉資料]

`down -v` 會刪除資料庫的具名 volume。正式環境不要這樣做。

:::

### PostgreSQL 容器啟動後立刻重啟

日誌裡會看到：

```text
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" ...
       there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)
```

PostgreSQL 18 起，官方映像把資料放進帶主版本號的子目錄，掛載點必須是 `/var/lib/postgresql`，不是它底下的 `data`。`compose.yaml` 已經是正確的設定；如果你從舊版升級，volume 裡還是舊的目錄結構，需要用 `pg_upgrade` 或倒出重灌。

## 轉檔

### 工作卡在 pending

檢查 Worker 是不是在跑：

```sh
docker compose -f docker/compose.yaml logs -f worker
```

本機開發時 Worker 需要系統上有 FFmpeg。`ffmpeg -version` 應該要有輸出。

### 想看轉檔失敗的完整原因

後台顯示的是給使用者看的訊息，完整的 FFmpeg 輸出只留在 Worker 的日誌裡：

```sh
docker compose -f docker/compose.yaml logs worker | grep <assetId>
```

這是刻意的：完整指令與檔案系統路徑對一般使用者沒有幫助，而且會洩漏伺服器的內部結構。

### 瀏覽器直傳物件儲存失敗

Server 簽出來的網址是給**瀏覽器**用的。如果 Server 在 Docker 內部而瀏覽器在外面，`S3_ENDPOINT`（內部位址）與 `S3_PUBLIC_ENDPOINT`（外部位址）必須分開設定：

```sh
S3_ENDPOINT=http://rustfs:9000
S3_PUBLIC_ENDPOINT=https://storage.example.com
```

## 測試

### `pnpm test:e2e` 找不到資料

端對端測試會自己執行種子（`globalSetup`），並由 Playwright 的 `webServer` 帶起 Server 與 Admin，所以通常只要 `pnpm docker:up` 之後直接跑就好。

要改測 Docker 直接提供的 Admin：

```sh
HUAN_E2E_NO_WEB_SERVER=true HUAN_E2E_BASE_URL=http://localhost:4000 pnpm test:e2e
```

### 端對端測試出現 429

`/auth/*` 有速率限制，這是產品該有的行為。測試已經改成整份只登入兩次並共用 cookie；如果你新增的測試每個都自己登入，就會撞到這個限制。請改用 `storageState`。

### Server 與 Worker 的測試互相干擾

兩者共用同一個資料庫，而 Server 的整合測試會清空資料表。`pnpm test` 已經設成逐一執行 workspace（`--workspace-concurrency=1`），不要改成平行。

## 部署

### 登入之後馬上被登出

正式環境的 session cookie 帶有 `Secure`，只會在 HTTPS 下送出。如果反向代理還沒有接上 TLS，暫時設定：

```sh
SESSION_COOKIE_SECURE=false
```

正式上線前務必改回來。

### 後台載得起來但 API 全部失敗

`CORS_ORIGINS` 必須包含瀏覽器實際使用的來源。由 Server 直接靜態提供 Admin 時兩者同源，不會有這個問題。

### 裝置連得上 REST 但 WebSocket 一直重連

反向代理沒有轉發 upgrade 請求。見 [Docker 部署](/dev/deploy/docker#反向代理)的 nginx 範例。

少了它系統會退化成每 5 分鐘輪詢一次——功能還在，只是更新變慢。

### `/health/ready` 回 503

readiness 檢查的是 PostgreSQL。看 Server 日誌確認連線錯誤的原因。

RustFS 刻意不列入 readiness——物件儲存暫時不可用時，後台與裝置的目標狀態仍然可以運作，裝置也能繼續播放本機內容。

### 文件部署失敗：`Get Pages site failed: Not Found`

repository 還沒在 **Settings → Pages** 把 Source 設成 GitHub Actions。這是一次性的手動步驟，詳見 [GitHub Pages](/dev/deploy/github-pages)。
