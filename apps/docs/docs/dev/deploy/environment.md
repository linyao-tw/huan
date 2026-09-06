# 環境變數

所有環境變數在啟動時由 `@huan/config` 以 zod 驗證。缺少或格式錯誤時 Server 與 Worker 會**拒絕啟動**，並明確指出是哪一個變數有問題——不會帶著錯誤的設定跑起來，然後在某個奇怪的地方失敗。

完整範例見 repository 根目錄的 `.env.example`。

## 共用

| 變數           | 預設          | 說明                                  |
| -------------- | ------------- | ------------------------------------- |
| `NODE_ENV`     | `development` | `development`、`test` 或 `production` |
| `LOG_LEVEL`    | `info`        | `fatal` 到 `trace`                    |
| `DATABASE_URL` | —             | **必填。** PostgreSQL 連線字串        |

## 物件儲存

| 變數                   | 預設             | 說明                                             |
| ---------------------- | ---------------- | ------------------------------------------------ |
| `S3_ENDPOINT`          | —                | **必填。** Server 與 Worker 連得到的 RustFS 位址 |
| `S3_PUBLIC_ENDPOINT`   | 同 `S3_ENDPOINT` | 瀏覽器與裝置連得到的位址                         |
| `S3_REGION`            | `us-east-1`      | S3 簽章需要，RustFS 不在意實際值                 |
| `S3_BUCKET`            | `huan`           | 儲存桶名稱                                       |
| `S3_ACCESS_KEY_ID`     | —                | **必填。**                                       |
| `S3_SECRET_ACCESS_KEY` | —                | **必填。**                                       |
| `S3_FORCE_PATH_STYLE`  | `true`           | RustFS 需要 path-style 位址                      |

::: tip 為什麼有兩個 endpoint Server 簽出來的網址是給**瀏覽器和裝置**用的。Server 在 Docker 網路裡透過 `http://rustfs:9000` 連到儲存，但那個主機名稱在容器外面不存在。兩者不同時就必須分開設定，否則簽出來的網址在外部連不上。:::

## Server

| 變數                              | 預設                    | 說明                           |
| --------------------------------- | ----------------------- | ------------------------------ |
| `HOST`                            | `0.0.0.0`               | 監聽位址                       |
| `PORT`                            | `4000`                  | 監聽埠                         |
| `PUBLIC_URL`                      | `http://localhost:4000` | 對外網址，用於組出配對連結     |
| `CORS_ORIGINS`                    | `http://localhost:5173` | 逗號分隔的允許來源             |
| `SESSION_COOKIE_NAME`             | `huan_session`          |                                |
| `SESSION_TTL_HOURS`               | `336`（14 天）          |                                |
| `SESSION_COOKIE_SECURE`           | production 為 `true`    | 沒有 TLS 的環境才設為 `false`  |
| `TOTP_ISSUER`                     | `HUAN`                  | 顯示在驗證器 App 裡的名稱      |
| `LOGIN_RATE_LIMIT_MAX`            | `10`                    | 時間窗內允許的失敗次數         |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `300`                   |                                |
| `SIGNED_URL_TTL_SECONDS`          | `900`                   | 簽章網址有效時間               |
| `DISTRIBUTION_RETENTION_HOURS`    | `24`                    | 全部 ACK 之後播放產物的保留期  |
| `DEVICE_HEARTBEAT_SECONDS`        | `60`                    | 下發給裝置的 heartbeat 間隔    |
| `DEVICE_FALLBACK_SYNC_SECONDS`    | `300`                   | 下發給裝置的保底同步間隔       |
| `DEVICE_MAX_CONCURRENT_DOWNLOADS` | `3`                     | 裝置同時下載的檔案數           |
| `ADMIN_DIST_DIR`                  | —                       | 設定後由 Server 靜態提供 Admin |

### `DISTRIBUTION_RETENTION_HOURS` 值得想一下

這個值決定「所有裝置都下載完成之後，播放產物還要在 RustFS 上留多久」。

| 值           | 效果                                         |
| ------------ | -------------------------------------------- |
| `24`（預設） | 一天內新增裝置還來得及取得素材               |
| `168`        | 一週                                         |
| `720`        | 一個月。實務上幾乎不會遇到需要重新上傳的情況 |

調長只是多花儲存空間；調短則會更快遇到「需要重新上傳」的狀態。詳見 [ADR-0003](/dev/adr/0003-temporary-object-storage)。

## Worker

| 變數                      | 預設         | 說明             |
| ------------------------- | ------------ | ---------------- |
| `WORKER_CONCURRENCY`      | `2`          | 同時處理的工作數 |
| `WORKER_POLL_INTERVAL_MS` | `2000`       | 取件輪詢間隔     |
| `WORKER_JOB_MAX_ATTEMPTS` | `3`          | 最大重試次數     |
| `FFMPEG_PATH`             | `ffmpeg`     |                  |
| `FFPROBE_PATH`            | `ffprobe`    |                  |
| `WORKER_TMP_DIR`          | 系統暫存目錄 | 轉檔暫存位置     |
| `WORKER_HEALTH_PORT`      | `4001`       | 存活檢查端點的埠 |

## Admin（建置期）

| 變數                | 說明                                      |
| ------------------- | ----------------------------------------- |
| `VITE_API_BASE_URL` | 開發時的 API 位址。同源部署時不需要設定。 |

## 文件（建置期）

| 變數               | 說明                                         |
| ------------------ | -------------------------------------------- |
| `DOCS_SITE_ORIGIN` | 站台來源，預設 `https://docs.huan.linyao.tw` |

只影響 `llms.txt` 與各頁 Markdown 裡的絕對連結。GitHub Actions 會從 Pages 設定自動帶入，本機不需要設定。

## 秘密管理

- **不要 commit `.env`。** `.gitignore` 已經排除它。
- 不要把密碼寫進 `compose.yaml`。用 `.env` 或部署平台提供的秘密管理機制。
- 正式環境的 `POSTGRES_PASSWORD` 與 `S3_SECRET_ACCESS_KEY` 要用高熵的隨機字串。
- **原始碼裡沒有任何預設管理員密碼。** 第一個管理員一定要用 CLI 建立。
