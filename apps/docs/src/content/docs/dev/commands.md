---
title: "指令"
description: "pnpm install"
---

## 安裝

```sh
pnpm install
```

repository 只接受 pnpm，`npm install` 與 `yarn` 會被 `preinstall` 腳本拒絕。

## 開發

| 指令                  | 說明                                   |
| --------------------- | -------------------------------------- |
| `pnpm dev`            | 同時啟動 server、worker 與 admin       |
| `pnpm dev:server`     | 只啟動 Fastify（`tsx watch`）          |
| `pnpm dev:admin`      | 只啟動 Vite（<http://localhost:5173>） |
| `pnpm dev:worker`     | 只啟動 FFmpeg worker                   |
| `pnpm dev:device`     | 啟動 Electron 播放器                   |
| `pnpm dev:device-sim` | 啟動無 GUI 的模擬裝置                  |

## 建置

| 指令                  | 說明                                |
| --------------------- | ----------------------------------- |
| `pnpm build:packages` | 建置 `packages/*`（其他指令的前置） |
| `pnpm build`          | 建置所有套件與應用程式              |
| `pnpm typecheck`      | 全 workspace 型別檢查               |

## 測試

| 指令            | 說明                  |
| --------------- | --------------------- |
| `pnpm test`     | 單元與整合測試        |
| `pnpm test:e2e` | Playwright 端對端測試 |

Server 與 Worker 的測試需要 PostgreSQL 與 RustFS，請先 `pnpm docker:up`。

## 資料庫

| 指令                                      | 說明                         |
| ----------------------------------------- | ---------------------------- |
| `pnpm db:migrate`                         | 套用 migration               |
| `pnpm db:generate`                        | 依 schema 產生新的 migration |
| `pnpm db:seed`                            | 寫入開發用示範資料           |
| `pnpm --filter @huan/server admin:create` | 建立第一個最高權限管理員     |

## Docker

| 指令                | 說明     |
| ------------------- | -------- |
| `pnpm docker:up`    | 啟動服務 |
| `pnpm docker:down`  | 停止服務 |
| `pnpm docker:build` | 建置映像 |
| `pnpm docker:logs`  | 追蹤日誌 |

## 文件

| 指令                    | 說明                           |
| ----------------------- | ------------------------------ |
| `pnpm docs:dev`         | 本機文件站                     |
| `pnpm docs:build`       | SSG 建置到 `apps/docs/dist`    |
| `pnpm docs:screenshots` | 以 Playwright 重新擷取產品截圖 |

## 格式

| 指令                | 說明                    |
| ------------------- | ----------------------- |
| `pnpm format`       | 以 Prettier 格式化      |
| `pnpm format:check` | 只檢查不修改（CI 使用） |

Prettier 設定已經存在：tab 縮排、`printWidth: 200`、雙引號、不加尾逗號。**不要修改。**

## Device 打包

| 指令                                       | 說明                 |
| ------------------------------------------ | -------------------- |
| `pnpm --filter @huan/device package:linux` | Linux x64 與 ARM64   |
| `pnpm --filter @huan/device package:win`   | Windows x64 與 ARM64 |
| `pnpm --filter @huan/device package:mac`   | macOS x64 與 ARM64   |
