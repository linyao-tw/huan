---
title: "在 Ubuntu 上安裝"
description: "支援 x64 與 arm64。"
---

支援 x64 與 arm64。

## 需求

| 項目     | 需求                  |
| -------- | --------------------- |
| 版本     | Ubuntu 22.04 LTS 以上 |
| 架構     | x64 或 arm64          |
| 記憶體   | 最低 2GB，建議 4GB    |
| 桌面環境 | 需要 X11 或 Wayland   |

## 安裝

從 [Releases](https://github.com/linyao-tw/huan/releases) 下載對應架構的版本。

AppImage：

```sh
chmod +x HUAN-Device-*-linux-x64.AppImage
./HUAN-Device-*-linux-x64.AppImage
```

Debian 套件：

```sh
sudo apt install ./HUAN-Device-*-linux-x64.deb
huan-device
```

## 開機自動啟動

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
loginctl enable-linger "$USER"
```

也可以用桌面環境自己的自動啟動機制，放一個 `.desktop` 檔到 `~/.config/autostart/`。

## 關閉螢幕休眠

GNOME：

```sh
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
```

X11 通用：

```sh
xset s off -dpms
```

## 無桌面環境的伺服器版

Electron 需要一個顯示伺服器。最小安裝：

```sh
sudo apt install --no-install-recommends xserver-xorg xinit openbox
```

然後用 `~/.xinitrc` 啟動：

```sh
#!/bin/sh
exec openbox-session &
exec huan-device
```

## 憑證儲存

裝置憑證使用 Electron 的 `safeStorage`，在 Linux 上會透過 `libsecret` 存進系統的金鑰環（GNOME Keyring 或 KWallet）。

沒有可用的金鑰環服務時，`safeStorage` 會退回較弱的保護。無人值守的看板機器建議確認金鑰環在開機時會自動解鎖，或接受這個限制——裝置憑證的權限範圍僅限這一台裝置，而且隨時可以從後台撤銷。

## 疑難排解

**AppImage 無法執行**：需要 FUSE。

```sh
sudo apt install libfuse2
```

**沙箱錯誤**：某些容器或受限環境需要調整 user namespace 設定。**不要用 `--no-sandbox` 繞過**——那會關掉 Electron 的核心安全機制。
