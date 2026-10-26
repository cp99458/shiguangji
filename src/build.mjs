/**
 * 拾光集 — a small, hand-written static site generator.
 *
 * Reads Markdown from content/, renders HTML into dist/ with a shared layout.
 * No build framework, no client-side hydration: the output is plain HTML + CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { marked } from 'marked';
import hljs from 'highlight.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const CONTENT = path.join(ROOT, 'content');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const INCLUDE_DRAFTS = args.includes('--drafts');
const BASE_OVERRIDE = (() => {
  const i = args.indexOf('--base');
  return i > -1 ? args[i + 1] : null;
})();

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

/** Slug that keeps CJK characters: "读《人月神话》" -> "读-人月神话" */
function slugify(text) {
  return (
    stripTags(text)
      .toLowerCase()
      .trim()
      .replace(/[`~!@#$%^&*()+=[\]{}|\\;:'",.<>/?！？。，、；：“”‘’（）《》【】…·—]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

const pad = (n) => String(n).padStart(2, '0');
const cnDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
};
const shortDate = (iso) => {
  const [, m, d] = iso.split('-');
  return `${m}.${d}`;
};
const weekday = (iso) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${iso}T09:00:00+08:00`).getDay()];

/* ------------------------------------------------------------------ *
 * front matter (a deliberately small subset of YAML)
 * ------------------------------------------------------------------ */

function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };
  const head = text.slice(3, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);

  const data = {};
  for (const line of head.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    let value = rawValue.trim();
    if (value === '') {
      data[key] = '';
      continue;
    }
    if (/^\[.*\]$/.test(value)) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (/^"(.*)"$/.test(value) || /^'(.*)'$/.test(value)) {
      data[key] = value.slice(1, -1);
    } else if (value === 'true' || value === 'false') {
      data[key] = value === 'true';
    } else {
      data[key] = value;
    }
  }
  return { data, body };
}

/* ------------------------------------------------------------------ *
 * markdown -> html
 * ------------------------------------------------------------------ */

marked.setOptions({ gfm: true, breaks: false });

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

function readingTime(md) {
  const text = md.replace(/```[\s\S]*?```/g, ' ');
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length;
  return Math.max(1, Math.round(cjk / 380 + words / 220));
}

function highlight(code, lang) {
  const language = (lang || '').toLowerCase();
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

function renderMarkdown(md) {
  let html = marked.parse(md);

  // 1. headings: stable ids + hover anchor + table of contents
  const toc = [];
  const used = new Set();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
    const text = stripTags(inner).trim();
    let id = slugify(text);
    let n = 2;
    while (used.has(id)) id = `${slugify(text)}-${n++}`;
    used.add(id);
    toc.push({ level: Number(level), text, id });
    const href = `#${encodeURIComponent(id)}`;
    return `<h${level} id="${escapeHtml(id)}">${inner}<a class="h-anchor" href="${href}" aria-label="本节链接：${escapeHtml(text)}">\u00b6</a></h${level}>`;
  });

  // 2. fenced code blocks: highlight server-side, add a chrome bar
  html = html.replace(
    /<pre><code(?: class="language-([\w+#.-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, lang, encoded) => {
      const code = decodeEntities(encoded);
      const label = lang || 'text';
      const body = highlight(code, lang);
      return [
        '<figure class="code-block">',
        '<figcaption class="code-bar">',
        `<span class="code-lang">${escapeHtml(label)}</span>`,
        '<button class="code-copy" type="button" data-copy>复制</button>',
        '</figcaption>',
        `<pre><code class="hljs language-${escapeHtml(label)}">${body}</code></pre>`,
        '</figure>',
      ].join('');
    },
  );

  // 3. wide tables get their own scroll container
  html = html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');

  // 4. figure partials: <figure data-figure="name"></figure> -> content/figures/name.html
  html = html.replace(/<figure data-figure="([\w-]+)"><\/figure>/g, (_m, name) => {
    const file = path.join(CONTENT, 'figures', `${name}.html`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  });

  // 4. off-site links open in a new tab, images are lazy
  html = html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
  html = html.replace(/<img ([^>]*?)>/g, (_m, attrs) => {
    const clean = attrs.replace(/\s(loading|decoding)="[^"]*"/g, '');
    return `<img ${clean} loading="lazy" decoding="async">`;
  });

  return { html, toc };
}

/* ------------------------------------------------------------------ *
 * site config + content collection
 * ------------------------------------------------------------------ */

const site = JSON.parse(fs.readFileSync(path.join(CONTENT, 'site.json'), 'utf8'));
site.url = BASE_OVERRIDE || site.url || '';
const ORIGIN = site.url.replace(/\/$/, '');

function readPosts() {
  const dir = path.join(CONTENT, 'posts');
  const posts = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const { data, body } = parseFrontmatter(raw);
      const slug = file.replace(/\.md$/, '');
      const date = data.date || '1970-01-01';
      return {
        slug,
        url: `/posts/${slug}/`,
        title: data.title || slug,
        summary: data.summary || '',
        date,
        tags: data.tags || [],
        featured: Boolean(data.featured),
        draft: Boolean(data.draft),
        minutes: readingTime(body),
        source: body,
      };
    })
    .filter((p) => INCLUDE_DRAFTS || !p.draft)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const post of posts) {
    const { html, toc } = renderMarkdown(post.source);
    post.html = html;
    post.toc = toc;
  }
  return posts;
}

const posts = readPosts();
const tags = [...new Set(posts.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'zh'));
const tagCount = (tag) => posts.filter((p) => p.tags.includes(tag)).length;
const latestDate = posts[0]?.date || '2026-01-01';

/* ------------------------------------------------------------------ *
 * templates
 * ------------------------------------------------------------------ */

const WRAP = (inner, cls = '') => `<div class="wrap ${cls}">${inner}</div>`;

const iconSearch = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>`;
const iconSun = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>`;
const iconMoon = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>`;
const iconArrow = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function head({ title, description, canonical, type = 'website', published, extra = '', ogImage }) {
  const fullTitle = title ? `${title} — ${site.title}` : `${site.title} · ${site.subtitle}`;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="author" content="${escapeHtml(site.author)}">
<link rel="canonical" href="${ORIGIN}${canonical}">
<meta name="theme-color" content="#faf7f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15130f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/feed.xml">
<meta property="og:site_name" content="${escapeHtml(site.title)}">
<meta property="og:locale" content="zh_CN">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${ORIGIN}${canonical}">
${ogImage ? `<meta property="og:image" content="${ORIGIN}${ogImage}">` : ''}
${published ? `<meta property="article:published_time" content="${published}T09:00:00+08:00">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script>(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=localStorage.getItem("theme");var d=q?q==="dark":(t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){}})();</script>
<link rel="stylesheet" href="${assetUrl('styles.css')}">
<script src="${assetUrl('app.js')}" defer></script>
${extra}
</head>`;
}

function header({ active = '', root = false }) {
  const nav = site.nav
    .map(
      (item) =>
        `<a href="${item.href}"${active === item.href ? ' aria-current="page"' : ''}>${item.label}</a>`,
    )
    .join('');
  return `<a class="skip" href="#main">跳到正文</a>
<header class="site-header">
  ${WRAP(
    `<a class="brand" href="/" aria-label="${escapeHtml(site.title)} · 首页">
      <span class="brand-mark" aria-hidden="true">${site.mark}</span>
      <span class="brand-name">${site.title}</span>
    </a>
    <nav class="site-nav" aria-label="主导航">${nav}</nav>
    <div class="header-tools">
      <button class="icon-btn" type="button" data-open-search aria-label="搜索文章" aria-keyshortcuts="Control+K">
        ${iconSearch}<kbd class="hint">K</kbd>
      </button>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="切换深浅色主题">
        <span class="only-light">${iconMoon}</span><span class="only-dark">${iconSun}</span>
      </button>
    </div>`,
    'header-inner',
  )}
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  ${WRAP(
    `<div class="footer-brand">
      <span class="brand-mark small" aria-hidden="true">${site.mark}</span>
      <p>© ${new Date().getFullYear()} ${site.title} · 文字以 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> 授权</p>
    </div>
    <nav class="footer-links" aria-label="页脚导航">
      <a href="/feed.xml">RSS</a>
      <a href="${site.github}" target="_blank" rel="noopener me">GitHub</a>
      <a href="/archive/">归档</a>
      <a href="/about/">关于</a>
    </nav>
    <p class="footer-note">手写构建脚本 · 托管于 Cloudflare Pages · 无框架，无追踪</p>`,
    'footer-inner',
  )}
</footer>`;
}

function searchDialog() {
  return `<div class="search" data-search hidden>
  <div class="search-backdrop" data-close-search></div>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="搜索文章">
    <div class="search-field">
      ${iconSearch}
      <input type="search" data-search-input placeholder="搜索标题、标签或正文…" autocomplete="off" spellcheck="false" aria-label="搜索关键词">
      <kbd>Esc</kbd>
    </div>
    <div class="search-results" data-search-results role="listbox" aria-label="搜索结果"></div>
    <div class="search-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span></div>
  </div>
</div>`;
}

function page({ title, description, canonical, body, active = '', type = 'website', published, extraHead = '', bodyClass = '', jsonld = null, ogImage }) {
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
${head({ title, description, canonical, type, published, extra: extraHead, ogImage })}
<body class="${bodyClass}">
${header({ active })}
<main id="main">
${body}
</main>
${footer()}
${searchDialog()}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</body>
</html>
`;
}

/* --- partials ------------------------------------------------------ */

function tagChips(tagList, { small = false } = {}) {
  if (!tagList.length) return '';
  const items = tagList
    .map((t) => `<li><a class="tag${small ? ' tag-sm' : ''}" href="/tags/${encodeURIComponent(slugify(t))}/">${t}</a></li>`)
    .join('');
  return `<ul class="tag-list">${items}</ul>`;
}

function postRow(post) {
  return `<li class="post-row">
    <a class="post-row-link" href="${post.url}">
      <time class="post-row-date" datetime="${post.date}">${shortDate(post.date)}<span>${post.date.slice(0, 4)}</span></time>
      <span class="post-row-body">
        <span class="post-row-title">${post.title}</span>
        ${post.summary ? `<span class="post-row-summary">${post.summary}</span>` : ''}
      </span>
      <span class="post-row-meta">
        <span class="post-row-tags">${post.tags.join(' · ')}</span>
        <span class="post-row-time">${post.minutes} 分钟</span>
      </span>
    </a>
  </li>`;
}

function featuredCard(post) {
  return `<a class="feature" href="${post.url}">
    <span class="feature-kicker">精选 · ${post.tags[0] || '文章'}</span>
    <h3 class="feature-title">${post.title}</h3>
    <p class="feature-summary">${post.summary}</p>
    <span class="feature-foot">
      <time datetime="${post.date}">${cnDate(post.date)}</time>
      <span class="feature-arrow" aria-hidden="true">${iconArrow}</span>
    </span>
  </a>`;
}

/* ------------------------------------------------------------------ *
 * pages
 * ------------------------------------------------------------------ */

function homePage() {
  const featured = posts.filter((p) => p.featured).slice(0, 2);
  const rest = posts.filter((p) => !featured.includes(p)).slice(0, 6);
  const firstYear = new Date(`${posts[posts.length - 1]?.date || '2026-01-01'}T00:00:00`).getFullYear();

  const body = `  <section class="hero">
    ${WRAP(
      `<div class="hero-main">
        <p class="hero-kicker">Vol. ${new Date().getFullYear() - firstYear + 1} · ${firstYear} 年至今</p>
        <h1 class="hero-title">${site.title}</h1>
        <p class="hero-sub">${site.subtitle}</p>
        <p class="hero-meta"><span>${posts.length} 篇文章</span><span class="sep" aria-hidden="true">·</span><span>${tags.length} 个标签</span><span class="sep" aria-hidden="true">·</span><span>最近更新于 ${cnDate(latestDate)}</span></p>
      </div>
      <aside class="hero-now" aria-label="此刻">
        <p class="now-title">此刻</p>
        <ul class="now-list">
          ${site.now
            .map(
              (item) => `<li><span class="now-key">${item.label}</span><span class="now-val">${item.text}</span></li>`,
            )
            .join('')}
        </ul>
      </aside>`,
      'hero-inner',
    )}
  </section>

  ${
    featured.length
      ? `<section class="section">
    ${WRAP(
      `<h2 class="section-label"><span>精选</span><a href="/archive/" class="section-more">全部文章 →</a></h2>
      <div class="features">${featured.map(featuredCard).join('')}</div>`,
      'section-inner',
    )}
  </section>`
      : ''
  }

  <section class="section">
    ${WRAP(
      `<h2 class="section-label"><span>最近</span></h2>
      <ol class="post-list">${rest.map(postRow).join('')}</ol>
      <p class="section-foot"><a class="btn-ghost" href="/archive/">查看全部 ${posts.length} 篇文章 ${iconArrow}</a></p>`,
      'section-inner',
    )}
  </section>

  <section class="section">
    ${WRAP(
      `<div class="about-card">
        <div class="about-card-mark" aria-hidden="true">${site.mark}</div>
        <div class="about-card-body">
          <h2 class="about-card-title">关于这个角落</h2>
          <p>${site.aboutBlurb}</p>
          <p class="about-card-links">
            <a href="/about/">了解更多 →</a>
            <a href="/feed.xml">订阅 RSS</a>
          </p>
        </div>
      </div>`,
      'section-inner',
    )}
  </section>`;

  return page({
    title: '',
    description: site.description,
    canonical: '/',
    body,
    bodyClass: 'page-home',
  });
}

function postPage(post, index) {
  const prev = posts[index + 1];
  const next = posts[index - 1];

  const toc = post.toc.length
    ? `<aside class="toc" aria-label="本页目录">
      <p class="toc-title">本页目录</p>
      <ol class="toc-list">
        ${post.toc.map((h) => `<li class="toc-item lvl-${h.level}"><a href="#${encodeURIComponent(h.id)}">${h.text}</a></li>`).join('')}
      </ol>
    </aside>`
    : '';

  const body = `<div class="progress" data-progress aria-hidden="true"></div>
<div class="wrap post-layout">
  <article class="post">
    <header class="post-header">
      <p class="post-kicker">
        <time datetime="${post.date}">${cnDate(post.date)}</time>
        <span class="sep" aria-hidden="true">·</span>
        <span>${weekday(post.date)}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>约 ${post.minutes} 分钟</span>
      </p>
      <h1 class="post-title">${post.title}</h1>
      ${post.summary ? `<p class="post-summary">${post.summary}</p>` : ''}
      ${tagChips(post.tags)}
    </header>
    <div class="prose">${post.html}</div>
    <footer class="post-footer">
      <p class="post-end" aria-hidden="true">❖</p>
      <div class="post-taxo">
        <span class="post-taxo-label">归类于</span>
        ${tagChips(post.tags, { small: true })}
      </div>
      <p class="post-license">本文由 ${site.author} 撰写，采用 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> 许可协议。欢迎引用，请注明出处。</p>
    </footer>
  </article>
  ${toc}
</div>
<nav class="post-pager-wrap" aria-label="上一篇与下一篇">
  ${WRAP(
    `<div class="post-pager">
      ${
        prev
          ? `<a class="pager-card prev" href="${prev.url}"><span class="pager-dir">← 更早</span><span class="pager-title">${prev.title}</span><span class="pager-date">${cnDate(prev.date)}</span></a>`
          : '<span class="pager-card empty"></span>'
      }
      ${
        next
          ? `<a class="pager-card next" href="${next.url}"><span class="pager-dir">更新 →</span><span class="pager-title">${next.title}</span><span class="pager-date">${cnDate(next.date)}</span></a>`
          : '<span class="pager-card empty"></span>'
      }
    </div>`,
    'pager-inner',
  )}
</nav>`;

  return page({
    title: post.title,
    description: post.summary || site.description,
    canonical: post.url,
    type: 'article',
    published: post.date,
    body,
    bodyClass: 'page-post',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.summary,
      datePublished: `${post.date}T09:00:00+08:00`,
      author: { '@type': 'Person', name: site.author },
      keywords: post.tags.join(', '),
      mainEntityOfPage: `${ORIGIN}${post.url}`,
      inLanguage: 'zh-CN',
    },
  });
}

function archivePage() {
  const byYear = new Map();
  for (const post of posts) {
    const year = post.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(post);
  }

  const groups = [...byYear.entries()]
    .map(
      ([year, items]) => `<section class="archive-year">
        <h2 class="archive-year-title">${year}<span class="archive-count">${items.length} 篇</span></h2>
        <ol class="archive-list">
          ${items
            .map(
              (p) => `<li>
            <a href="${p.url}">
              <time datetime="${p.date}">${shortDate(p.date)}</time>
              <span class="archive-title">${p.title}</span>
              <span class="archive-tags">${p.tags.join(' · ')}</span>
            </a>
          </li>`,
            )
            .join('')}
        </ol>
      </section>`,
    )
    .join('');

  const body = `<div class="wrap page-head">
    <p class="page-kicker">Archive</p>
    <h1 class="page-title">归档</h1>
    <p class="page-desc">共 ${posts.length} 篇文章${byYear.size > 1 ? `，分布在 ${byYear.size} 个年份` : ''}，按时间倒序排列。最早的写于 ${cnDate(posts[posts.length - 1]?.date || latestDate)}。</p>
  </div>
  <div class="wrap archive">${groups}</div>`;

  return page({
    title: '归档',
    description: `${site.title}的全部文章归档，共 ${posts.length} 篇。`,
    canonical: '/archive/',
    body,
    active: '/archive/',
  });
}

function tagsPage() {
  const sorted = [...tags].sort((a, b) => tagCount(b) - tagCount(a) || a.localeCompare(b, 'zh'));
  const body = `<div class="wrap page-head">
    <p class="page-kicker">Tags</p>
    <h1 class="page-title">标签</h1>
    <p class="page-desc">${tags.length} 个标签，记录这些文字散落在哪些主题上。</p>
  </div>
  <div class="wrap tag-index">
    ${sorted
      .map((tag) => {
        const recent = posts.filter((p) => p.tags.includes(tag)).slice(0, 3);
        return `<a class="tag-card" href="/tags/${encodeURIComponent(slugify(tag))}/">
          <span class="tag-card-head">
            <span class="tag-card-name">${tag}</span>
            <span class="tag-card-count">${tagCount(tag)} 篇</span>
          </span>
          <ul class="tag-card-posts">
            ${recent.map((p) => `<li>${p.title}</li>`).join('')}
          </ul>
        </a>`;
      })
      .join('')}
  </div>`;

  return page({
    title: '标签',
    description: `${site.title}的全部标签。`,
    canonical: '/tags/',
    body,
    active: '/tags/',
  });
}

function tagPage(tag) {
  const items = posts.filter((p) => p.tags.includes(tag));
  const body = `<div class="wrap page-head">
    <p class="page-kicker">Tag</p>
    <h1 class="page-title">${tag}</h1>
    <p class="page-desc">${items.length} 篇文章带有这个标签。</p>
  </div>
  <div class="wrap">
    <ol class="post-list">${items.map(postRow).join('')}</ol>
    <p class="section-foot"><a class="btn-ghost" href="/tags/">← 全部标签</a></p>
  </div>`;

  return page({
    title: `标签：${tag}`,
    description: `${site.title}中标签为「${tag}」的文章。`,
    canonical: `/tags/${encodeURIComponent(slugify(tag))}/`,
    body,
    active: '/tags/',
  });
}

function aboutPage() {
  const raw = fs.readFileSync(path.join(CONTENT, 'pages', 'about.md'), 'utf8');
  const { data, body: md } = parseFrontmatter(raw);
  const { html } = renderMarkdown(md);

  const body = `<div class="wrap page-head">
    <p class="page-kicker">About</p>
    <h1 class="page-title">${data.title || '关于'}</h1>
    ${data.summary ? `<p class="page-desc">${data.summary}</p>` : ''}
  </div>
  <div class="wrap about-layout">
    <article class="prose about-prose">${html}</article>
    <aside class="about-side">
      <div class="monogram" aria-hidden="true">${site.mark}</div>
      <p class="about-side-note">${site.subtitle}</p>
      <dl class="facts">
        <div><dt>文章</dt><dd>${posts.length} 篇</dd></div>
        <div><dt>标签</dt><dd>${tags.length} 个</dd></div>
        <div><dt>起始</dt><dd>${posts[posts.length - 1]?.date.slice(0, 4) || '—'}</dd></div>
      </dl>
      <p class="about-side-link"><a href="/feed.xml">RSS 订阅</a> · <a href="${site.github}" target="_blank" rel="noopener">GitHub</a></p>
    </aside>
  </div>`;

  return page({
    title: data.title || '关于',
    description: data.summary || site.description,
    canonical: '/about/',
    body,
    active: '/about/',
    bodyClass: 'page-about',
  });
}

function notFoundPage() {
  const body = `<div class="wrap notfound">
    <p class="notfound-code" aria-hidden="true">404</p>
    <h1 class="notfound-title">这一页走丢了</h1>
    <p class="notfound-text">链接可能已经失效，或者这篇文章还没有被写出来。</p>
    <div class="notfound-links">
      <a class="btn-ghost" href="/">回到首页</a>
      <a class="btn-ghost" href="/archive/">浏览归档</a>
    </div>
  </div>`;

  return page({
    title: '页面未找到',
    description: '404 — 页面未找到。',
    canonical: '/404.html',
    body,
    bodyClass: 'page-404',
  });
}

/* ------------------------------------------------------------------ *
 * feed / sitemap / search index
 * ------------------------------------------------------------------ */

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function feed() {
  const items = posts
    .slice(0, 20)
    .map(
      (p) => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${ORIGIN}${p.url}</link>
      <guid isPermaLink="true">${ORIGIN}${p.url}</guid>
      <pubDate>${new Date(`${p.date}T09:00:00+08:00`).toUTCString()}</pubDate>
      <description>${xmlEscape(p.summary)}</description>
      ${p.tags.map((t) => `<category>${xmlEscape(t)}</category>`).join('')}
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(site.title)}</title>
    <link>${ORIGIN}/</link>
    <description>${xmlEscape(site.description)}</description>
    <language>zh-CN</language>
    <copyright>${site.author}</copyright>
    <lastBuildDate>${new Date(`${latestDate}T09:00:00+08:00`).toUTCString()}</lastBuildDate>
    <atom:link href="${ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function sitemap() {
  const urls = [
    { loc: '/', lastmod: latestDate },
    { loc: '/archive/', lastmod: latestDate },
    { loc: '/tags/', lastmod: latestDate },
    { loc: '/about/', lastmod: latestDate },
    ...posts.map((p) => ({ loc: p.url, lastmod: p.date })),
    ...tags.map((t) => ({ loc: `/tags/${encodeURIComponent(slugify(t))}/`, lastmod: latestDate })),
  ];

  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${ORIGIN}${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

function searchIndex() {
  const items = posts.map((p) => ({
    title: p.title,
    url: p.url,
    date: p.date,
    tags: p.tags,
    summary: p.summary,
    text: stripTags(p.html).replace(/\s+/g, ' ').trim().slice(0, 1600),
  }));
  return JSON.stringify({ generated: new Date().toISOString(), items });
}

/* ------------------------------------------------------------------ *
 * assets + writing
 * ------------------------------------------------------------------ */

const assetHashes = new Map();
for (const file of fs.readdirSync(SRC).filter((f) => f === 'styles.css' || f === 'app.js')) {
  const buf = fs.readFileSync(path.join(SRC, file));
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const ext = path.extname(file);
  assetHashes.set(file, `/assets/${path.basename(file, ext)}.${hash}${ext}`);
}

function assetUrl(file) {
  return assetHashes.get(file) || `/assets/${file}`;
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function write(relPath, contents) {
  const target = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

/* ------------------------------------------------------------------ *
 * build
 * ------------------------------------------------------------------ */

const started = Date.now();
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

copyDir(PUBLIC, DIST);

for (const [file, url] of assetHashes) {
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(SRC, file), path.join(DIST, url));
}

const written = [];
const emit = (rel, contents) => {
  write(rel, contents);
  written.push(rel);
};

emit('index.html', homePage());
posts.forEach((post, i) => emit(`${post.url.slice(1)}index.html`, postPage(post, i)));
emit('archive/index.html', archivePage());
emit('tags/index.html', tagsPage());
for (const tag of tags) emit(`tags/${slugify(tag)}/index.html`, tagPage(tag));
emit('about/index.html', aboutPage());
emit('404.html', notFoundPage());
emit('feed.xml', feed());
emit('sitemap.xml', sitemap());
emit('search.json', searchIndex());
emit(
  'robots.txt',
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const totalBytes = written.reduce((sum, rel) => sum + fs.statSync(path.join(DIST, rel)).size, 0);

console.log(`\n  ${site.title} — 构建完成`);
console.log(`  ${written.length} 个页面 · ${posts.length} 篇文章 · ${tags.length} 个标签`);
console.log(`  ${kb(totalBytes)} HTML · ${(Date.now() - started) / 1000}s\n`);
for (const rel of written.filter((f) => f.endsWith('.html'))) console.log(`  · /${rel.replace(/index\.html$/, '')}`);
