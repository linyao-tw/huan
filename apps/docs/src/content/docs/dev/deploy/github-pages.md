---
title: "GitHub Pages"
description: "文件站以 Astro 建置成靜態網站，由 GitHub Actions 部署到 GitHub Pages。"
---

文件站以 Astro 建置成靜態網站，由 GitHub Actions 部署到 GitHub Pages。

:::warning[只有文件放在 Pages]

Server、Worker、Admin 與資料庫都用 Docker 部署。GitHub Pages 上只有這份文件。

:::

## 啟用

1. GitHub repository → **Settings** → **Pages**
2. **Source** 選 **GitHub Actions**

這是一次性的手動步驟。workflow 刻意不使用 `configure-pages` 的 `enablement: true` 自動開啟——建立 Pages 站台需要 repository 的管理權限，而 `GITHUB_TOKEN` 沒有，失敗訊息會是一句看不出原因的 `Resource not accessible by integration`。

沒有先完成這一步時，`設定 GitHub Pages` 會停在：

```text
Get Pages site failed. Error: Not Found
```

## Workflow

`.github/workflows/docs.yml` 的流程：

```text
checkout
  ↓
pnpm 與 Node 設定
  ↓
pnpm install --frozen-lockfile
  ↓
pnpm build:packages
  ↓
configure-pages（取得 origin）
  ↓
pnpm docs:build
  ↓
upload-pages-artifact
  ↓
deploy-pages
```

## 網域與 base

HUAN 的文件站部署在 <https://docs.huan.linyao.tw>，服務在**根路徑**，因此 `base` 固定是 `/`，設定檔裡沒有任何子路徑的處理。

自訂網域在 **Settings → Pages → Custom domain** 設定即可，**不需要**在 `public/` 放 `CNAME` 檔案——用 GitHub Actions 部署時，網域設定存在 repository 的 Pages 設定裡，不是從產物讀出來的。

:::warning[記得打開 Enforce HTTPS]

這不只是安全性問題。`configure-pages` 回報的 `origin` 會跟著這個設定變動，而那個值會寫進 `llms.txt` 與各頁 Markdown 的**絕對連結**。沒打開的話，AI 工具拿到的會是一整份 `http://` 連結。

:::

```sh
gh api repos/<owner>/<repo>/pages | jq '{cname, https_enforced, html_url}'
```

`site` 由 workflow 從 `configure-pages` 的輸出帶入，只有它會影響絕對連結；fork 出去換網域時覆寫 `DOCS_SITE_ORIGIN` 即可，設定檔裡不需要動。

## AI 可讀的輸出

`src/pages/` 底下有三個端點，在建置時一起輸出：

| 檔案            | 產生者             | 內容                       |
| --------------- | ------------------ | -------------------------- |
| `llms.txt`      | `llms.txt.ts`      | 全站結構化索引             |
| `llms-full.txt` | `llms-full.txt.ts` | 全站內容的單一 Markdown 檔 |
| `<route>.md`    | `[...slug].md.ts`  | 每一頁的 Markdown 版本     |

順序跟著 `src/lib/navigation.ts` 的側欄走，因此索引的結構和讀者看到的目錄一致。

這讓 AI 工具不必解析 HTML 就能讀懂整份文件。`site` 設定正確時，這些檔案裡的連結才會指向真實可存取的網址——這也是為什麼它必須由 workflow 帶入。

## 本機預覽

```sh
pnpm docs:dev                      # 開發伺服器（搜尋不可用，索引要建置後才有）
pnpm docs:build                    # SSG 建置到 apps/docs/dist，並產生 Pagefind 索引
pnpm --filter @huan/docs preview   # 預覽建置結果
```

本機建置出來的絕對連結會指向正式網域。要換成別的網域：

```sh
DOCS_SITE_ORIGIN=https://docs.example.com pnpm docs:build
```
