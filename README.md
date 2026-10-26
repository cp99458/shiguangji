# 拾光集 · shiguangji

一个手写的中文静态博客。没有前端框架，没有数据库，没有追踪脚本——两百多行 Node 脚本把 Markdown 变成一整站 HTML，托管在 Cloudflare Pages 上。

- 站点：<https://shiguangji.pages.dev>
- 技术：Node.js + `marked` + `highlight.js`，零框架运行时
- 特性：深色模式、站内搜索（⌘K / Ctrl K）、目录高亮、阅读进度、RSS、sitemap、代码复制

## 目录结构

```txt
blog/
├── content/
│   ├── site.json          # 站点配置：标题、导航、"此刻"、GitHub 等
│   ├── figures/           # 文章里可复用的 HTML 片段（内联 SVG 图）
│   ├── pages/about.md     # 关于页
│   └── posts/*.md         # 文章，一个文件一篇
├── public/                # 原样复制到产物根目录（favicon、_headers）
├── src/
│   ├── build.mjs          # 静态站点生成器
│   ├── dev.mjs            # 监听改动并重建 + 预览
│   ├── serve.mjs          # 本地静态服务器
│   ├── styles.css         # 设计系统（CSS 变量 + 深色模式）
│   └── app.js             # 主题、搜索、目录高亮、代码复制
├── dist/                  # 构建产物（已被 git 忽略）
└── wrangler.toml          # Cloudflare Pages 配置
```

## 常用命令

```sh
npm install            # 安装两个依赖
npm run build          # 生成 dist/
npm run dev            # 监听 content/ src/ public/，边写边看
npm run preview        # 只启动本地预览（http://127.0.0.1:4173）
```

## 写一篇新文章

在 `content/posts/` 下新建 `my-post.md`，文件名就是 URL：`/posts/my-post/`。

```md
---
title: "标题"
date: 2026-11-01
tags: [写作, 建站]
summary: "一句摘要，会出现在列表、搜索结果和 RSS 里。"
featured: true      # 可选，首页"精选"
draft: false        # 可选，true 则构建时跳过
---

正文用 Markdown 写。支持 GFM 表格、任务列表、代码高亮。
```

`npm run build` 会自动生成首页、归档、标签页、关于页、RSS、sitemap 和搜索索引。

### 插入一张图

图片放在 `public/figures/`，或用 `content/figures/` 里的 HTML 片段（适合需要跟随主题变色的内联 SVG）：

```md
<figure data-figure="stack-diagram"></figure>
```

## 部署

### 手动发布

```sh
npx wrangler login
npx wrangler pages project create shiguangji --production-branch=main   # 仅第一次
npm run build
npx wrangler pages deploy dist --project-name=shiguangji --branch=main
```

### 推送到 GitHub 自动发布

仓库里的 `.github/workflows/deploy.yml` 会在推送 `main` 时自动构建并发布。需要在
**Settings → Secrets and variables → Actions** 里配置两个 secret：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 控制台创建的令牌，权限只需 *Cloudflare Pages: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` 可以查到 |

## 设计说明

全部视觉都集中在 `src/styles.css` 顶部的变量里：

```css
:root {
  --paper: #faf7f1;   /* 纸 */
  --ink: #1c1a17;     /* 墨 */
  --accent: #b23a2b;  /* 朱砂 */
}
:root[data-theme="dark"] { /* 只是重新定义同一批变量 */ }
```

想换配色，改这十来个值就够了，不需要动任何组件样式。正文宽度由 `--measure`
控制，行高、字距、留白都按中文长文的阅读习惯调过。

## 许可

- 代码：MIT
- 文字：CC BY-NC-SA 4.0

本站文字版权归作者所有，欢迎引用，请注明出处与链接。
