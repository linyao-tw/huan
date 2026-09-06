# 快速開始

這一頁把 HUAN 從零跑起來，包含後台、Server、Worker 與一台模擬裝置。

## 需求

| 項目    | 版本                           |
| ------- | ------------------------------ |
| Node.js | 24 LTS（見 `.nvmrc`）          |
| pnpm    | 12                             |
| Docker  | 用於 PostgreSQL 與 RustFS      |
| FFmpeg  | 只有在本機直接跑 Worker 時需要 |

```sh
npm install --global corepack@latest
corepack enable pnpm
```

## 1. 安裝與設定

```sh
git clone https://github.com/linyao-tw/huan.git
cd huan
pnpm install
cp .env.example .env
```

打開 `.env`，把 `POSTGRES_PASSWORD` 與 `S3_SECRET_ACCESS_KEY` 換成你自己的值，並確認 `DATABASE_URL` 裡的密碼一致。

## 2. 啟動 PostgreSQL 與 RustFS

```sh
pnpm docker:up
```

這會啟動兩個容器並等到它們通過健康檢查。

## 3. 建立資料表

```sh
pnpm db:migrate
```

## 4. 建立第一個管理員

HUAN **沒有公開註冊**，也沒有預設密碼。第一個最高權限帳號由 CLI 建立：

```sh
pnpm --filter @huan/server admin:create
```

指令會互動式地詢問 Email、帳號、顯示名稱與密碼。密碼至少 12 個字元。

在 Docker 環境或自動化流程裡可以改用非互動模式：

```sh
HUAN_ADMIN_PASSWORD='…' pnpm --filter @huan/server admin:create \
	--email you@example.com --username admin --display-name 管理員
```

## 5. 啟動開發環境

```sh
pnpm dev
```

這會同時啟動：

| 服務   | 位址                    |
| ------ | ----------------------- |
| Admin  | <http://localhost:5173> |
| Server | <http://localhost:4000> |
| Worker | 背景執行                |

用剛才建立的帳號登入 <http://localhost:5173/login>。

## 6.（選用）載入示範資料

想要一組可以直接點的內容：

```sh
pnpm db:seed
```

種子資料包含幾台不同狀態的裝置、幾筆不同處理狀態的素材、一份 70/30 的已發布版面，以及早餐與午餐兩筆排程。

::: warning 只供開發使用種子資料的帳號密碼會在執行時印在終端機上，並附帶明確的警告。**絕對不要在正式環境執行 seed。** :::

## 7. 啟動一台模擬裝置

不需要準備 Raspberry Pi 就能走完整條流程：

```sh
pnpm dev:device-sim
```

終端機會顯示一組 `XXXX-XXXX` 配對碼。到後台的 `/pair` 輸入這組配對碼（或直接開啟終端機印出的網址），確認裝置資訊後綁定。

綁定後模擬裝置會：

1. 連上 WebSocket
2. 取得目標狀態
3. 下載需要的素材並驗證 SHA-256
4. 回報 ACK
5. 開始送 heartbeat

終端機會即時顯示目前的版面修訂、目標與回報版本，以及素材同步進度。

## 8. 走一次完整流程

1. **上傳影片**：`/app/media` → 拖入一支 MP4。狀態會依序變成上傳中 → 處理中 → 就緒。
2. **建立版面**：`/app/layouts` → 新增 1920×1080 的版面。
3. **切分畫面**：在編輯器裡對根區塊做水平分割，把比例拖到 70/30。
4. **放內容**：把影片從左側素材面板拖進左邊的區塊，右邊的區塊放一段文字。
5. **發布**：按發布，建立第一個修訂。
6. **指派**：到 `/app/devices/:id` 把這份版面設為裝置的預設版面。
7. **觀察**：模擬裝置會收到通知、下載影片、驗證雜湊、切換版面，後台的回報版本會跟上目標版本。
8. **測試離線**：`docker compose -f docker/compose.yaml stop`，模擬裝置會繼續播放並持續重試連線。

## 啟動 Electron 播放器

```sh
pnpm dev:device
```

開發模式下是視窗模式；正式打包後預設全螢幕 kiosk。

## 接下來

- [核心概念](/guide/concepts)
- [Docker 部署](/deployment/docker)
- [管理員手冊](/admin/login)
