# Monorepo

HUAN 是一個 pnpm workspace。

## 結構

```text
apps/
	admin/       Vite + React 的後台與官網（CSR）
	server/      Fastify API、WebSocket 與靜態服務
	worker/      FFmpeg 轉檔 worker
	device/      Electron 播放器
	device-sim/  無 GUI 的模擬裝置
	docs/        Rspress 文件站
	e2e/         Playwright 端對端測試與文件截圖
packages/
	protocol/      @huan/protocol — 共用的 zod 結構與型別
	db/            @huan/db — Drizzle schema、連線、migration
	shared/        @huan/shared — 排程判定、退避、格式化、TOTP
	layout-engine/ @huan/layout-engine — 分割樹幾何與樹狀操作
	config/        @huan/config — 環境變數結構
	device-core/   @huan/device-core — 裝置同步引擎
docker/          compose.yaml 與 Dockerfile
scripts/         開發與發布腳本
```

## 為什麼是這幾個套件

每一個共用套件都有**兩個以上的消費者**。這是拆套件的唯一標準。

| 套件                  | 消費者                        |
| --------------------- | ----------------------------- |
| `@huan/protocol`      | Admin、Server、Worker、Device |
| `@huan/db`            | Server、Worker                |
| `@huan/shared`        | Server、Admin、Device         |
| `@huan/layout-engine` | Admin、Device                 |
| `@huan/config`        | Server、Worker                |
| `@huan/device-core`   | Device、模擬裝置              |

`@huan/protocol` 的存在讓「Admin 以為欄位叫 `assetId`、Server 以為叫 `asset_id`」這種問題在編譯期就會被抓到。`@huan/layout-engine` 的存在讓後台預覽與裝置播放不可能算出不同的版面。

## 建置順序

`apps/*` 依賴 `packages/*` 的**建置產物**（`dist/`），不是原始碼。

```sh
pnpm build:packages   # 先建置共用套件
pnpm build            # 再建置應用程式
```

`pnpm dev`、`pnpm test` 與 `pnpm typecheck` 都會自動先跑 `build:packages`。直接執行 `pnpm --filter @huan/server dev` 則不會，這是「找不到 `@huan/protocol`」最常見的原因。

## Import 規範

**絕對不要跨層級相對匯入：**

```ts
import { foo } from "../../../shared/foo"; // ✗
```

正確做法：

```ts
import { thing } from "@/lib/thing"; // ✓ 同一個 app 內部
import { DeviceSchema } from "@huan/protocol"; // ✓ 跨套件
```

### `@/` 只用在 `apps/*`

別名由各自的 bundler 與 `tsconfig.json` 的 `paths` 同時設定：

| App                              | 解析者                      |
| -------------------------------- | --------------------------- |
| `admin`                          | Vite `resolve.alias`        |
| `device`                         | electron-vite               |
| `server`、`worker`、`device-sim` | 開發時 `tsx`，建置時 `tsup` |

因此開發、型別檢查與 production build 三邊都解析得到。**不會只有 IDE 看得懂。**

### `packages/*` 用相對匯入

共用套件以 `tsc` 直接輸出 ESM，沒有 bundler 可以改寫別名，硬加 `@/` 會在 Node 執行時炸掉。

這些套件維持扁平結構，用同層的相對匯入，而且**副檔名要寫 `.js`**（`NodeNext` 模組解析的要求）：

```ts
import { clampRatio } from "./geometry.js"; // ✓
```

## 建置方式

| 目標                             | 工具          | 原因                                      |
| -------------------------------- | ------------- | ----------------------------------------- |
| `packages/*`                     | `tsc`         | 產生真正的 `.d.ts`，Node 可以直接執行     |
| `server`、`worker`、`device-sim` | `tsup`        | 只打包自己的原始碼，npm 相依維持 external |
| `admin`                          | Vite          |                                           |
| `device`                         | electron-vite | main / preload / renderer 三段各自建置    |
| `docs`                           | Rspress       | SSG                                       |

`tsup` 刻意只打包應用程式自己的程式碼：`@/` 別名在打包時就被解析掉，而第三方套件保持原樣，避免把有動態 `require` 的函式庫硬塞進單一檔案而在執行期爆炸。

## TypeScript

全 workspace 開啟 `strict`。

- 不使用 `any`。需要未知型別時用 `unknown` 並在使用點收斂。
- 不用 `as unknown as T` 繞過型別系統。
- 編譯錯誤要修，不要關掉檢查換取「能跑」。

## 加入新的相依套件

```sh
pnpm --filter @huan/server add some-package
```

加之前先想一下 [ADR-0007](/dev/adr/0007-postgres-job-queue) 的精神：每多一個相依就多一個要維運、要更新、會壞掉的東西。

Device 的相依套件要額外考慮六個平台架構組合（linux-arm64、linux-x64、win-x64、win-arm64、darwin-x64、darwin-arm64）。**原生 Node 模組會讓 ARM 交叉打包變得很困難**，優先找純 JS、Web API 或 Electron 內建的解法。
