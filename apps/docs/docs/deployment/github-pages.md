# GitHub Pages

文件站以 Rspress 建置成靜態網站，由 GitHub Actions 部署到 GitHub Pages。

::: warning 只有文件放在 Pages Server、Worker、Admin 與資料庫都用 Docker 部署。GitHub Pages 上只有這份文件。:::

## 啟用

1. GitHub repository → **Settings** → **Pages**
2. **Source** 選 **GitHub Actions**

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

在 `apps/docs/public/` 放一個 `CNAME` 檔案：

```text
docs.example.com
```

然後把 `DOCS_BASE` 改成 `/`（自訂網域沒有子路徑）。

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
