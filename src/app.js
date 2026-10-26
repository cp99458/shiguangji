/**
 * 拾光集 — client behaviour.
 * No framework: theme, search, code copy, reading progress, active TOC item.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- theme ---------------- */

  const themeToggle = document.querySelector('[data-theme-toggle]');
  const applyTheme = (theme, persist = true) => {
    root.setAttribute('data-theme', theme);
    if (persist) {
      try {
        localStorage.setItem('theme', theme);
      } catch (_) {
        /* private mode */
      }
    }
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
      themeToggle.setAttribute('title', theme === 'dark' ? '切换到浅色' : '切换到深色');
    }
  };

  if (themeToggle) {
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
    themeToggle.addEventListener('click', () => {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------------- search ---------------- */

  const dialog = document.querySelector('[data-search]');
  const input = document.querySelector('[data-search-input]');
  const results = document.querySelector('[data-search-results]');
  const openers = document.querySelectorAll('[data-open-search]');

  let indexPromise = null;
  let items = [];
  let selected = -1;
  let lastFocus = null;

  const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const loadIndex = () => {
    if (!indexPromise) {
      indexPromise = fetch('/search.json', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data) => {
          items = data.items || [];
          return items;
        })
        .catch(() => {
          items = [];
          return items;
        });
    }
    return indexPromise;
  };

  function highlight(text, needle) {
    const safe = escapeHtml(text);
    if (!needle) return safe;
    const pattern = needle
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    if (!pattern) return safe;
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  }

  function scoreItem(item, needle, tokens) {
    const title = item.title.toLowerCase();
    const tags = item.tags.join(' ').toLowerCase();
    const summary = (item.summary || '').toLowerCase();
    const text = (item.text || '').toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (title.includes(token)) score += 12;
      if (tags.includes(token)) score += 6;
      if (summary.includes(token)) score += 4;
      if (text.includes(token)) score += 1;
    }
    if (title.includes(needle)) score += 15;
    return score;
  }

  function snippetFor(item, tokens) {
    const text = item.summary || item.text || '';
    const lower = text.toLowerCase();
    const at = tokens.map((t) => lower.indexOf(t)).filter((i) => i > 0)[0];
    if (at === undefined) return text.slice(0, 110);
    const start = Math.max(0, at - 40);
    return (start > 0 ? '…' : '') + text.slice(start, start + 130) + '…';
  }

  function renderResults(needle) {
    const tokens = needle.toLowerCase().split(/\s+/).filter(Boolean);
    if (!needle) {
      renderIdle();
      return;
    }
    const ranked = items
      .map((item) => ({ item, score: scoreItem(item, needle.toLowerCase(), tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    selected = ranked.length ? 0 : -1;

    if (!ranked.length) {
      results.innerHTML = `<p class="search-empty">没有找到「${escapeHtml(needle)}」相关的文章</p>`;
      return;
    }

    results.innerHTML = ranked
      .map(
        ({ item }, i) => `<a class="search-item" href="${item.url}" role="option"
          aria-selected="${i === 0}" data-index="${i}">
          <span class="search-item-title">${highlight(item.title, needle)}</span>
          <span class="search-item-meta">${item.date} · ${escapeHtml(item.tags.join(' / '))}</span>
          <span class="search-item-snippet">${highlight(snippetFor(item, tokens), needle)}</span>
        </a>`,
      )
      .join('');
  }

  function renderIdle() {
    selected = -1;
    const recent = [...items].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    if (!recent.length) {
      results.innerHTML = '<p class="search-empty">开始输入以搜索</p>';
      return;
    }
    results.innerHTML =
      '<p class="search-empty" style="padding-bottom:.4rem">最近更新</p>' +
      recent
        .map(
          (item, i) => `<a class="search-item" href="${item.url}" role="option" data-index="${i}">
            <span class="search-item-title">${escapeHtml(item.title)}</span>
            <span class="search-item-meta">${item.date} · ${escapeHtml(item.tags.join(' / '))}</span>
          </a>`,
        )
        .join('');
  }

  function moveSelection(delta) {
    const nodes = results.querySelectorAll('.search-item');
    if (!nodes.length) return;
    nodes.forEach((n) => n.setAttribute('aria-selected', 'false'));
    selected = (selected + delta + nodes.length) % nodes.length;
    const node = nodes[selected];
    node.setAttribute('aria-selected', 'true');
    node.scrollIntoView({ block: 'nearest' });
  }

  async function openSearch() {
    if (!dialog) return;
    lastFocus = document.activeElement;
    dialog.hidden = false;
    document.body.style.overflow = 'hidden';
    input.value = '';
    input.focus();
    results.innerHTML = '<p class="search-empty">载入中…</p>';
    const loaded = await loadIndex();
    if (loaded.length) renderIdle();
    else results.innerHTML = '<p class="search-empty">搜索索引尚未生成</p>';
  }

  function closeSearch() {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (dialog && input) {
    openers.forEach((btn) => btn.addEventListener('click', openSearch));
    dialog.querySelectorAll('[data-close-search]').forEach((el) => el.addEventListener('click', closeSearch));

    input.addEventListener('input', () => renderResults(input.value.trim()));

    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === 'Enter') {
        const node = results.querySelector('.search-item[aria-selected="true"]');
        if (node) {
          event.preventDefault();
          window.location.href = node.getAttribute('href');
        }
      }
    });

    document.addEventListener('keydown', (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dialog.hidden ? openSearch() : closeSearch();
      } else if (event.key === '/' && !typing && dialog.hidden) {
        event.preventDefault();
        openSearch();
      }
    });

    // platform hint in the header button
    const hint = document.querySelector('.hint');
    if (hint && !/mac/i.test(navigator.platform || '')) hint.textContent = 'Ctrl K';
  }

  /* ---------------- code copy ---------------- */

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const block = button.closest('.code-block');
      const code = block?.querySelector('code');
      if (!code) return;
      const text = code.textContent || '';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        const original = button.textContent;
        button.textContent = '已复制';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove('copied');
        }, 1600);
      } catch (_) {
        button.textContent = '复制失败';
      }
    });
  });

  /* ---------------- reading progress ---------------- */

  const progress = document.querySelector('[data-progress]');
  if (progress) {
    let ticking = false;
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      progress.style.transform = `scaleX(${ratio})`;
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  /* ---------------- active table of contents ---------------- */

  const tocLinks = [...document.querySelectorAll('.toc-item a')];
  if (tocLinks.length) {
    const byId = new Map();
    tocLinks.forEach((link) => {
      const id = decodeURIComponent((link.getAttribute('href') || '').slice(1));
      byId.set(id, link);
    });

    const headings = [...document.querySelectorAll('.prose h2, .prose h3')].filter((h) => byId.has(h.id));
    let currentId = '';

    const updateActive = () => {
      if (!headings.length) return;
      const marker = window.scrollY + 140;
      let next = headings[0].id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top + window.scrollY <= marker) next = heading.id;
      }
      // stay on the last heading when the reader reaches the bottom of the page
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 120) {
        next = headings[headings.length - 1].id;
      }
      if (next === currentId) return;
      currentId = next;
      byId.forEach((link) => link.classList.remove('active'));
      byId.get(next)?.classList.add('active');
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateActive();
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateActive();
  }

  /* ---------------- smooth-scroll offset for in-page links ---------------- */

  if (!reduceMotion) {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = id && document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top, behavior: 'smooth' });
      history.replaceState(null, '', `#${link.getAttribute('href').slice(1)}`);
    });
  }
})();
