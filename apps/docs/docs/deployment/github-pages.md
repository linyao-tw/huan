# GitHub Pages

文件站以 Rspress 建置成靜態網站，由 GitHub Actions 部署到 GitHub Pages。

::: warning 只有文件放在 Pages Server、Worker、Admin 與資料庫都用 Docker 部署。GitHub Pages 上只有這份文件。:::

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
configure-pages（取得 base_path 與 origin）
  ↓
pnpm docs:build
  ↓
upload-pages-artifact
  ↓
deploy-pages
```

## 子路徑

GitHub Pages 會把站台放在 `<owner>.github.io/<repo>/` 之下，因此所有資源路徑都需要一個 base 前綴。

`rspress.config.ts` 從環境變數讀取這兩個值：

```ts
const base = process.env.DOCS_BASE ?? "/";
const siteOrigin = process.env.DOCS_SITE_ORIGIN;
```

Workflow 由 `actions/configure-pages` 的輸出帶入：

```yaml
env:
  DOCS_BASE: ${{ steps.pages.outputs.base_path }}/
  DOCS_SITE_ORIGIN: ${{ steps.pages.outputs.origin }}
```

**沒有任何地方寫死 GitHub 使用者名稱或 repository 名稱。** Fork 這個專案之後不需要改設定檔就能正確部署。

本機開發時兩個變數都不存在，base 退回 `/`。

## AI 可讀的輸出

`rspress.config.ts` 裡開啟了：

```ts
llms: true;
```

建置後會額外產生：

| 檔案            | 內容                       |
| --------------- | -------------------------- |
| `llms.txt`      | 全站結構化索引             |
| `llms-full.txt` | 全站內容的單一 Markdown 檔 |
| `<route>.md`    | 每一頁的 Markdown 版本     |

這讓 AI 工具不必解析 HTML 就能讀懂整份文件。`siteOrigin` 與 `base` 設定正確時，這些檔案裡的連結才會指向真實可存取的網址——這也是為什麼那兩個值必須由 workflow 帶入。

## 自訂網域

HUAN 的文件站部署在 <https://docs.huan.linyao.tw>。

自訂網域在 **Settings → Pages → Custom domain** 設定即可，**不需要**在 `public/` 放 `CNAME` 檔案——用 GitHub Actions 部署時，網域設定存在 repository 的 Pages 設定裡，不是從產物讀出來的。

設定完成後：

- `configure-pages` 的 `base_path` 會變成空字串，`DOCS_BASE` 因此是 `/`，站台服務在根路徑而不是 `/huan/`。
- 記得把 **Enforce HTTPS** 打開。這不只是安全性問題：`configure-pages` 回報的 `origin` 會跟著變成 `https://`，而那個值會寫進 `llms.txt` 與各頁 Markdown 的絕對連結。沒打開的話，AI 工具拿到的會是一整份 `http://` 連結。

```sh
gh api repos/<owner>/<repo>/pages | jq '{cname, https_enforced, html_url}'
```

## 本機預覽

```sh
pnpm docs:dev              # 開發伺服器
pnpm docs:build            # SSG 建置到 apps/docs/doc_build
pnpm --filter @huan/docs preview   # 預覽建置結果
```

想在本機重現子路徑的情況：

```sh
DOCS_BASE=/huan/ DOCS_SITE_ORIGIN=https://linyao-tw.github.io pnpm docs:build
```
