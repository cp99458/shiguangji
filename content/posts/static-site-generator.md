---
title: "两百行的静态站点生成器"
date: 2026-09-21
tags: [Node.js, 建站]
summary: "不装框架，不写配置，用最普通的一段 Node 脚本把 Markdown 变成一整站 HTML。读完你大概也能写一个。"
---

每次想给博客换框架，我都会先问自己一个问题：生成一个静态网站，究竟需要多少东西？

答案比想象中少：读文件、解析 frontmatter、渲染 Markdown、套一个布局、写回磁盘。四步，两百行，够了。

## 先定义最小的输入

每篇文章就是 `content/posts/` 下的一个 `.md` 文件，开头是一小段元数据：

```md
---
title: "两百行的静态站点生成器"
date: 2026-09-21
tags: [Node.js, 建站]
summary: "不装框架，不写配置。"
---

正文从这里开始。
```

frontmatter 是 YAML 的一个极小子集：`key: value`、行内数组、布尔值。自己写解析器只要三十行，比引入一个依赖省心：

```js
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  const head = raw.slice(3, end);
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1);

  const data = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim().replace(/^["']|["']$/g, '');
    data[m[1]] = /^\[.*\]$/.test(value)
      ? value.slice(1, -1).split(',').map((v) => v.trim())
      : value;
  }
  return { data, body };
}
```

## Markdown 交给库，别自己写

解析 CommonMark 是个坑，嵌套列表、引用块里的代码、表格对齐……每一处都能耗掉一个下午。这种"标准化程度极高、出错成本很高"的活，应该交给 `marked`：

```js
import { marked } from 'marked';

const html = marked.parse(body, { gfm: true, breaks: false });
```

但库的输出是"通用"的，而站点需要"自己的"：标题要能锚点跳转、代码块要有语言标签和复制按钮、外链要在新标签打开。这些都在渲染完成后用字符串后处理补上，比重写渲染器简单得多：

```js
let toc = [];
html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
  const text = inner.replace(/<[^>]*>/g, '').trim();
  const id = slugify(text);
  toc.push({ level: Number(level), text, id });
  return `<h${level} id="${id}">${inner}</h${level}>`;
});
```

顺手就得到了目录数据——因为标题只遍历了一次。构建时把 `toc` 渲染成侧边栏，前端只负责高亮当前小节，不需要再解析一遍 DOM。

## 每篇文章都是一个函数调用

页面模板就是普通的模板字符串，不需要 JSX：

```js
function page({ title, description, body, canonical }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${site.url}${canonical}">
</head>
<body>${body}</body>
</html>`;
}
```

然后主流程只有一句循环：

```js
for (const post of posts) {
  write(`posts/${post.slug}/index.html`, postPage(post));
}
```

目录结构天然就是 URL 结构：`dist/posts/hello-again/index.html` 对应 `/posts/hello-again/`。不需要路由表，也不需要重写规则。

## 什么时候它不够用

这套东西不适合：需要在构建时请求远程数据、页面数量上万、多人协作改内容、或者要做服务端渲染的项目。它的舒适区是个人站点——几十到几百篇文章，一年更新几十次。

代价是每次加功能都得自己写。好处也一样：**每行代码为什么存在，你都知道。**

这两百行里我最满意的部分，是构建完成后打印的那份文件清单。看着一排 URL 滚过去，会有一种"真的做完了"的踏实感——这是任何黑盒框架都给不了的。
