---
title: "在 Raspberry Pi 上安裝"
description: "Raspberry Pi 是 HUAN 的主要目標裝置，但產品沒有綁死在它上面。同一份程式碼也跑在 Ubuntu、Windows 與 macOS 上。"
---

Raspberry Pi 是 HUAN 的主要目標裝置，但**產品沒有綁死在它上面**。同一份程式碼也跑在 Ubuntu、Windows 與 macOS 上。

## 建議規格

| 項目     | 需求                                    |
| -------- | --------------------------------------- |
| 機型     | Raspberry Pi 4 以上                     |
| 作業系統 | Raspberry Pi OS 64-bit（Bookworm 以上） |
| 記憶體   | 最低 2GB，**建議 4GB**                  |
| 儲存     | 32GB 以上的 A2 等級 microSD，或 USB SSD |
| 網路     | 有線網路優先                            |

:::tip[用 SSD 而不是 SD 卡]

microSD 卡在持續寫入下的壽命有限，而 HUAN 會在同步時寫入不少資料。長期部署建議從 USB SSD 開機。

:::

## 安裝

從 [Releases](https://github.com/linyao-tw/huan/releases) 下載 **linux-arm64** 的版本。

AppImage：

```sh
chmod +x HUAN-Device-*-linux-arm64.AppImage
./HUAN-Device-*-linux-arm64.AppImage
```

Debian 套件：

```sh
sudo apt install ./HUAN-Device-*-linux-arm64.deb
huan-device
```

## 開機自動啟動

Raspberry Pi OS 使用 systemd，但 **HUAN 不假設系統上一定有 systemd**——它只是最常見的情況。

```ini
# ~/.config/systemd/user/huan-device.service
[Unit]
Description=HUAN Device Player
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/huan-device
Restart=always
RestartSec=10

[Install]
WantedBy=graphical-session.target
```

```sh
systemctl --user enable --now huan-device
loginctl enable-linger "$USER"   # 讓服務在沒有登入時也能執行
```

## 螢幕設定

### 關閉螢幕保護與休眠

```sh
sudo apt install xscreensaver
xset s off
xset -dpms
xset s noblank
```

或在 `~/.config/wayfire.ini` 加上：

```ini
[idle]
dpms_timeout = -1
screensaver_timeout = -1
```

### 直式螢幕

```sh
# Wayland（Raspberry Pi OS Bookworm 預設）
wlr-randr --output HDMI-A-1 --transform 90
```

版面的畫布尺寸要跟著改成 1080×1920。裝置回報的顯示器資訊會反映實際的方向，建立版面時可以直接選「使用裝置解析度」。

## 影片播放

Worker 產生的播放檔已經針對 Raspberry Pi 最佳化：

- H.264（不是 H.265）
- `yuv420p` 像素格式
- 最高 1920×1080
- 最高 30fps

`yuv420p` 是刻意指定的：某些來源使用 `yuv444p` 或 10-bit 格式，Pi 的硬體解碼器不支援，會退回軟體解碼而卡頓。

### 增加 GPU 記憶體

`/boot/firmware/config.txt`：

```ini
gpu_mem=256
```

## 溫度

Raspberry Pi 上讀得到 CPU 溫度，會在 heartbeat 中回報，後台可以看到。

Windows 與 macOS 上讀不到，回報 `null`，後台顯示「—」。**不會為了統一型別而編一個數字。**

裝置超過 80°C 會開始降頻，畫面可能變卡。裝在密閉機殼裡的 Pi 建議加散熱片或風扇。

## 沒有的假設

HUAN **不會假設**系統上一定存在：

- `apt`
- `vcgencmd`
- `systemd`

這些平台差異都封裝在 `PlatformAdapter` 介面裡。讀不到的資訊回報 `null`，不會讓播放器崩潰。

## 疑難排解

**畫面全黑但程式在跑**：檢查 HDMI 是不是被偵測成未連接。Pi 在開機時沒接螢幕會停用輸出。

**影片卡頓**：確認素材真的是 H.264 / `yuv420p`（後台的素材詳情看得到），並增加 GPU 記憶體。

**同步很慢**：Wi-Fi 在多數場地都不穩定，有線網路差很多。

**磁碟空間不足**：後台會顯示裝置回報的儲存錯誤。清掉不需要的排程與版面可以讓裝置回收對應的素材。
