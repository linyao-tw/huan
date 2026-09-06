<div align=center>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://elvismao.com/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://elvismao.com/logo-black.svg">
  <img alt="EM Logo" src="https://elvismao.com/logo.svg" width="50"/>
</picture>

# utils

一些常用的複製貼上好工具

</div>

文件裡面有：

- 常用 gitignore
- 常用 Actions
- 我的 .prettierrc
- 我常用的 License：Apache-2.0 跟 [你他媽的想幹嘛就幹嘛公眾授權條款](LICENSE)

## 環境

### 安裝 Node.js

請參考 [Node.js 官方網站](https://nodejs.org/zh-tw/download/) 下載並安裝適合您作業系統的版本。建議使用 nvm 安裝。

### 安裝 pnpm

```sh
npm install --global corepack@latest
corepack enable pnpm
```

> 更新 pnpm 時，請執行：  
> `corepack prepare pnpm@latest --activate`

## 建立專案

### 鎖定專案 pnpm 版本

```sh
corepack use pnpm@latest
```

### Prettier

```sh
pnpm add -D prettier prettier-plugin-organize-imports prettier-plugin-packagejson
```

### [Astro](https://docs.astro.build/zh-tw/install-and-setup/)

```sh
pnpm create astro@latest
pnpm add -D prettier-plugin-astro
```

### React

```sh
pnpm create vite@latest ./ --template react-ts
```

### 其他套件

```sh
pnpm add lenis
```

## Git 操作

### 部落格寫過的爛事

- [如何更改已經 push 的 commit message](https://emtech.cc/p/git-reword/)
- [Git force push orphan branch 其他人不能 pull 怎麼辦？](https://emtech.cc/p/git-pull-orphan/)
- [如何把 Merge 地獄整理成乾淨的 Commit](https://emtech.cc/p/git-merge-clean/)
- [你們為什麼就不能全域 .gitignore .DS_Store 呢？](https://emtech.cc/p/git-dsstore/)
- [如何設定 VSCode Git pull 使用 rebase 而不是 merge](https://emtech.cc/p/vscode-git-pull/)
- [GitHub 如何更改預設分支 (default branch)](https://emtech.cc/p/git-default-branch/)
- [啊我剛才 push 錯了！如何在 Git 中撤銷提交](https://emtech.cc/p/git-revert/)

### 有人亂 push package-lock.json

```sh
git rm --cached package-lock.json
rm package-lock.json
git add .gitignore
git commit -m "chore: remove package-lock.json and ignore it"
git push
```

### 檢查看 core.hooksPath 是否設定成功

```bash
git config --show-origin --get core.hooksPath
```

## 授權條款

本專案採用[你他媽的想幹嘛就幹嘛公眾授權條款](https://www.wtfpl.net/)授權，詳情請參閱 [LICENSE](./LICENSE) 檔案。

![](https://www.wtfpl.net/wp-content/uploads/2012/12/wtfpl-badge-1.png)
