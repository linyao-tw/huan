# 登入

HUAN **沒有公開註冊**。帳號一律由最高權限管理員在後台建立，第一個管理員則由 CLI 建立。

<figure class="huan-figure">
	<img src="/screenshots/login.png" alt="HUAN 登入畫面" />
	<figcaption>登入畫面</figcaption>
</figure>

## 登入

在 `/login` 輸入 Email 或帳號，加上密碼。

啟用了兩步驟驗證的帳號會進入第二階段，輸入驗證器產生的六位數驗證碼，或改用復原碼。

## 登入保護

連續失敗會被暫時擋下。節流以**帳號**與**來源 IP** 兩個維度計算，預設是五分鐘內十次失敗。

紀錄寫在資料庫而不是記憶體，因此重啟 Server 不會把計數歸零。

## Session

登入狀態存在 `HttpOnly` cookie 裡。這表示 JavaScript 讀不到它，也就無法透過 XSS 竊取。

正式環境的 cookie 帶有 `Secure`，只會在 HTTPS 下送出。

Session 預設 14 天過期。可以在[安全設定](/admin/two-factor#工作階段)看到所有登入中的裝置並個別撤銷。

## 建立第一個管理員

```sh
pnpm --filter @huan/server admin:create
```

互動式地詢問 Email、帳號、顯示名稱與密碼。密碼至少 12 個字元。

Docker 環境：

```sh
docker compose -f docker/compose.yaml exec \
	-e HUAN_ADMIN_PASSWORD='<一組強密碼>' \
	server node apps/server/dist/cli/create-admin.js \
	--email you@example.com --username admin --display-name 管理員
```

::: danger 原始碼裡沒有預設密碼 HUAN 不內建任何預設管理員帳號或密碼。第一個帳號一定要用這個指令建立。:::

## 忘記密碼

第一版沒有自助的密碼重設流程（那需要可靠的郵件寄送，而自架環境往往沒有）。

請最高權限管理員到[使用者管理](/admin/users)重設。所有管理員都無法登入時，用 CLI 再建立一個。
