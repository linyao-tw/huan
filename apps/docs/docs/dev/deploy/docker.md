# Docker 部署

Server 端的所有元件都以 Docker 部署。

## 元件

`docker/compose.yaml` 定義四個服務：

| 服務       | 說明                                                             |
| ---------- | ---------------------------------------------------------------- |
| `postgres` | PostgreSQL 18。唯一的資料庫，同時也是工作佇列。                  |
| `rustfs`   | S3 相容物件儲存。暫存與派送用。                                  |
| `server`   | Fastify API、WebSocket，同時靜態提供 Admin 的 production build。 |
| `worker`   | FFmpeg 轉檔與素材回收。                                          |

Admin 不需要獨立容器——它是純靜態檔案，由 Server 以 `@fastify/static` 提供，同源也讓 cookie 與 WebSocket 的設定變得單純。

## 步驟

```sh
cp .env.example .env
```

至少要設定：

```sh
POSTGRES_PASSWORD=<一組強密碼>
S3_SECRET_ACCESS_KEY=<另一組強密碼>
DATABASE_URL=postgres://huan:<同上的密碼>@postgres:5432/huan
PUBLIC_URL=https://huan.example.com
CORS_ORIGINS=https://huan.example.com
```

建置並啟動：

```sh
pnpm docker:build
pnpm docker:up
```

建立資料表：

```sh
docker compose -f docker/compose.yaml exec server node apps/server/dist/cli/migrate.js
```

建立第一個管理員：

```sh
docker compose -f docker/compose.yaml exec \
	-e HUAN_ADMIN_PASSWORD='<一組強密碼>' \
	server node apps/server/dist/cli/create-admin.js \
	--email you@example.com --username admin --display-name 管理員
```

::: warning不要把密碼寫進 `compose.yaml`，也不要 commit 進 repository。上面的指令用的是一次性的環境變數，不會留在容器的設定裡。:::

確認服務狀態：

```sh
docker compose -f docker/compose.yaml ps
curl -fsS http://localhost:4000/health/ready
```

## 容器設定

每個服務都具備：

- **healthcheck**：`postgres` 用 `pg_isready`，`rustfs` 用它自己的 `/health`，`server` 用 `/health/ready`，`worker` 用它的存活端點。
- **restart policy**：`unless-stopped`。
- **非 root 執行**：`server` 與 `worker` 都以 `node` 使用者執行。
- **具名 volume**：資料庫、物件儲存與轉檔暫存都不寫在 overlay 層。
- **固定版本**：所有映像都指定版本，不使用 `latest`。
- **production build**：容器裡跑的是建置後的產物，不是開發伺服器。

## 反向代理

正式環境請在前面放一層負責 TLS 的反向代理。它必須正確轉發 WebSocket 的 upgrade 請求：

```nginx
location / {
	proxy_pass http://127.0.0.1:4000;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
}
```

沒有這幾行的話，裝置的 WebSocket 會連不上，系統會退化成每 5 分鐘輪詢一次——功能還在，但更新變慢。

## 擴充轉檔能力

Worker 是無狀態的，可以直接開多份：

```sh
docker compose -f docker/compose.yaml up -d --scale worker=3
```

`FOR UPDATE SKIP LOCKED` 保證每一件工作只會被一個 Worker 取走。

## 備份

需要備份的有兩樣：

**PostgreSQL** —— 這是唯一不可重建的資料。

```sh
docker compose -f docker/compose.yaml exec postgres \
	pg_dump -U huan huan | gzip > huan-$(date +%F).sql.gz
```

**RustFS** —— 依 HUAN 的設計，這裡只有暫存內容：縮圖、預覽，以及還沒被所有裝置取走的播放產物。遺失縮圖不會影響播放，但正在派送中的產物遺失就必須重新上傳素材。

原始檔不在裡面。這是刻意的設計，見 [ADR-0003](/dev/adr/0003-temporary-object-storage)。

## 升級

```sh
git pull
pnpm docker:build
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml exec server node apps/server/dist/cli/migrate.js
```

Migration 是往前相容的，執行順序是先啟動新版容器再套用 migration。升級期間裝置會繼續播放本機內容，不會受影響。
