---
title: "CSS 层叠层与设计令牌"
date: 2026-07-19
tags: [CSS, 前端]
summary: "为什么我的样式表总在互相覆盖？@layer 加上一套命名规矩，可以把这个问题的 80% 一次性解决。"
---

写了十年 CSS，最常出错的地方不是布局，而是**谁覆盖了谁**。

同一份样式表里，`padding` 出现在四个地方，最后一个生效。要改一个按钮的间距，你得先搞清楚是基础类、组件类、还是三天前加的一个 `.page-home .btn-ghost:hover`。

`@layer` 出来之后，这个问题终于有了结构性的答案。

## 层叠层：把优先级写进结构

`@layer` 让"哪个规则赢"由声明顺序决定，而不是由选择器权重决定：

```css
@layer reset, base, layout, components, utilities;

@layer base {
  a { color: var(--ink); }
}

@layer components {
  .button { color: var(--accent); }
}
```

后声明的层永远赢过先声明的层，无论选择器写得多长。这意味着 `utilities` 里一个 `.mt-4` 单类，可以稳定地覆盖 `components` 里三个类叠加的复杂选择器。

它同时解决了另一个老问题：**引入第三方 CSS**。把 UI 库放进最下面的 `vendor` 层，你的 `components` 就有权限覆盖它，不需要 `!important`：

```css
@layer vendor, reset, base, components;

@import url("library.css") layer(vendor);
```

需要注意的是，`@layer` 本身不降低选择器权重——同一层内部，权重规则照旧。它只是把"跨层的比较"变成了确定的事。

## 设计令牌：别让颜色散落在各处

第二个习惯来自设计系统：所有会重复出现的值，先命名，再使用。

```css
:root {
  --paper: #faf7f1;
  --ink: #1c1a17;
  --accent: #b23a2b;
  --rule: #e3dbca;

  --measure: 40rem;
  --radius: 4px;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

:root[data-theme="dark"] {
  --paper: #14120f;
  --ink: #ece6da;
  --accent: #e0805f;
  --rule: #2b2620;
}
```

深色模式于是变成了十几行变量的重定义，而不是再写一遍整站样式。这不是"少写代码"的问题，而是**只有一处真相**：要调整主色，改一个值，整个站点跟着变。

<figure data-figure="stack-diagram"></figure>

## 三个实践细节

**一、令牌按语义命名，不按外观。** `--accent` 好过 `--red`。当主色从朱红换成靛蓝时，前者不需要改任何使用处。

**二、用 `color-mix()` 派生透明度。** 需要主色的 40% 时，不要新造一个变量：

```css
.prose a {
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
```

**三、尽量不用 `!important`。** 如果非用不可，说明层级设计出了问题。层叠层就是为替代它而存在的。

## 一点感慨

CSS 这些年的变化，方向其实很一致：把"隐式的、靠人记住的规则"，变成"显式的、写在代码里的结构"。

以前我们知道"别写太深的选择器"，但没人能强制；现在可以。以前靠注释说"这里的颜色要跟主题一致"，现在一个变量就是契约。

工具变好之后，剩下的问题就回到设计本身：你真的想清楚这个段落该多宽了吗？
