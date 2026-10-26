---
title: "用 gh 管理两个 GitHub 身份"
date: 2026-03-15
tags: [工具, GitHub]
summary: "工作号和私人号在同一台电脑上共存：hosts 文件、账号切换，以及别让个人信息泄露到公司仓库里。"
---

我用两个 GitHub 账号：一个私人号，用来放博客和折腾的东西；一个工作号，属于公司组织。它们在同一台笔记本上共存，靠的是 `gh` 的多账号支持。

## 登录两个账号

`gh auth login` 会把凭据按主机名存进 `~/.config/gh/hosts.yml`（Windows 是 `%APPDATA%\GitHub CLI\hosts.yml`）。同一个域名可以挂多个账号：

```sh
gh auth login --hostname github.com --user cp99458 --git-protocol https --web
gh auth login --hostname github.com --user work-account --git-protocol https --web
```

两个账号都登录之后，`gh auth status` 会把它们都列出来，并标出当前活跃的那个：

```txt
github.com
  ✓ Logged in to github.com account cp99458 (keyring)
  - Active account: true
  - Git operations protocol: https
  ✓ Logged in to github.com account work-account (keyring)
  - Active account: false
```

## 切换活跃账号

```sh
gh auth switch --user work-account
gh auth switch --user cp99458
```

这一步只影响 `gh` 自己发出的请求。`git push` 走的是另一套凭据，需要额外告诉 `gh` 去配置它：

```sh
gh auth setup-git
```

它会把 `gh` 写进 Git 的 credential helper，之后用 HTTPS 推送时，凭据由 `gh` 提供——**跟着当前活跃账号走**。所以切换账号后，下一次推送自然就用新身份。

要确认某个仓库实际用的身份，别猜，直接看：

```sh
git config --get user.email
gh api user --jq '.login'
```

## 按仓库绑定身份

切换全局账号容易忘。更稳妥的办法是按目录绑定，让私人号的仓库永远不用工作号署名：

```sh
git config --global includeIf "gitdir:~/code/personal/" .gitconfig-personal
```

然后在 `~/.gitconfig-personal` 里写：

```ini
[user]
    name = 拾光
    email = cp99458@users.noreply.github.com
```

工作目录同理，指向公司邮箱。这样无论当前活跃账号是谁，提交记录里的署名都不会错。

## SSH 也可以

如果更习惯 SSH，思路一样：为两个身份各生成一把 key，在 `~/.ssh/config` 里用不同的 Host 别名区分。

```ssh
Host github-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_personal

Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_work
```

推送时把远程地址里的 `github.com` 换成别名即可：`git@github-personal:cp99458/blog.git`。远程地址本身就是身份声明，比"记得切换"可靠得多。

## 一个容易踩的坑

`gh repo create` 创建的组织仓库，默认会推到当前活跃账号有权限的地方。如果两个账号在同一个组织里都有权限，创建前先确认一遍：

```sh
gh auth switch --user work-account
gh repo create org-name/new-repo --private --source=.
```

私人项目则反过来。把命令和身份绑在一起，比依赖记忆可靠；这大概也是所有工具设计里最朴素的一条道理。
