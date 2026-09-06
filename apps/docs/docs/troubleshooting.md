# 疑難排解

## 安裝與啟動

### `pnpm dev` 說找不到 `@huan/protocol`

`apps/*` 依賴共用套件的建置產物。先執行：

```sh
pnpm build:packages
```

`pnpm dev`、`pnpm test` 與 `pnpm typecheck` 都會自動先做這一步，直接執行 `pnpm --filter @huan/server dev` 則不會。

### `pnpm install` 被擋下來

repository 只接受 pnpm。`npm install` 或 `yarn` 會被 `preinstall` 腳本拒絕。

```sh
corepack enable pnpm
```

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

::: danger `down -v` 會刪除資料庫的具名 volume。正式環境不要這樣做。:::

## 上傳與轉檔

### 上傳卡在「處理中」

檢查 Worker 是不是在跑：

```sh
docker compose -f docker/compose.yaml logs -f worker
```

本機開發時 Worker 需要系統上有 FFmpeg。`ffmpeg -version` 應該要有輸出。

### 素材顯示「轉檔失敗」

後台顯示的是給使用者看的訊息，完整的技術細節在 Worker 的日誌裡：

```sh
docker compose -f docker/compose.yaml logs worker | grep <assetId>
```

常見原因是來源檔案損毀、使用了 FFmpeg 不支援的編碼，或是檔案其實不是它宣稱的格式。

### 素材顯示「需要重新上傳」

這不是錯誤，是產品的預期行為。

HUAN 不永久保存原始檔，播放產物也會在所有裝置 ACK 且過保留期後回收。當這個素材已經沒有任何可派送的副本時就會變成這個狀態。

解法是重新上傳這個檔案。想避免的話，把 `DISTRIBUTION_RETENTION_HOURS` 調長（例如 `720` 表示 30 天）。

完整說明見 [ADR-0003](/architecture/adr/0003-temporary-object-storage)。

### 瀏覽器直傳 RustFS 失敗

Server 簽出來的網址是給**瀏覽器**用的。如果 Server 在 Docker 內部而瀏覽器在外面，`S3_ENDPOINT`（內部位址）與 `S3_PUBLIC_ENDPOINT`（外部位址）必須分開設定：

```sh
S3_ENDPOINT=http://rustfs:9000
S3_PUBLIC_ENDPOINT=https://storage.example.com
```

## 裝置

### 配對碼過期

配對碼有效期是 10 分鐘且只能使用一次。重新啟動裝置就會產生新的一組。

### 裝置顯示離線但實際上在跑

裝置每約 60 秒送一次 heartbeat，WebSocket 斷線後以指數退避重連（最長 60 秒）。網路中斷後最多需要一兩分鐘才會恢復顯示為線上。

檢查裝置能不能連到 `PUBLIC_URL`，以及反向代理有沒有正確轉發 WebSocket 的 upgrade 請求。

### 裝置卡在舊版本

到 `/app/devices/:id` 看目標版本與回報版本的差距，以及每個素材的同步狀態。

常見原因：

- **磁碟空間不足**：裝置會回報 `storageError`，後台會顯示。
- **某個素材下載失敗**：裝置會留在舊版本並重試，這是正確行為。
- **素材已被回收**：如果素材標示為需要重新上傳，裝置永遠拿不到它。

「強制同步」會讓裝置立刻重新取得目標狀態。

### iframe 顯示空白

很多網站會設定 `X-Frame-Options` 或 `Content-Security-Policy: frame-ancestors`，明確禁止被嵌入。這是對方網站的安全設定，HUAN 不會也不應該繞過它。

改用可以嵌入的來源，或把內容做成上傳的 HTML。

### 上傳的 HTML 沒有作用

第一版只支援**單一自帶資源**的 HTML 檔案。外部的 `<script src>`、`<link href>` 與圖片都不會載入。需要資源時請用 `data:` URI 內嵌。

HTML 在 sandbox iframe 裡執行，沒有 Node、沒有檔案系統、沒有 Electron API。

## 測試

### `pnpm test:e2e` 找不到資料

端對端測試會自己執行種子（`globalSetup`），所以通常不需要手動 seed。

前提是 Admin 與 Server 都在跑。預設對 <http://localhost:5173> 測試；要改測 Docker 直接提供的 Admin：

```sh
HUAN_E2E_BASE_URL=http://localhost:4000 pnpm test:e2e
```

### 端對端測試出現 429

`/auth/*` 有速率限制，這是產品該有的行為。測試已經改成整份只登入兩次並共用 cookie；如果你新增的測試每個都自己登入，就會撞到這個限制。請改用 `storageState`。

## 部署

### 登入之後馬上被登出

正式環境的 session cookie 帶有 `Secure`，只會在 HTTPS 下送出。如果反向代理還沒有接上 TLS，暫時設定：

```sh
SESSION_COOKIE_SECURE=false
```

正式上線前務必改回來。

### 後台載得起來但 API 全部失敗

`CORS_ORIGINS` 必須包含瀏覽器實際使用的來源。由 Server 直接靜態提供 Admin 時兩者同源，不會有這個問題。

### `/health/ready` 回 503

readiness 檢查的是 PostgreSQL。看 Server 日誌確認連線錯誤的原因。

RustFS 刻意不列入 readiness——物件儲存暫時不可用時，後台與裝置的目標狀態仍然可以運作，裝置也能繼續播放本機內容。
