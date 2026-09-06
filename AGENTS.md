# HUAN 讙 — Repository Guidelines

HUAN 讙是跨平台的雲端媒體播放與數位看板系統。使用者在 Web 後台設計畫面、上傳影片與圖片、安排播放時段，內容再派送到 Raspberry Pi、Windows、Ubuntu 與 macOS 的播放裝置。

本文件是這個 repository 的工作準則。所有貢獻者與自動化代理都應該先讀完再動手。

## 專案總覽

- 產品語言：繁體中文（zh-TW）。所有 UI 文案、文件、commit 訊息說明與註解都使用繁體中文。
- 程式碼識別字、型別名稱、函式名稱一律使用英文。
- 套件管理器：**pnpm**。不要使用 npm 或 yarn；root 的 `preinstall` 會擋下來。
- 設計系統：**`@linyao.tw/ui@1.3.0`**。不得引入第二套元件庫。

## 架構

```text
Admin (React SPA)
  │  HTTPS ── Fastify ── PostgreSQL
  │  直傳 ──→ RustFS (S3 相容)
  │                 │
  │           FFmpeg Worker（獨立 process）
  │                 │
  │            distribution 產物
  │                 │
  └───────────→ Device (Electron)
        WebSocket 通知 + HTTPS 取狀態 + 本機播放
```

三個核心設計決定，詳細理由見 `apps/docs/docs/architecture/adr/`：

1. **Desired / Reported state**：Server 只宣告「這台裝置應該是哪個版面修訂」，Device 自己下載、驗證、啟用，再回報實際狀態。不使用大量命令式 RPC。
2. **WebSocket 只送通知，REST 才是事實來源**：WebSocket 傳的是 `{"type":"desired_state_changed","version":42}`，Device 收到後再打 REST 取完整狀態。WebSocket 永遠不傳素材。
3. **本機優先播放**：素材必須先下載到 Device 才會播放。網路中斷時 HUAN 繼續播現有內容，新版本要等所有檔案都驗證完成才原子性切換。

## Workspace 結構

```text
apps/
  admin/       Vite + React 19 + TanStack Query + React Router 的後台與官網（CSR，不做 SSR）
  server/      Fastify + Drizzle 的 API、WebSocket 與靜態檔案服務
  worker/      FFmpeg 轉檔 worker，以 PostgreSQL 為工作佇列
  device/      Electron 播放器（main / preload / renderer）
  device-sim/  無 GUI 的模擬裝置，開發與測試用
  docs/        Astro 靜態文件站
  e2e/         Playwright 端對端測試與文件截圖腳本
packages/
  protocol/      @huan/protocol — 共用的 zod 結構與型別
  db/            @huan/db — Drizzle schema、連線與 migration
  shared/        @huan/shared — 排程判定、退避、格式化、TOTP
  layout-engine/ @huan/layout-engine — 分割樹幾何與樹狀操作
  config/        @huan/config — 環境變數結構
  device-core/   @huan/device-core — 裝置同步引擎（Electron 與模擬裝置共用）
docker/          compose.yaml 與各服務的 Dockerfile
scripts/         開發與發布腳本
```

不要為了「看起來模組化」再拆更多套件。新增套件前先問：這段程式碼真的有兩個以上的消費者嗎？

## 常用指令

```sh
pnpm install              # 安裝所有相依套件
pnpm build:packages       # 先建置共用套件（apps 依賴它們的 dist）
pnpm dev                  # 同時啟動 server、worker、admin
pnpm dev:server           # 只啟動 Fastify
pnpm dev:admin            # 只啟動 Vite
pnpm dev:worker           # 只啟動 FFmpeg worker
pnpm dev:device           # 啟動 Electron 播放器
pnpm dev:device-sim       # 啟動模擬裝置
pnpm typecheck            # 全 workspace 型別檢查
pnpm test                 # 全 workspace 單元與整合測試
pnpm test:e2e             # Playwright
pnpm build                # 建置所有套件與應用程式
pnpm docker:up            # 啟動 postgres、rustfs、server、worker
pnpm db:migrate           # 套用 migration
pnpm db:seed              # 寫入開發用示範資料
pnpm docs:dev             # 本機文件站
pnpm docs:build           # 文件 SSG 建置
pnpm docs:screenshots     # 以 Playwright 重新產生文件截圖
```

## 程式碼規範

### 格式

Prettier 設定已經存在，**不要修改**：tab 縮排、`printWidth: 200`、雙引號、不加尾逗號、`arrowParens: "avoid"`。送出前跑 `pnpm format`。

### TypeScript

- 全 workspace 開啟 `strict`。
- 不使用 `any`。真的需要未知型別時用 `unknown` 並在使用點收斂。
- 不用 `as unknown as T` 繞過型別系統。遇到型別對不上，先確認是不是結構本身設計錯了。
- 編譯錯誤要修，不要關掉型別檢查來換取「能跑」。

### Import 規範

**絕對不要跨層級相對匯入。** 以下寫法在這個 repository 是錯的：

```ts
import { foo } from "../../../shared/foo"; // ✗
```

正確做法有兩種：

```ts
import { thing } from "@/lib/thing"; // ✓ 同一個 app 內部
import { DeviceSchema } from "@huan/protocol"; // ✓ 跨套件
```

`@/` 別名只在 `apps/*` 使用，由各自的 bundler（Vite、electron-vite、tsup）與 `tsconfig.json` 的 `paths` 同時設定，因此開發、型別檢查與 production build 三邊都解析得到。

`packages/*` 內部維持扁平結構並使用同層的 `./module.js` 相對匯入。這些套件以 `tsc` 直接輸出 ESM，沒有 bundler 可以改寫別名，硬要加 `@/` 只會在 Node 執行時炸掉。注意副檔名要寫 `.js`，那是 `NodeNext` 模組解析的要求。

### 註解

註解解釋「為什麼」，不解釋「做什麼」。程式碼已經寫了做什麼。

不要寫 `// 迴圈跑過所有裝置` 這種註解。要寫的是「為什麼這裡需要保留期」、「為什麼這個欄位不能是 0」。

### UI

所有介面元件都來自 `@linyao.tw/ui`。圖示使用 `@phosphor-icons/react` 的 CSR 進入點：

```tsx
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
```

顏色、間距、圓角、字級一律使用套件提供的設計變數（`var(--control-primary)`、`var(--space-4)`…），不要寫死色碼或 px。`@linyao.tw/ui` 沒有提供的版面容器可以自己寫 CSS，但值必須取自設計變數。

禁止使用 `window.alert`、`window.confirm`、`window.prompt`。確認用 `AlertDialog`，通知用 Toast。

每個資料驅動的畫面都要有：載入中、空狀態、錯誤與重試、成功、停用、處理中。只做 happy path 不算完成。

## 測試

```sh
pnpm test           # 單元 + 整合
pnpm test:e2e       # Playwright
```

- 共用套件的純邏輯（分割樹、排程判定、TOTP、退避）用 vitest 單元測試。
- Server 的整合測試需要真實 PostgreSQL 與 RustFS，跑之前先 `pnpm docker:up`；缺少環境時測試會自行跳過並印出原因，不會假裝通過。
- Worker 測試用 FFmpeg 的 `testsrc` 自己產生測試素材，repository 內不放大型或有版權的影片。
- 新功能要附上測試。改到既有行為時，先讓測試失敗，再修。

## 資料庫

Schema 在 `packages/db/src/schema.ts`，migration 在 `packages/db/migrations/`。

改了 schema 之後：

```sh
pnpm --filter @huan/db db:generate
```

不要手寫 migration SQL，也不要直接改已經產生的檔案。

## Device 協定

- REST 前綴 `/api/v1`，WebSocket 在 `/api/v1/devices/socket`。
- 裝置以 `Authorization: Bearer <deviceId>.<secret>` 驗證，Server 只保存 secret 的 SHA-256。
- Heartbeat 約 60 秒，WebSocket 斷線後以指數退避加抖動重連（1s → 60s 上限）。
- 即使 WebSocket 正常，Device 仍每 5 分鐘做一次完整狀態同步，不完全依賴推播。
- 所有派送檔案以 SHA-256 驗證。雜湊不符時刪除暫存檔並重試，**不可以 ACK**。

## 素材生命週期

```text
上傳 → RustFS uploads/ → TRANSCODE 工作 → ffprobe → 轉檔 → thumbnail / preview / playback
                                                              ↓
                                                    刪除原始檔（不長期保存）
                                                              ↓
                          指派給裝置 → 簽章網址 → Device 下載 → 校驗 → ACK
                                                              ↓
                            所有目標裝置 ACK 且過保留期 → 回收 playback 產物
```

**RustFS 不是 HUAN 的永久素材庫。** 正式播放副本最終保存在 Device。當原始檔已刪除、playback 產物也被回收，而後來又有新裝置需要這份素材時，該素材會被標記為 `needs_reupload`。這是產品刻意的取捨，UI 與文件都必須誠實呈現，不要假裝伺服器還留著不存在的檔案。

物件鍵一律由 UUID 組成，永遠不使用使用者提供的檔名。

## 文件

文件站在 `apps/docs`，使用 **Astro** 靜態輸出。線上位置是 <https://docs.huan.linyao.tw>，服務在根路徑，設定裡沒有子路徑處理。

- 內容是 `src/content/docs/**` 的 Markdown，走 Astro content collection，每一篇都有 `title` 與 `description` frontmatter。
- 搜尋用 Pagefind，索引在 `astro build` 之後產生，因此 `pnpm dev` 下搜尋不可用（對話框會說明）。
- `llms.txt`、`llms-full.txt` 與每頁的 `.md` 由 `src/pages/` 底下的端點產生，順序跟著側欄走。
- 圖表是 ```mermaid 區塊，在瀏覽器端算繪並跟著主題重畫；只有含圖的頁面才會載入 mermaid。

站台**只有兩個入口**，沒有行銷首頁：

- `docs/index.md` 與 `docs/guide/**` — 使用教學，寫給實際操作 HUAN 的人。不談程式碼、指令或部署。
- `docs/dev/**` — 開發者，寫給要架設、修改或部署的人。

新增頁面時先決定它屬於哪一邊，再放進對應目錄並加到 `src/lib/navigation.ts` 的側欄。不要建立第三個區塊。

文件中的截圖必須是真實產品畫面，由 `pnpm docs:screenshots` 以 Playwright 對 seed 環境自動擷取。不放示意圖或 placeholder。

文件的外觀完全由 `@linyao.tw/ui` 的設計變數驅動：`src/styles/docs.css` 匯入 `styles.css` 之後，只用語意角色（`--background-main`、`--text-secondary`、`--space-4`…）作版面，**沒有任何色碼或自訂刻度**。主題直接切 `data-lyds-theme`，和產品端同一套機制。

文件站刻意不用 React：內容是靜態的，`.astro` 元件加設計變數就能完全符合設計系統，不需要為了幾個互動元件把 React 執行期帶進每一頁。圖示改用 `@phosphor-icons/core` 的原始 SVG，和產品端是同一套圖示家族。

**寫作提醒：提示框要寫成獨立的段落，不要擠在同一行。**

```markdown
:::warning[標題]

內容。

:::
```

Prettier 的 `proseWrap: "never"` 會把同一段的多行併成一行。標題和內文寫在一起的話，格式化之後標題會被黏進內文，而且沒有辦法自動還原。

## 安全限制

- 密碼使用 Argon2id，絕不明文儲存。
- 瀏覽器登入狀態使用 HttpOnly + SameSite cookie 承載不透明 session token；長期憑證不放 localStorage。
- 稽核日誌與應用程式日誌**絕不**寫入密碼、TOTP 密鑰、復原碼、session token、裝置憑證或簽章網址的查詢字串。
- FFmpeg 一律以 `spawn` 加參數陣列呼叫，不拼接 shell 字串。
- 上傳的 HTML 只能在 sandbox iframe 中執行，不得取得任何 Node 或 Electron API。
- Electron 維持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，preload 只暴露最小介面。播放 HTML 不是關閉這些設定的理由。
- 所有使用者輸入都要經過 zod 驗證，包含檔名、物件鍵、iframe 網址、配對碼與 WebSocket 訊息。

## 不要做的事

- 不要引入 Kubernetes、Kafka、Redis、RabbitMQ、GraphQL、Elasticsearch。Fastify + PostgreSQL + RustFS + Worker 已經夠用。真的需要時要先寫 ADR 說明為什麼。
- 不要用假資料代替還沒完成的後端功能。
- 不要留下大量 TODO。
- 不要修改 Prettier 設定。

## Commit And PR Guidance

Use Linux kernel/Git-style commit subjects with a concrete area, subsystem, component, directory, package, or file prefix:

```
area: imperative patch summary
sub/sys: imperative patch summary
```

The prefix should name the repository area primarily changed. Prefer specific prefixes such as a directory, package, file, subsystem, or component name.

Do not use generic Conventional Commit prefixes such as `fix:`, `feat:`, `chore:`, `docs:`, or `refactor:` unless they are actual repository areas in this repository. The prefix should describe where the change belongs, not what type of change it is.

Use an imperative verb in the summary after the colon, such as `fix`, `clarify`, `split`, `validate`, `rename`, `remove`, `add`, `update`, `document`, etc. Do not use past tense verbs like `fixed` or `added`.

When a patch spans multiple areas, choose the narrowest common area if one exists. If no clear common area exists, use the primary behavior changed rather than listing multiple unrelated prefixes.

The summary after the colon should briefly describe what the patch does, because it becomes the first line shown in the git changelog. Keep it short, imperative, and specific. Prefer subjects under 72 characters. Use lowercase for the first word after the colon unless it is a proper noun, and do not end the subject with a period.

Examples:

```
storybook: clarify build ownership
web/routes: split route-level chunks
ui/field: fix select menu positioning
server/auth: validate session cookie
githooks.txt: improve the intro section
```

Use a commit body when the reason for the change is not obvious from the diff. Explain why the change is needed, not just what changed.

PRs should describe the changed area, summarize the user-visible or developer-visible impact, list validation commands run, link related issues, and include screenshots for visible web UI changes.

If no validation was run, state that explicitly and explain why. Do not claim to have run commands that were not actually executed.

For UI changes that are not easily captured in a screenshot, describe the visual change and any manual checks performed.
