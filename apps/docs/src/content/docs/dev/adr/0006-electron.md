---
title: "ADR-0006：播放器使用 Electron"
description: "已採用"
---

## 狀態

已採用

## 背景

播放器必須在 Raspberry Pi OS（arm64）、Ubuntu（x64 與 arm64）、Windows（x64 與 arm64）與 macOS（x64 與 arm64）上執行，而且要能播放影片、圖片、文字、跑馬燈、iframe 與上傳的 HTML。

## 決策

使用 Electron，React 負責算繪行程。

## 理由

**要播的內容本來就是網頁內容。** 影片、圖片、文字排版、CSS 動畫、iframe、HTML——這些全都是瀏覽器原生就會做的事。用原生 UI 框架重做一次等於重寫一個排版引擎。

**版面引擎可以和後台共用。** `@huan/layout-engine` 同一份程式碼跑在 Admin 的預覽與 Device 的播放器上，這是「後台看到什麼、現場就播什麼」的保證。換一個非網頁的算繪技術就得維護兩套幾何實作，而它們一定會漂移。

**上傳的 HTML 需要一個真的瀏覽器。** 而且需要一個可以嚴格 sandbox 的瀏覽器。Electron 的 `sandbox: true` 加上巢狀 iframe 提供了這個能力。

**跨平台打包是解決過的問題。** electron-builder 直接支援上面列的六個平台架構組合。

## 後果

- 記憶體用量比原生播放器高。Raspberry Pi 4 的最低建議配置因此是 2GB，實際建議 4GB。
- 應用程式體積較大（每個平台大約一百多 MB）。看板裝置一次安裝之後很少更新，這是可以接受的。
- 必須嚴格遵守 Electron 的安全模型。`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 不會為了任何功能而放寬，preload 只暴露最小介面。
- 要盡量避免原生 Node 模組。每一個原生相依都會讓六個平台架構的打包變得更困難，因此優先選擇純 JS 或 Web API 的方案。

## 替代方案

**Chromium kiosk 模式加一個小服務**：更輕量，但排程、下載、狀態管理都得另外寫一個常駐程序，而且和瀏覽器之間的溝通要自己設計。等於用兩個行程做 Electron 一個行程做的事。

**原生應用程式（Qt、Flutter）**：記憶體用量低很多，但要自己實作 HTML 內容的算繪與 sandbox，而且無法與後台共用版面引擎。

**libmpv 加自製排版**：影片播放效能最好，但文字、跑馬燈、HTML 與 iframe 全都要重做。
