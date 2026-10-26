---
title: "把博客交给 Cloudflare Pages"
date: 2026-10-06
tags: [建站, Cloudflare]
summary: "静态站点最麻烦的从来不是生成，而是部署。用 wrangler 一条命令上线，再让 GitHub 每次推送自动发布。"
featured: true
---

静态网站的托管方案换过好几轮：虚拟主机、对象存储、Netlify、Vercel。最后留下来的是 Cloudflare Pages，原因很朴素——静态文件免费额度足够，全球节点离读者近，而且我能用一条命令完成发布。

## 第一次部署

假设构建产物在 `dist/`，项目名 `shiguangji`。第一次需要先创建项目：

```sh
# 登录一次，凭据会存在本地
npx wrangler login

# 创建 Pages 项目（只需一次）
npx wrangler pages project create shiguangji \
  --production-branch=main
```

之后每次发布只有一行：

```sh
npx wrangler pages deploy dist \
  --project-name=shiguangji \
  --branch=main \
  --commit-dirty=true
```

`--branch=main` 决定了它是生产部署，会上传到 `<project>.pages.dev` 以及你绑定的自定义域名。其它分支会得到一个独立的预览地址，方便在合并前检查。

## 缓存策略写在文件里

Pages 最舒服的一点，是把 HTTP 头变成了仓库里的文本文件。新建 `public/_headers`，构建时会原样复制到产物根目录：

```txt
# 带哈希的静态资源永不过期
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# 搜索索引短缓存，新文章能很快出现
/search.json
  Cache-Control: public, max-age=300

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
```

这里的关键是文件名里的哈希：`styles.a1b2c3d4.css`。内容变了文件名就变，所以可以放心地声明 `immutable`。HTML 不需要特殊配置，Pages 默认不做长缓存，每次刷新都能拿到最新版本。

## 让推送代替手工发布

部署命令虽然只有一条，但人不该记得任何事情。在 `.github/workflows/deploy.yml` 里放一个工作流，推送到 `main` 就自动构建并发布：

```yaml
name: deploy

on:
  push:
    branches: [main]

jobs:
  pages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=shiguangji --branch=main
```

两个 secret 需要在仓库的 Settings → Secrets 里配置。`CLOUDFLARE_API_TOKEN` 去控制台创建一个只带 *Cloudflare Pages: Edit* 权限的令牌就够了，不要用全局 API Key。

## 还可以更省事

如果不想维护 `dist/` 的构建流程，Pages 也支持直接连接仓库：在控制台里指定构建命令 `npm run build` 和输出目录 `dist`，之后每次推送它自己会跑。代价是多了一层看不太见的构建环境，出问题时排查起来比本地慢。

我选择在本地构建、用 CLI 发布。因为这样"线上是什么样"和"我电脑上是什么样"，永远是同一份东西。
