# 快速開始

HUAN 讙讓你在瀏覽器裡設計一面畫面，然後把它送到現場的螢幕上。

這一頁帶你走完一次完整流程：從登入到第一面看板亮起來。

::: tip 這一份是給使用者的如果你要架設 HUAN、改程式或部署伺服器，請看[開發者文件](/dev/)。:::

## 開始之前

你需要：

- 一組 HUAN 後台帳號。HUAN **不開放自助註冊**，帳號由管理員建立。
- 一台安裝好 HUAN 播放器的裝置（Raspberry Pi、Windows、Ubuntu 或 macOS），而且連得到你的 HUAN 伺服器。安裝方式見[安裝播放裝置](/guide/install-raspberry-pi)。

## 1. 登入

打開你的 HUAN 網址，用管理員給你的 Email 或帳號登入。

<figure class="huan-figure">
	<img src="/screenshots/login.png" alt="HUAN 登入畫面" />
	<figcaption>登入畫面</figcaption>
</figure>

登入後會看到總覽，上面是裝置的線上狀態與需要注意的項目。

建議第一件事是到「安全設定」[開啟兩步驟驗證](/guide/two-factor)。

## 2. 上傳素材

到「素材庫」，把影片或圖片拖進上傳區。

<figure class="huan-figure">
	<img src="/screenshots/media.png" alt="素材庫" />
	<figcaption>素材庫</figcaption>
</figure>

檔案會依序經過**上傳中 → 處理中 → 可使用**三個狀態。處理階段 HUAN 會自動轉出適合播放的版本、縮圖與預覽圖。

文字與跑馬燈不需要上傳，等一下直接寫在版面裡。

詳見[上傳素材](/guide/media)。

## 3. 設計版面

到「版面」建立一份新版面，選擇畫布尺寸（一般橫式螢幕就選 1920 × 1080）。

<figure class="huan-figure">
	<img src="/screenshots/layout-editor.png" alt="版面編輯器" />
	<figcaption>版面編輯器：左邊素材、中間預覽、右邊屬性</figcaption>
</figure>

HUAN 的版面是**把畫面切開**，不是自由拖放：

1. 選一個區塊，按「水平分割」把它切成左右兩半。
2. 在右側面板把第一塊的占比調成 70。
3. 從左邊的素材面板把影片拖進左半邊。
4. 選右半邊，按「放入文字」，寫上你的標語。

比例是百分比而不是像素，所以同一份版面放到不同解析度的螢幕上，構圖不會跑掉。

滿意之後按**發布**。發布會建立一個固定的版本，現場播的就是它——你之後繼續編輯草稿不會影響已經在播的畫面。

詳見[設計版面](/guide/layouts)。

## 4. 配對裝置

第一次啟動播放器時，螢幕上會顯示一組 `XXXX-XXXX` 配對碼與 QR Code。

<figure class="huan-figure">
	<img src="/screenshots/device-pairing.png" alt="裝置上的配對畫面" />
	<figcaption>播放器啟動後顯示的配對畫面</figcaption>
</figure>

用已經登入的瀏覽器掃描 QR Code，或到後台的「裝置 → 配對新裝置」輸入這組配對碼。確認是眼前這一台之後按下綁定，順便幫它取個名字並指定要播的預設版面。

配對碼 10 分鐘後失效，而且只能用一次。

詳見[配對裝置](/guide/pairing)。

## 5. 看它動起來

綁定完成後，裝置會自己完成剩下的事：

```text
取得該播什麼
  ↓
下載需要的影片與圖片
  ↓
逐一驗證檔案完整
  ↓
全部就緒才切換畫面
```

在後台的「裝置」頁可以看到同步進度。目標版本與實際版本一致時，就代表現場已經在播你剛才做的畫面了。

<figure class="huan-figure">
	<img src="/screenshots/devices.png" alt="裝置管理" />
	<figcaption>裝置管理</figcaption>
</figure>

## 6.（選用）安排播放時段

想讓不同時段播不同畫面的話，到「排程」建立規則：

```text
星期一至五 08:00–11:00  早餐版面
星期一至五 11:00–14:00  午餐版面
```

沒有任何排程命中的時間，裝置就播它的預設版面。

排程會下載到裝置本機，所以**就算伺服器離線，現場一樣會照時間換畫面**。

詳見[安排播放時段](/guide/schedules)。

## 網路斷了會怎樣

畫面照播。

HUAN 的素材永遠是先下載到裝置上才播放，排程也存在裝置裡。網路只負責告訴裝置「內容換了」——這件事延遲幾小時甚至幾天，都不影響現在正在播的畫面。

詳見[離線播放](/guide/offline)。

## 接下來

- [核心概念](/guide/concepts)：版面、修訂、排程與裝置之間的關係
- [管理裝置](/guide/devices)：改名、強制同步、重新啟動、解除綁定
- [使用者與權限](/guide/users)：誰可以做什麼
- [疑難排解](/guide/troubleshooting)：東西不對勁的時候
