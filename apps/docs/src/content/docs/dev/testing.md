---
title: "測試"
description: "HUAN 的測試不只是「編譯得過」。"
---

HUAN 的測試不只是「編譯得過」。

```sh
pnpm test        # 單元與整合測試
pnpm test:e2e    # Playwright 端對端測試
```

## 層次

| 層次        | 範圍                   | 需要的環境                 |
| ----------- | ---------------------- | -------------------------- |
| 單元測試    | 共用套件的純邏輯       | 無                         |
| 整合測試    | Server 的 API 與資料庫 | PostgreSQL、RustFS         |
| Worker 測試 | 真實的 FFmpeg 轉檔     | PostgreSQL、RustFS、FFmpeg |
| 元件測試    | Admin 的 React 元件    | 無（jsdom）                |
| 端對端測試  | 瀏覽器操作完整流程     | 全部                       |

需要的環境不存在時，測試會**明確跳過並印出原因**，不會假裝通過。

## 單元測試

集中在幾個一旦錯掉就很難察覺的地方：

**版面分割樹**（`packages/layout-engine`）——分割、刪除、交換、序列化往返，以及幾何計算在 1920×1080、1280×720、3840×2160 與 1080×1920 四種畫布上的實際數值。70/30 在 1920 寬上就是 1344 與 576，測試斷言的是這個數字，不是「差不多」。

**排程判定**（`packages/shared`）——時區換算、跨午夜的錨定日期、日期區間、日光節約時間切換，以及衝突決勝的每一條規則。特別測「同一組輸入永遠得到同一個結果」——把排程用不同順序傳進去必須得到同一個答案。

**TOTP**（`packages/shared`）——RFC 4226 與 RFC 6238 的官方測試向量，加上時鐘誤差容忍與重放拒絕。

**退避**（`packages/shared`）——指數成長、上限封頂、抖動範圍。

**環境變數**（`packages/config`）——預設值、必填檢查、格式驗證。

## Server 整合測試

用 `app.inject()` 對真正的 Fastify 實例發請求，接的是真正的 PostgreSQL 與 RustFS。

涵蓋登入成功與失敗、速率限制、TOTP 完整流程、復原碼只能用一次、權限邊界、配對流程、版面發布、排程 CRUD、素材上傳流程、裝置 ACK 的雜湊驗證，以及刪除被引用的素材會被擋下來。

## Worker 測試

測試素材由 FFmpeg 自己產生：

```sh
ffmpeg -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 …
```

**repository 裡不放任何大型或有版權的影片。**

測試斷言的是實際的輸出屬性：播放版本是 H.264、`yuv420p`、不超過 1920×1080、不超過 30fps、有 faststart，而且 640×360 的來源**不會被放大**。

佇列的測試驗證 `FOR UPDATE SKIP LOCKED` 真的讓兩個並行的取件拿到不同的工作、失敗的工作會退避重試、被強制終止的工作會被回收。

## Admin 元件測試

vitest 加 Testing Library（jsdom）。

涵蓋認證守衛的重導、版面編輯器的分割與交換操作、比例拖曳的座標換算與夾制、素材上傳的各個狀態，以及排程表單的驗證。

## 端對端測試

Playwright，跑完整的流程：

```text
登入
  ↓
建立版面
  ↓
分割區塊
  ↓
放入內容
  ↓
發布
  ↓
配對模擬裝置
  ↓
建立排程
```

模擬裝置（`@huan/device-sim`）讓這件事不需要真的 Raspberry Pi。它走的是和 Electron 播放器**完全相同的同步引擎**，因此測到的行為是真的。

## 文件截圖

```sh
pnpm docs:screenshots
```

用 Playwright 對種子環境擷取真實的產品畫面。種子資料是決定性的，因此每次產生的截圖內容一致，不會讓文件的圖片在每次執行後都不一樣。

**文件裡不放示意圖或 placeholder。**

## CI

`.github/workflows/ci.yml` 在每次 push 與 PR 上執行：

```text
格式檢查 → 建置共用套件 → migration → 型別檢查 → 測試 → 建置 → 文件建置
```

外加獨立的端對端測試 job 與 Docker 映像建置驗證。

PostgreSQL 與 RustFS 以 GitHub Actions 的 service container 提供，FFmpeg 用 apt 安裝。
