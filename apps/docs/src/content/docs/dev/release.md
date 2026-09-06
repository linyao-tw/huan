---
title: "發布"
description: "三個東西各自有版本："
---

## 版本

三個東西各自有版本：

| 對象                  | 版本來源                               |
| --------------------- | -------------------------------------- |
| Server 與 Worker 映像 | `compose.yaml` 的 `HUAN_VERSION`       |
| Device 應用程式       | `apps/device/package.json`             |
| 協定                  | `@huan/protocol` 的 `PROTOCOL_VERSION` |

裝置在 heartbeat 中同時回報 `appVersion` 與 `protocolVersion`，因此後台可以看到現場有哪些版本，Server 也能據此判斷相容性。

## Server 端

```sh
git pull
pnpm docker:build
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml exec server node apps/server/dist/cli/migrate.js
```

升級期間裝置會繼續播放本機內容。Server 短暫不可用不會造成黑畫面——這是離線優先設計的直接好處。

## Device 端

`.github/workflows/device-release.yml` 在推送 `device-v*` 標籤時觸發：

```sh
git tag device-v0.2.0
git push origin device-v0.2.0
```

Workflow 會在三種 runner 上分別打包：

| Runner           | 產出                       |
| ---------------- | -------------------------- |
| `ubuntu-latest`  | Linux x64、Linux ARM64     |
| `windows-latest` | Windows x64、Windows ARM64 |
| `macos-latest`   | macOS x64、macOS ARM64     |

產物命名遵循固定格式：

```text
HUAN-Device-<version>-linux-arm64.AppImage
HUAN-Device-<version>-win-x64.exe
HUAN-Device-<version>-darwin-arm64.dmg
```

Raspberry Pi 使用 **Linux ARM64** 的版本。

## 簽章

Workflow 預設關閉自動尋找簽章憑證（`CSC_IDENTITY_AUTO_DISCOVERY: false`），讓沒有設定憑證時的失敗原因是明確的「沒有憑證」，而不是難懂的簽章錯誤。

要啟用簽章的話，把憑證放進 repository secrets 並在 workflow 中引用。macOS 的公證另外需要 Apple ID 與 app-specific password。

## 文件

`.github/workflows/docs.yml` 在 `apps/docs/**` 或 `packages/**` 有變動時自動部署到 GitHub Pages。

截圖不是在 CI 產生的——它們需要一整套跑起來的環境。截圖由開發者在本機執行 `pnpm docs:screenshots` 後 commit 進 repository。

## 發布前檢查

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
pnpm test:e2e

docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml up -d
curl -fsS http://localhost:4000/health/ready
```

CI 會跑完上面全部，但在推標籤之前自己跑一次比較快發現問題。
