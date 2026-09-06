---
title: "在 macOS 上安裝"
description: "支援 Intel（x64）與 Apple Silicon（arm64）。"
---

支援 Intel（x64）與 Apple Silicon（arm64）。

## 需求

| 項目   | 需求                   |
| ------ | ---------------------- |
| 版本   | macOS 12 Monterey 以上 |
| 架構   | x64 或 arm64           |
| 記憶體 | 最低 4GB               |

## 安裝

從 [Releases](https://github.com/linyao-tw/huan/releases) 下載對應架構的 `.dmg`，拖進「應用程式」。

:::tip[未經公證的應用程式]

目前的版本沒有經過 Apple 公證，第一次開啟時 Gatekeeper 會擋下來。

在 Finder 裡對應用程式按右鍵 → 開啟，然後在對話框中確認。或者：

```sh
xattr -dr com.apple.quarantine /Applications/HUAN\ Device.app
```

要消除這個步驟需要 Apple Developer 帳號與公證流程，可以在 CI 的 secrets 裡設定後啟用。

:::

## 開機自動啟動

**系統設定** → **一般** → **登入項目** → 加入 HUAN Device。

或用 launchd：

```xml
<!-- ~/Library/LaunchAgents/tw.linyao.huan.device.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
	<dict>
		<key>Label</key>
		<string>tw.linyao.huan.device</string>
		<key>ProgramArguments</key>
		<array>
			<string>/Applications/HUAN Device.app/Contents/MacOS/HUAN Device</string>
		</array>
		<key>RunAtLoad</key>
		<true/>
		<key>KeepAlive</key>
		<true/>
	</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/tw.linyao.huan.device.plist
```

## 關閉螢幕休眠

```sh
sudo pmset -a displaysleep 0 sleep 0
```

或用 `caffeinate` 包住播放器。

## 溫度

macOS 上沒有不需要特殊權限就能取得 CPU 溫度的公開 API，裝置回報 `null`，後台顯示「—」。

## 憑證儲存

裝置憑證使用 Electron 的 `safeStorage`，在 macOS 上存進系統的鑰匙圈。

## 適合的情境

macOS 主要用於**開發與測試**——它讓開發者不需要準備 Raspberry Pi 就能執行真正的播放器。

正式部署的看板通常會選 Raspberry Pi 或小型 Linux 電腦，成本與功耗都低得多。Mac mini 在需要 4K、色彩準確度或已經有 Apple 生態系統的場合仍然是合理的選擇。

## 疑難排解

**應用程式無法開啟，顯示「已損毀」**：這通常是 quarantine 屬性造成的，用上面的 `xattr` 指令處理。

**全螢幕時仍然看得到選單列**：在系統設定裡把「自動隱藏並顯示選單列」設為「一律」。
