---
title: "在 Windows 上安裝"
description: "支援 x64 與 arm64。"
---

支援 x64 與 arm64。

## 需求

| 項目   | 需求                             |
| ------ | -------------------------------- |
| 版本   | Windows 10 1809 以上、Windows 11 |
| 架構   | x64 或 arm64                     |
| 記憶體 | 最低 4GB                         |

## 安裝

從 [Releases](https://github.com/linyao-tw/huan/releases) 下載對應架構的安裝檔並執行。

:::tip[未簽章的安裝檔]

安裝檔目前沒有經過程式碼簽章，Windows SmartScreen 會出現警告。選擇「其他資訊」→「仍要執行」。

要消除這個警告需要 EV 程式碼簽章憑證，可以在 CI 的 secrets 裡設定後啟用。

:::

## 開機自動啟動

**工作排程器**（建議）：

1. 開啟工作排程器 → 建立工作
2. 觸發程序：登入時
3. 動作：啟動程式 → HUAN Device 的執行檔路徑
4. 設定 → 勾選「如果工作失敗，每隔一分鐘重新啟動」

**啟動資料夾**（較簡單）：

按 `Win + R`，輸入 `shell:startup`，把 HUAN Device 的捷徑放進去。

## 關閉螢幕休眠

```powershell
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
```

## Kiosk 模式

Windows 的指派存取（Assigned Access）可以把裝置鎖在單一應用程式上：

**設定** → **帳戶** → **其他使用者** → **設定 Kiosk**

## 溫度

Windows 上無法透過一般 API 取得 CPU 溫度，裝置回報 `null`，後台顯示「—」。

這是刻意的：**不會為了讓所有平台的欄位都有值而編一個數字出來。**

## 憑證儲存

裝置憑證使用 Electron 的 `safeStorage`，在 Windows 上由 DPAPI 加密，綁定到目前的使用者帳戶。

## ARM64

Windows on ARM 的支援取決於 Electron 對該版本的支援狀況。打包 workflow 會嘗試建置 arm64 版本；建置失敗時 x64 版本可以透過模擬執行，但效能較差。

## 疑難排解

**播放器啟動後閃退**：檢查顯示卡驅動程式。舊的驅動程式可能讓 Chromium 的 GPU 行程崩潰。

**影片播放卡頓**：確認硬體加速已啟用，並更新顯示卡驅動程式。

**連不上 Server**：檢查 Windows 防火牆有沒有擋下對外連線，以及公司網路的 Proxy 設定。
