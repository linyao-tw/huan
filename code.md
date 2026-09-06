# HUAN 讙 — 完整產品開發任務

你現在要負責從現有 repository 開始，完整設計並實作 **HUAN 讙**。

HUAN 是一套跨平台、雲端管理的 Digital Signage / Media Display 系統，用來讓使用者從 Web 後台設計畫面、上傳影片／圖片／HTML、輸入文字、安排播放時段，並將內容派送到 Raspberry Pi、Windows、Ubuntu、macOS 等裝置播放。

這不是 prototype、mockup 或單純 scaffold。

**請實作成可以實際啟動、測試、部署與使用的完整 MVP。**

不要只建立資料夾、interface、TODO 或 placeholder 後就停止。

在沒有真正阻塞的情況下，不要一直詢問我技術細節；請根據以下規格做合理的工程決策並持續完成。

---

# 0. 既有條件

## Package manager

使用：

```text
pnpm
```

專案為：

```text
pnpm monorepo
```

不要使用 npm / yarn。

---

## Prettier

Repository 已經設定好 Prettier。

**不要取代、重建或大幅修改現有 Prettier 設定。**

請先讀取現有：

```text
package.json
.prettierrc*
prettier.config.*
.editorconfig
```

並遵循既有格式。

---

# 1. 品牌

產品名稱：

```text
HUAN
讙
```

中文產品描述：

> 跨平台的雲端媒體播放與數位看板系統，支援影片、圖片與文字內容，並可從遠端集中上傳、排程、同步與管理多台播放裝置。

產品主要語言：

```text
繁體中文（zh-TW）
```

程式碼：

```text
English
```

UI 文案、文件：

```text
繁體中文
```

---

# 2. UI Design System

**所有 UI 必須使用：**

```text
@linyao.tw/ui@1.3.0
```

範圍包含：

* Landing Page
* Login
* Admin
* Device UI
* Pairing UI
* Layout Editor
* User Management
* Documentation 自訂 UI
* Dialog
* Button
* Input
* Form
* Table
* Card
* Alert
* Navigation
* Tabs
* Badge
* Dropdown
* Toast
* Empty State
* Loading State
* Error State

不要額外導入：

* shadcn/ui
* Material UI
* Ant Design
* Chakra
* Mantine
* Bootstrap

或其他競爭型 UI component library。

在開始做 UI 前，先實際 inspect：

```text
@linyao.tw/ui@1.3.0
```

的：

* exports
* TypeScript types
* README
* package documentation
* design guideline
* design tokens
* component API

**不要憑空猜測 component API。**

如果某些能力 @linyao.tw/ui 沒有提供，可以自己寫行為層或 CSS，但外觀必須遵循該 library 的 design system。

Drag & Drop、editor engine 等非視覺工具 library 可以依需要採用套件。其實元件 repo 就在 /Users/em/ui/，如果是遇到套件本身有問題不要用自己寫 patch，應該去源頭修。push main 就會有 snapshot release 你可以安裝。

---

# 3. Import 規範

禁止這種跨層級 import：

```ts
import { foo } from '../../../shared/foo';
```

原則：

## Package 內部

使用：

```ts
import { foo } from '@/lib/foo';
```

## Package 之間

使用 workspace package：

```ts
import { DeviceSchema } from '@huan/protocol';
```

不要使用：

```text
../../
../../../
../../../../
```

建立正確的：

* tsconfig paths
* package exports
* Vite aliases
* Electron aliases
* test aliases

確保 production build 也能解析，不可以只是 TypeScript IDE 看得懂。

---

# 4. 技術棧

## Monorepo

使用 pnpm workspace。

建議架構：

```text
huan/
├─ apps/
│  ├─ admin/
│  ├─ server/
│  ├─ worker/
│  ├─ device/
│  └─ docs/
│
├─ packages/
│  ├─ protocol/
│  ├─ config/
│  ├─ layout-engine/
│  └─ shared/
│
├─ docker/
├─ scripts/
├─ .github/
├─ pnpm-workspace.yaml
├─ package.json
├─ AGENTS.md
└─ CLAUDE.md
```

可以依實際需求微調，但不要不必要地拆成數十個 package。

優先保持架構清楚。

---

# 5. Admin

技術：

```text
React
TypeScript
TanStack Query
React Router
CSR
Vite
```

Admin 不做 SSR。

路由至少包含：

```text
/
 /login

/app
/app/media
/app/layouts
/app/layouts/:id
/app/schedules
/app/devices
/app/devices/:id
/app/security

/app/users
```

`/app/users` 僅最高權限管理員可以使用。

另外需要：

```text
/pair
```

處理 Device pairing code。

---

# 6. Landing Page

首頁 `/` 為 HUAN 產品 Landing Page。

至少包含：

* HUAN / 讙品牌
* 產品一句話介紹
* 功能介紹
* 支援平台
* Digital Signage 使用情境
* 遠端管理
* 排版
* 排程
* Offline playback
* Raspberry Pi
* Windows
* Ubuntu
* macOS
* CTA

購買方式：

```text
Email 詢問
```

不要建立付款功能。

Email 直接寫死 contact@linyao.tw

---

# 7. Server

使用：

```text
Fastify
TypeScript
PostgreSQL
```

Server 必須負責：

* Auth
* User
* TOTP
* Media metadata
* Device
* Pairing
* Layout
* Schedule
* WebSocket
* Desired state
* Reported state
* Asset distribution
* Signed URL
* Audit Log
* Worker jobs
* Admin API

API 做清楚 schema validation。

建立共享 package：

```text
@huan/protocol
```

放：

* API schemas
* WebSocket message schemas
* Device schemas
* Layout schemas
* Media schemas
* Schedule schemas

Admin、Server、Device 共用。

不要三邊各自重寫同一套 type。

---

# 8. Database

使用：

```text
PostgreSQL
```

需要正式 migration。不過在我說發佈之前都不需要考慮 migration、乾淨就好。

可以選擇成熟且適合 TypeScript 的 migration / query solution，例如 Drizzle，但必須：

* 有 migration
* 有 typed query
* Docker deploy 能正常跑
* Test 能建立乾淨 DB

資料至少包含：

```text
users
sessions
totp
totp_recovery_codes

devices
device_credentials
device_pairing_codes

media_assets
media_variants
media_device_sync

layouts
layout_revisions

schedules

worker_jobs

audit_logs
```

依合理 normalization 調整。

---

# 9. 登入／帳號

不開放註冊。

**不存在公開 `/register`。**

登入：

```text
Email / Username
Password
```

Password 使用現代、安全 password hashing，例如：

```text
Argon2id
```

不可明文儲存。

---

# 10. 最高權限帳號

系統存在：

```text
super_admin
```

權限：

* 建立使用者
* 停用使用者
* 修改使用者
* 重設使用者密碼
* 管理所有 device
* 查看 audit log

一般 User：

* 不可以管理其他使用者
* 只能操作有權限的 HUAN device / media / layout

不要提供公開註冊。

提供一個安全的一次性 CLI：

```text
pnpm --filter @huan/server admin:create
```

用來建立第一個 super admin。

Docker 環境也要可以執行。

不要把預設管理員密碼寫在 source code。

---

# 11. Session Security

Browser auth 優先使用安全的 server-side session / opaque session token。

Cookie：

```text
HttpOnly
Secure（production）
SameSite
```

不要把長期 auth token 存在 localStorage。

實作：

* Login rate limit
* Password attempt protection
* Session revoke
* Logout
* Audit log

---

# 12. TOTP 2FA

User 可以到：

```text
/app/security
```

啟用：

```text
TOTP 2FA
```

流程：

```text
Password confirmation
↓
Generate secret
↓
QR Code
↓
User scan
↓
輸入 OTP 驗證
↓
Enable
```

遵循標準 TOTP / RFC 6238。

必須提供：

```text
Recovery Codes
```

Recovery codes：

* 顯示一次
* Server 只保存 hash
* 使用後失效

TOTP secret 不可明文直接暴露於 log。

登入流程：

```text
帳號密碼
↓
如果沒有 2FA → login
↓
如果有 2FA → TOTP challenge
↓
success
```

---

# 13. Media Upload

Admin 可以上傳：

```text
Video
Image
HTML
```

文字與網址不需要上傳。

上傳流程不要讓大型檔案經過 Fastify memory。

使用 RustFS 的 S3-compatible API：

```text
Admin
↓
Server 取得 upload authorization / signed URL
↓
Browser
↓
直接上傳 RustFS
```

Server 保存 metadata。

---

# 14. RustFS

Object Storage：

```text
RustFS
```

透過 S3-compatible API 使用。

**RustFS 不是 HUAN 的永久素材庫。**

它主要負責：

1. 原始檔短暫 staging
2. FFmpeg Worker input/output
3. Admin Web preview
4. Thumbnail
5. 裝置下載前的 temporary distribution

素材的正式播放副本最終保存在 Device。

建立明確 bucket/key namespace，例如：

```text
uploads/
processing/
preview/
thumbnail/
distribution/
```

禁止把使用者 filename 直接拿來當 object key。

使用：

```text
UUID / content hash
```

避免 path traversal / collision。

---

# 15. Media Lifecycle

這部分一定要正確實作。

## Step 1

User upload：

```text
Original
↓
RustFS uploads/
```

DB：

```text
UPLOADED
```

## Step 2

建立 worker job：

```text
TRANSCODE
```

## Step 3

Worker：

```text
ffprobe
↓
transcode
↓
thumbnail
↓
preview
↓
playback artifact
```

## Step 4

原始檔成功處理後：

```text
delete original
```

不要永久保存原始影片。

## Step 5

保留：

```text
preview / thumbnail
```

讓 Admin 可以排版與預覽。

## Step 6

當某 Layout / Schedule 指派給 Device：

```text
distribution artifact
↓
signed download URL
↓
Device
```

## Step 7

Device：

```text
download
↓
checksum
↓
atomic move
↓
ACK
```

Server 必須紀錄：

```text
device_id
asset_id
version
checksum
downloaded_at
```

## Step 8

只有當所有目前目標 Device 都 ACK 成功後：

才可以清除該次 distribution playback artifact。

不能第一台下載成功就刪除。

加入合理 grace period，避免 ACK 與重試 race condition。

---

# 16. Media Recovery Limitation

因為產品明確設計成：

> Server 不永久保存完整播放素材

所以必須在 UI 與文件清楚呈現此 trade-off。

如果：

* 原始檔已刪除
* distribution artifact 已清除
* 後來新增新的 Device
* 舊 Device 清掉 local storage
* 使用者要重新分發舊素材

而 RustFS 已沒有可播放版本：

該 Asset 必須標示：

```text
需要重新上傳
```

不要假裝 Server 還有不存在的原始素材。

程式資料模型必須能表示這個狀態。

---

# 17. FFmpeg Worker

獨立：

```text
apps/worker
```

Docker container。

不要讓 Fastify process 同步執行大型 FFmpeg。

使用 PostgreSQL-backed job queue 即可，不要為了這個 MVP 強制加入 Redis。

可以使用：

```text
SELECT ... FOR UPDATE SKIP LOCKED
```

或其他可靠 PostgreSQL queue pattern。

Worker job 必須支援：

```text
PENDING
RUNNING
SUCCESS
FAILED
```

以及：

* attempt
* error
* started_at
* finished_at
* retry

---

# 18. Video Processing

使用：

```text
FFmpeg
FFprobe
```

目標是：

> 小、通用、容易讓 Raspberry Pi / Windows / Ubuntu / macOS 播放。

預設 target：

```text
Container: MP4
Video: H.264
Pixel Format: yuv420p
Max Resolution: 1920x1080
Max FPS: 30
Audio: AAC
Fast Start: enabled
```

不要 upscale。

保持原始 aspect ratio。

建立：

```text
thumbnail
preview
playback
```

三種概念。

Thumbnail 不需要 1080p。

Preview 使用較小 resolution / bitrate。

Playback 才是 Device 用的版本。

Worker 必須用 ffprobe 取得：

* duration
* width
* height
* codec
* fps
* audio
* file size

並寫入 DB。

---

# 19. Image Processing

圖片上傳後產生適合 Admin 預覽的 thumbnail。

Device playback image 限制在合理尺寸，不要讓 Raspberry Pi 每次 render 12000×9000 的原圖。

保持 aspect ratio。

如果圖片有 alpha channel，要避免不必要地破壞透明資訊。

---

# 20. Device App

使用：

```text
Electron
TypeScript
React
```

Device 目標平台：

```text
Raspberry Pi OS 64-bit ARM64
Ubuntu x64
Ubuntu ARM64

Windows x64
Windows ARM64（若 Electron/runtime 支援）

macOS x64
macOS ARM64
```

禁止把產品綁死 Raspberry Pi。

---

# 21. Electron Architecture

遵循：

```text
Main Process
↓ IPC
Renderer
```

Main Process：

* Device identity
* API
* WebSocket
* Asset downloader
* Scheduler
* Local state
* Storage
* Update state
* Health
* Display detection

Renderer：

* Pairing
* Video
* Image
* Text
* Ticker
* iframe
* HTML
* Layout rendering

不要讓 renderer 直接擁有 Node 完整權限。

Electron：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

preload 只 expose 最小 API。

建立 CSP。

不要因為播放 HTML 就關掉 Electron security。

---

# 22. Device Local Storage

不要依賴 Server 在線才能播放。

Device 本機建立：

```text
appData/
├─ config/
├─ state/
├─ media/
├─ manifests/
└─ logs/
```

資料寫入使用 atomic strategy：

```text
write temp
↓
fsync / close
↓
rename
```

避免突然斷電讓 manifest 損壞。

Device 必須保存：

* device identity
* credential
* current desired state
* current reported state
* media manifest
* schedules
* downloaded checksum
* current layout

---

# 23. Offline-first

這是核心 requirement。

如果網路突然斷線：

```text
HUAN 必須繼續播放目前內容。
```

不能：

```text
Internet down
↓
black screen
```

新版本同步必須：

```text
Current Version A
↓
背景下載 Version B 所需全部 Asset
↓
verify checksum
↓
全部 ready
↓
atomic activate B
```

任何 asset 下載失敗：

```text
繼續播放 Version A
```

不能先刪 Version A。

新版本成功啟用並經過合理保留時間後，再 garbage collect 未使用素材。

---

# 24. Device Pairing

Device 第一次開啟：

顯示：

```text
HUAN
讙

XXXX-XXXX
```

以及：

```text
QR Code
```

Pairing code：

* random
* short-lived
* single-use
* server-side expiry
* 不可 predict

QR Code 指向：

```text
/pair?code=...
```

登入中的 Admin 使用者掃描後：

```text
確認 Device
↓
Bind
```

Device 顯示：

```text
已綁定
```

並進入 Player。

---

# 25. Device Identity

Device 建立 stable identity。

Pairing 完成後取得：

```text
device-specific credential
```

不同 Device 不可共用 secret。

Server 必須能：

```text
revoke device
```

credential 儲存要使用 Electron / OS 可提供的安全能力，避免明文暴露。

---

# 26. Device Unbind

綁定後 Device：

**不能在本機修改 Layout、Media、Schedule。**

本機只允許：

* 查看 Device 基本資訊
* Network / connection status
* Pairing state
* 解除綁定

提供：

```text
解除綁定
```

必須二次確認。

解除後：

```text
revoke credential
clear account binding
return pairing screen
```

不要留下舊帳戶仍可遠端控制的 credential。

如果 offline 時使用者解除綁定：

* 本機立即停止 account control
* 安全保留 revoke pending state
* 下次 online 完成 server revoke
* 不可以因為 pending revoke 又恢復舊 account control

---

# 27. Device Communication

不要每 10 秒完整 fetch 所有資料。

正常模式：

```text
WebSocket
```

用途：

```text
notification / command
```

例如：

```json
{
  "type": "desired_state_changed",
  "version": 42
}
```

WebSocket 不傳大型素材。

---

# 28. Source of Truth

WebSocket 只做：

```text
有東西變了
```

真正 state：

```text
HTTPS REST API
```

Device 收到：

```text
desired_state_changed
```

之後：

```text
GET current desired state
```

Server REST API 是 source of truth。

---

# 29. Fallback Sync

不能完全依賴 WebSocket。

實作：

```text
WebSocket notification
+
每 5 分鐘 fallback state sync
```

Heartbeat：

```text
約 60 秒
```

WebSocket reconnect：

```text
exponential backoff
+
jitter
```

例如概念：

```text
1s
2s
4s
8s
16s
30s
60s max
```

加入 random jitter，避免大量 Device 同時 reconnect。

---

# 30. Desired / Reported State

Server 保存：

```text
desired_state
```

Device 回報：

```text
reported_state
```

不要把裝置控制設計成大量 imperative RPC。

Server：

```text
Device 應該是 Layout revision 42
```

Device：

```text
我現在是 41
↓
下載
↓
verify
↓
activate
↓
reported = 42
```

這是核心同步模型。

---

# 31. Device Heartbeat

Heartbeat 回報至少：

```text
device id
online
platform
architecture
app version
current layout version
current media
screen resolution
disk free
last sync
uptime
```

Raspberry Pi 可取得溫度時可以回報：

```text
temperature
```

Windows/macOS 無法取得就：

```text
null
```

不要為了統一型別 fake 數值。

---

# 32. Display Detection

Device 可以偵測：

```text
display width
display height
scale factor
orientation
```

回報 Server。

建立 Layout 時可選：

```text
手動設定 canvas
```

或：

```text
Use Device Resolution
```

如果 Device 有多個 display，至少能選擇主要 display。

架構保留未來多 display 能力。

---

# 33. Layout Editor

這是 Admin 的核心功能。

建立 Layout 前設定：

```text
width
height
```

例如：

```text
1920 × 1080
1080 × 1920
3840 × 2160
```

也可以：

```text
從 Device 自動取得
```

---

# 34. Recursive Split Layout

不要使用自由拖曳 absolute-position editor 當核心資料模型。

使用：

```text
recursive split tree
```

任何 Region：

```text
Region
```

都可以被：

```text
Split Horizontal
```

或：

```text
Split Vertical
```

切成：

```text
2 個 Region
```

例如：

```text
root
├─ left 70%
└─ right 30%
```

right 又可以：

```text
right
├─ top 50%
└─ bottom 50%
```

Schema 概念：

```ts
type LayoutNode =
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    }
  | {
      type: 'slot';
      content: SlotContent | null;
    };
```

`ratio` 使用比例而不是固定 pixel width / height。

例如：

```text
0.25 / 0.75
```

因此不同裝置尺寸仍可以 RWD。

---

# 35. Split Editor

使用者可以：

* Split horizontal
* Split vertical
* Drag divider
* Delete split
* Swap region content
* Empty region
* Select region

Ratio 有合理 min/max：

避免產生：

```text
0.001 / 0.999
```

這種不可操作版面。

---

# 36. Global Layout Settings

Layout 可以設定：

```text
background color
background image
gap
```

Gap：

```text
px
```

Preview 與 Device renderer 必須使用同一 layout engine。

不要 Admin 算一套，Device 又重寫另外一套。

建立：

```text
@huan/layout-engine
```

讓：

```text
Admin preview
Device renderer
```

共用：

* split algorithm
* ratio calculation
* gap behavior
* scaling
* serialization

---

# 37. Region Content Types

每個 Slot 可以放：

```text
Text
Ticker
Image
Video
URL
HTML
```

---

# 38. Text

Text 支援：

```text
content
background color
text color
font size
font weight
alignment
vertical alignment
padding
```

Font family 固定：

```text
sans-serif
```

不要做 font upload。

---

# 39. Ticker

Ticker 設定同 Text，另外提供：

```text
direction
speed
gap
```

至少支援：

```text
right → left
```

動畫應保持流暢。

不要用每 frame React state update。

用 CSS animation / performant animation。

---

# 40. Image

設定至少：

```text
fit
```

提供合理值：

```text
contain
cover
fill
```

預設使用不變形策略。

---

# 41. Video

Video：

* autoplay
* muted / volume policy
* loop
* object fit

Device 播放 local downloaded file。

不要正常播放時 stream RustFS。

播放素材必須先下載本地。

---

# 42. URL iframe

User 可以輸入：

```text
https://...
```

Region 顯示 iframe。

注意：

外部網站可能有：

```text
X-Frame-Options
CSP frame-ancestors
```

導致不能 embed。

Admin 必須清楚顯示這個限制。

不要試圖繞過網站的 iframe security policy。

---

# 43. Uploaded HTML

允許上傳：

```text
.html
```

第一版支援單一 self-contained HTML。

如果使用者需要 asset，可以使用 inline：

```text
data:
```

不要第一版就實作完整網站 ZIP hosting。

HTML 必須以 sandboxed iframe 執行。

**禁止 Node access。**

不得讓上傳 HTML：

* require()
* fs access
* Electron API
* preload privileged API
* arbitrary local file access

Renderer 使用安全 custom protocol / blob / sandbox strategy。

---

# 44. Drag & Drop

Layout Editor：

素材可以從 Media Panel：

```text
drag
↓
slot
```

也可以：

```text
slot A
drag
↓
slot B
```

直接交換內容。

不是 copy 時要正確 swap。

Empty slot drop：

```text
move
```

操作要有清楚 visual feedback。

---

# 45. Layout Revisions

不要直接覆蓋 production layout。

每次 publish 建立：

```text
layout revision
```

例如：

```text
Layout 3
Revision 14
```

Device desired state 指向：

```text
revision id
```

這樣才可以：

* audit
* rollback
* 判斷 Device version
* atomic update

Draft 和 Published 分離。

---

# 46. Scheduling

建立：

```text
Schedule
```

至少支援：

```text
start date/time
end date/time
days of week
time of day
timezone
layout revision
target device
```

例如：

```text
Mon-Fri
08:00-11:00
Breakfast Layout

Mon-Fri
11:00-14:00
Lunch Layout
```

定義 schedule conflict priority。

不要遇到兩個 schedule 就隨機選。

例如：

```text
priority
↓
specificity
↓
updated_at
```

或者其他 deterministic 規則。

寫進文件。

---

# 47. Offline Schedule

Device 必須下載：

```text
schedule manifest
```

因此 Server offline：

```text
Device 仍然照時間切換 Layout。
```

這非常重要。

不要每次到時間都問 Server：

```text
現在要播什麼？
```

---

# 48. Device Management UI

Admin 顯示：

```text
Device Name
Online / Offline
Platform
Architecture
Screen Resolution
App Version
Last Seen
Current Layout
Desired Version
Reported Version
Disk Space
Last Sync
```

可以：

```text
Rename
Bind
Unbind
Force Sync
Restart Player
```

任何 dangerous action 都要確認。

---

# 49. Media UI

至少包含：

```text
Grid/List
Upload
Processing state
Preview
Thumbnail
Type
Dimensions
Duration
Size
Codec
Created at
Usage
Delete
```

Processing：

```text
Uploading
Processing
Ready
Failed
Needs Re-upload
```

Worker error 要能查看合理 error message。

不要把完整 FFmpeg command / sensitive filesystem path 暴露給一般 User。

---

# 50. Delete Media

如果 Asset 正在被：

* Draft layout
* Published layout
* Schedule
* Device current state

使用：

不要無提示直接刪除。

顯示 dependency。

可以：

```text
阻止刪除
```

或要求使用者先解除引用。

---

# 51. Server → Device Asset Manifest

每個 Device desired state 至少包含：

```text
layout revision
schedule revision
assets
checksum
size
download url / asset identifier
```

Signed URL 必須 short-lived。

Device 如果 signed URL expired：

```text
重新向 Server 取得
```

不是整個 sync fail。

---

# 52. Checksum

所有 distribution file 使用：

```text
SHA-256
```

Device：

```text
download temp
↓
sha256
↓
compare
↓
rename to final
↓
ACK
```

checksum mismatch：

```text
delete temp
retry
```

不能 ACK。

---

# 53. Device Player

Renderer 必須支援：

```text
Video
Image
Text
Ticker
URL iframe
Uploaded HTML
```

每個 slot 都必須正確 clipping。

Window：

```text
fullscreen / kiosk-like
```

預設不顯示 OS desktop。

開發模式可以 windowed。

---

# 54. Device Local UI

未綁定：

```text
Pairing Screen
```

已綁定：

```text
Player
```

Local settings 不提供內容編輯。

可以透過合理方式打開 Device info，例如：

```text
system tray
menu
keyboard shortcut
```

但不要影響正常 kiosk 播放。

Local UI 只允許：

* device info
* connection
* unbind

---

# 55. Electron Platform Adapter

不要到處寫：

```ts
if (process.platform === 'win32')
```

建立：

```ts
PlatformAdapter
```

例如：

```ts
interface PlatformAdapter {
  getDisplays(): Promise<DisplayInfo[]>;
  getDiskInfo(): Promise<DiskInfo>;
  getTemperature(): Promise<number | null>;
  getUptime(): Promise<number>;
}
```

建立：

```text
LinuxAdapter
WindowsAdapter
MacOSAdapter
```

共用核心程式碼。

---

# 56. Cross-platform

避免沒有必要的 native Node addon。

每新增 dependency 都要考慮：

```text
linux-arm64
linux-x64
win-x64
win-arm64
darwin-x64
darwin-arm64
```

如果 dependency 會讓 ARM cross-platform packaging 困難，優先找純 JS / Web API / Electron built-in 解法。

---

# 57. Device Packaging

提供正式 build scripts。

至少：

```text
Linux x64
Linux ARM64
Windows x64
Windows ARM64（可行時）
macOS x64
macOS ARM64
```

Raspberry Pi 使用：

```text
Linux ARM64 build
```

建立清楚 artifact naming：

```text
HUAN-Device-<version>-linux-arm64.*
HUAN-Device-<version>-win-x64.*
HUAN-Device-<version>-darwin-arm64.*
```

---

# 58. Raspberry Pi

正式 Raspberry Pi target：

```text
Raspberry Pi 4+
Raspberry Pi OS 64-bit
```

最低推薦：

```text
Pi 4 2GB
```

建議：

```text
Pi 4 4GB
```

Device 不可以假設一定存在：

```text
apt
vcgencmd
systemd
```

這些要透過 PlatformAdapter。

---

# 59. Docker Deployment

Server-side 全部使用 Docker。

建立：

```text
compose.yaml
```

至少包含：

```text
postgres
rustfs
server
worker
```

Admin production build 可以由 Server 靜態提供，或使用獨立 container；選擇較簡潔且合理的方式。

Docs 不放 Docker production：

```text
GitHub Pages
```

---

# 60. Docker 要求

每個 container：

* healthcheck
* restart policy
* non-root where practical
* persistent volume
* environment validation
* pinned dependency/image version
* production build
* no dev server

建立：

```text
.env.example
```

不要 commit secret。

---

# 61. Server Health

提供：

```text
GET /health/live
GET /health/ready
```

readiness 至少檢查：

```text
PostgreSQL
```

RustFS 是否需要列入 ready 依你的 failure model 決定，但請明確處理。

---

# 62. Audit Log

記錄重要操作：

* login
* failed login
* enable 2FA
* disable 2FA
* create user
* disable user
* device pair
* device unbind
* publish layout
* change schedule
* delete media
* force sync

欄位：

```text
actor
action
target
timestamp
ip where relevant
metadata
```

不要把：

* password
* TOTP secret
* recovery code
* session token
* device credential

寫入 audit log。

---

# 63. Security

所有 user-controlled input 都要驗證。

特別處理：

```text
HTML upload
iframe URL
filename
object key
media metadata
pairing code
WebSocket auth
```

防止：

* path traversal
* XSS
* SQL injection
* command injection
* FFmpeg argument injection
* arbitrary file access
* Electron RCE
* CSRF where applicable

FFmpeg command 不要直接拼接 user-supplied shell string。

使用 spawn argument array。

---

# 64. Admin UX

必須有：

* Loading
* Empty
* Error
* Retry
* Success
* Disabled
* Processing

不要只有 happy path。

尤其：

```text
Upload processing
Device offline
Asset missing
Worker failed
Pairing expired
Iframe blocked
```

要有清楚 UI。

---

# 65. TypeScript

開：

```text
strict
```

避免：

```ts
any
```

除非有非常具體理由。

不要大量使用：

```ts
as unknown as ...
```

逃避 type system。

---

# 66. Logging

Server / Worker / Device 使用 structured logging。

包含：

```text
request id
device id
job id
asset id
```

但不可 log：

```text
password
token
TOTP secret
signed URL query secret
device credential
```

Production log 不要 dump 全 request body。

---

# 67. Tests

這個專案不能只有 compile。

建立：

## Unit tests

至少：

* Layout split tree
* ratio
* layout serialization
* schedule conflict
* desired/reported state
* asset manifest
* checksum
* TOTP
* permissions

## API integration tests

至少：

* Login
* 2FA
* User permissions
* Pairing
* Layout publish
* Schedule
* Media flow
* Device ACK

## Worker tests

用 FFmpeg 自己產生 tiny test fixture，例如：

```text
testsrc
```

不要 commit 大型 copyrighted test video。

測：

```text
input
↓
ffprobe
↓
transcode
↓
thumbnail
↓
output metadata
```

## E2E

使用 Playwright。

至少：

```text
login
create layout
split region
add content
publish
pair simulated device
schedule
```

---

# 68. Device Simulation

建立一個方便開發的：

```text
mock / simulated device
```

不要每次測 Server 都需要真的 Raspberry Pi。

它至少能：

```text
pair
connect WebSocket
fetch desired state
simulate download ACK
send heartbeat
report state
```

最好提供：

```text
pnpm dev:device-sim
```

---

# 69. Documentation

文件：

```text
Rspress
SSG
繁體中文
GitHub Pages
```

App：

```text
apps/docs
```

Production：

```text
rspress build
```

必須是 SSG。

---

# 70. AI-friendly Documentation

Rspress config 必須啟用：

```ts
llms: true
```

讓 build 產生：

```text
llms.txt
llms-full.txt
*.md
```

設定：

```text
siteOrigin
base
```

確保 GitHub Pages subpath 與 AI markdown links 正確。

如果目前 Rspress 版本的 built-in SSG-MD 有 compatibility 問題，再使用官方建議的 llms plugin fallback。

不要自己手寫一份過期的 llms.txt generator。

---

# 71. AGENTS.md / CLAUDE.md

Repository root 建立高品質：

```text
AGENTS.md
```

內容至少：

* Project overview
* Architecture
* Workspace structure
* Commands
* Coding rules
* Import rules
* Testing
* Database
* Device protocol
* Media lifecycle
* Documentation
* Security constraints

建立：

```text
CLAUDE.md
```

引用：

```text
@AGENTS.md
```

不要把兩份文件 copy-paste 成兩套容易不同步的內容。

---

# 72. Docs Structure

至少包含：

```text
首頁
快速開始

架構
├─ 系統架構
├─ Server
├─ Worker
├─ Device
├─ Asset Lifecycle
└─ Desired / Reported State

部署
├─ Docker
├─ Environment Variables
├─ PostgreSQL
├─ RustFS
└─ GitHub Pages

管理員
├─ 登入
├─ 2FA
├─ 使用者
├─ 素材
├─ 排版
├─ 排程
└─ 裝置

Device
├─ Raspberry Pi
├─ Windows
├─ Ubuntu
├─ macOS
├─ 配對
├─ 離線播放
└─ 解除綁定

開發
├─ Monorepo
├─ Commands
├─ Testing
├─ Protocol
└─ Release

Troubleshooting
```

---

# 73. 文件截圖

**文件一定要有實際產品截圖。**

不要放 placeholder。

使用 Playwright：

```text
啟動 seed environment
↓
建立 demo data
↓
登入
↓
進入真正 UI
↓
capture screenshots
```

至少截：

* Landing
* Login
* Dashboard
* Media
* Layout Editor
* Schedule
* Devices
* Pairing
* 2FA
* User Management

圖片放在：

```text
apps/docs/public/
```

或 Rspress 適合的 static path。

建立可重複執行的 screenshot script，例如：

```text
pnpm docs:screenshots
```

Screenshot 內容必須使用 deterministic seed data，避免每次文件亂掉。

---

# 74. 文件 UI

文件中的自訂 React UI 也遵循：

```text
@linyao.tw/ui@1.3.0
```

不要在 docs 又導入第二套 component library。

Rspress framework 本身必要的 theme infrastructure 可以保留，但自訂 UI 必須遵循 HUAN design system。

---

# 75. GitHub Pages

建立 GitHub Actions：

```text
.github/workflows/docs.yml
```

流程：

```text
checkout
pnpm setup
node setup
pnpm install --frozen-lockfile
build docs
upload Pages artifact
deploy Pages
```

正確處理 repository subpath。

不要 hardcode GitHub username。

---

# 76. CI

建立 GitHub Actions：

```text
ci.yml
```

至少：

```text
install
typecheck
test
build
docs build
```

Docker build 也至少做 smoke validation。

Device release workflow 可以另外建立：

```text
device-release.yml
```

---

# 77. Developer Experience

Root scripts 至少提供類似：

```text
pnpm dev
pnpm dev:admin
pnpm dev:server
pnpm dev:worker
pnpm dev:device
pnpm dev:device-sim

pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e

pnpm docker:up
pnpm docker:down

pnpm db:migrate
pnpm db:seed

pnpm docs:dev
pnpm docs:build
pnpm docs:screenshots
```

命名可以依專案調整，但要一致、文件化。

---

# 78. Seed Data

建立開發 seed：

* super admin
* demo user
* 2-3 devices
* online/offline state
* sample media metadata
* sample layout
* sample schedule

不要把 production credential 放進 seed。

Dev credential 必須明顯標示只供 development 使用。

---

# 79. Layout Editor 一致性

最重要的一條：

```text
Admin Preview
```

和：

```text
Device Playback
```

必須依賴同一套 layout data/schema/engine。

不要產生：

> Admin 看起來是 70/30，但 Device 顯示變成 68/32。

針對不同 resolution 寫 snapshot / visual tests。

至少測：

```text
1920x1080
1280x720
3840x2160
1080x1920
```

---

# 80. Responsive Rule

Layout tree 使用 relative ratio。

Global gap 使用 layout design px。

Device render 時計算：

```text
design canvas
↓
target display
↓
scale
```

定義清楚 aspect ratio 不同時的策略。

第一版可以使用：

```text
contain
```

將整個 design canvas 等比縮放，剩餘區域填 layout background。

不要 silently stretch 到變形。

把這個規則寫進文件。

---

# 81. Scheduling / Timezone

不要用 Server local timezone 當 schedule truth。

Schedule 必須保存：

```text
IANA timezone
```

例如：

```text
Asia/Taipei
```

Device 使用 schedule timezone 正確計算。

處理 DST 地區。

不要只保存 UTC 時分然後假設所有 Device 在台灣。

---

# 82. Media Assignment

Asset 是否需要 distribution 應由：

```text
Published Layout
+
Schedule
+
Target Device
```

決定。

Draft 中尚未 publish 的 asset：

不要自動發送到 Device。

只有實際需要的 assets 才同步。

---

# 83. Device Download Concurrency

不要同時下載 50 個大型影片。

建立 download queue。

例如：

```text
2-3 concurrent files
```

合理 retry。

支援：

```text
resume
```

如果 HTTP/RustFS 支援 Range 可以加入。

至少避免同一 asset 重複下載。

---

# 84. Storage Management

Device 有 local cache limit。

至少實作：

```text
disk free threshold
```

Garbage collection：

永遠不能刪：

```text
current active layout assets
next scheduled layout required assets
currently downloading assets
```

優先刪：

```text
unreferenced
old
unused
```

如果空間不足：

回報 Server：

```text
storage error
```

Admin 顯示。

---

# 85. Error Recovery

Device crash 後：

```text
restart
↓
load last known good state
↓
continue playback
↓
reconnect server
```

不要 boot 後一定要 Server 才能進 Player。

---

# 86. Versioning

Device app 回報：

```text
appVersion
protocolVersion
```

Server protocol 要有 version。

例如：

```text
/api/v1/
```

WebSocket message 也要可以演進。

---

# 87. API Documentation

從 Server schema 產生：

```text
OpenAPI
```

至少 development 可以打開 API docs 或輸出 JSON。

不要人工維護一份跟 API 不同步的接口文件。

---

# 88. README

Root README 使用繁體中文。

至少：

* HUAN 是什麼
* Architecture diagram
* Prerequisites
* Quick Start
* Development
* Docker
* Device
* Docs
* Test
* License placeholder / actual repo license

不要寫不存在的功能。

---

# 89. Architecture Diagram

文件內提供 Mermaid，例如：

```text
Admin
  │
  ├── HTTPS ── Fastify ── PostgreSQL
  │
  └── Upload ── RustFS
                     │
                 FFmpeg Worker
                     │
                 Distribution
                     │
                   Device
```

另外提供：

```text
WebSocket control plane
HTTPS data plane
```

的圖。

---

# 90. 不要 Over-engineer

這是完整 MVP，不是 hyperscale platform。

不要無理由加入：

* Kubernetes
* Kafka
* Redis
* RabbitMQ
* GraphQL
* Microservices mesh
* Elasticsearch

除非真的有不可替代的必要，而且必須在 ADR 解釋。

Fastify + PostgreSQL + RustFS + Worker 已足夠。

---

# 91. ADR

對重要決策建立：

```text
docs/adr/
```

或 Rspress architecture decisions。

至少紀錄：

* Why WebSocket + REST
* Why desired/reported state
* Why temporary object storage
* Why recursive split layout
* Why local-first playback
* Why Electron
* Why PostgreSQL worker queue

保持簡短但有 reasoning。

---

# 92. Implementation Order

不要一次寫一堆孤立 UI。

依 end-to-end vertical slice 開發。

## Phase 1

Infrastructure：

```text
pnpm workspace
PostgreSQL
RustFS
Fastify
React
Electron
Docker
shared protocol
```

確認全部可以 build。

## Phase 2

Auth：

```text
super admin
login
session
TOTP
users
```

做到 UI + API + tests。

## Phase 3

Device pairing：

```text
pairing code
QR
bind
credential
heartbeat
device page
```

做到模擬 device。

## Phase 4

Media：

```text
upload
RustFS
worker
FFmpeg
thumbnail
preview
DB
```

跑真正 FFmpeg integration test。

## Phase 5

Layout：

```text
recursive split
drag/drop
content
preview
revision
```

## Phase 6

Device player：

```text
desired state
download
checksum
render
offline
ACK
```

## Phase 7

Scheduling：

```text
schedule
timezone
offline execution
```

## Phase 8

Hardening：

```text
audit
errors
storage GC
reconnect
security
```

## Phase 9

Docs：

```text
Rspress
screenshots
llms
GitHub Pages
```

## Phase 10

Release：

```text
Docker
Electron builds
CI
Docs deploy
```

---

# 93. 每個 Phase 的完成標準

不要把：

```text
component exists
```

當完成。

必須至少：

```text
UI
↓
API
↓
DB
↓
validation
↓
error handling
↓
test
↓
documentation
```

完整串通。

---

# 94. UI 實作品質

不要做出純 debug dashboard。

HUAN 是要放官網與賣給客戶的產品。

要求：

* Visual hierarchy 清楚
* Responsive
* Keyboard accessible
* Focus state
* Proper label
* Semantic HTML
* Loading skeleton / indicator
* Good empty states
* No raw JSON editor 作為正常 UI
* No browser alert()
* No ugly native confirm()

Dialog / Toast 等使用：

```text
@linyao.tw/ui
```

---

# 95. Accessibility

至少做到合理：

```text
keyboard navigation
aria labels
focus management
contrast
form errors
dialog focus
```

Layout editor drag/drop 必須保留至少基本 keyboard fallback 或替代操作。

---

# 96. 不接受的結果

以下不算完成：

```text
只有 README
只有 wireframe
只有 API interface
只有 database schema
只有 mocked UI
只有 TODO
只有 Docker compose
只有 layout editor demo
```

HUAN 必須可以完整走：

```text
Admin login
↓
upload video
↓
Worker transcode
↓
create layout
↓
split screen
↓
drag video into region
↓
publish
↓
pair Device
↓
Device receives desired state
↓
downloads video
↓
verifies checksum
↓
plays locally
↓
ACK
↓
Server reports synced
↓
RustFS distribution asset eventually cleaned
```

這條 end-to-end flow 必須真的可運作。

---

# 97. 最重要的 End-to-End Acceptance Test

建立 automatic 或 documented reproducible test：

1. `docker compose up`
2. migrate DB
3. seed / create super admin
4. 啟動 Admin
5. 啟動 Device simulator 或 Electron Device
6. 登入
7. Upload test MP4
8. Worker 完成 transcoding
9. Thumbnail 出現在 Media UI
10. 建立 1920×1080 Layout
11. Split 成 70/30
12. 左邊放 Video
13. 右邊放 Text
14. Publish
15. Pair Device
16. Device 收到新 desired state
17. Device 下載影片
18. SHA-256 正確
19. Device 顯示 Layout
20. Server 顯示 reported state 已同步
21. 拔掉／停止 Server connection
22. Device 繼續播放
23. Schedule 到時間後 Device 能依 local manifest 切換
24. reconnect 後自動 reconciliation

---

# 98. 最終驗證

完成前一定實際執行：

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
```

以及：

```text
docker compose build
docker compose up
```

確認核心 health checks。

如果有 Playwright：

```text
pnpm test:e2e
```

也必須跑。

修掉實際 error 後才算完成。

---

# 99. 最終輸出給我

完成後提供清楚摘要：

## 完成內容

列出真正完成的功能。

## Architecture

簡短說明。

## 啟動方式

提供 command。

## Initial Admin

說明如何建立，不要貼 hardcoded 密碼。

## Docker

如何部署。

## Device

如何啟動與打包 Raspberry Pi / Windows / Ubuntu / macOS。

## Documentation

本地與 GitHub Pages。

## Tests

列出實際跑過哪些 tests 以及結果。

## Known Limitations

只列真的還存在的限制。

## Next Steps

只列合理的未來擴充，不要拿未完成 MVP 功能包裝成 future work。

---

# 100. 工作方式

開始前：

1. Inspect 現有 repository。
2. Inspect 現有 Prettier。
3. Inspect package.json。
4. Inspect `@linyao.tw/ui@1.3.0` 的實際 API 與設計規範。
5. 確認目前 codebase 哪些東西已存在。
6. 不要破壞已有合理實作。

然後建立簡短 implementation checklist 並直接開始。

在開發過程中：

* 持續實際執行程式
* 持續 typecheck
* 持續跑 test
* 不要最後才發現整個 monorepo build 不起來
* 不要因為有 compile error 就把 type safety 關掉
* 不要用 fake data 代替應該完成的後端功能
* 不要留下大量 TODO
* 不要任意改掉我的 Prettier
* 不要任意換掉指定技術棧

對非關鍵技術選擇自行做合理決策，不需要每件事詢問我。

如果某個 requirement 在技術上有明顯安全或平台限制：

1. 採取最安全且最接近原需求的實作。
2. 在文件中解釋限制。
3. 繼續完成其他工作。
4. 不要因為一個非關鍵問題停止整個開發。

最終目標不是「生成很多程式碼」。

最終目標是：

> **交付一個可以實際部署、登入、編排、上傳、轉檔、配對、同步、離線播放、排程、測試與閱讀文件的 HUAN 讙 MVP。**
