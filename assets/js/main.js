/* RootDas Pentest Book — progressive enhancements (no dependencies) */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function icon(paths, size) {
    return '<svg class="icon" width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_COPY = icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
  var ICON_CHECK = icon('<path d="M20 6 9 17l-5-5"/>');
  var ICON_X = icon('<path d="M18 6 6 18M6 6l12 12"/>', 22);

  /* ---------- Theme (light / system / dark) ---------- */
  function applyTheme(value) {
    var root = document.documentElement;
    if (value === 'light' || value === 'dark') { root.setAttribute('data-theme', value); store('theme', value); }
    else { root.removeAttribute('data-theme'); store('theme', null); value = 'system'; }
    $$('[data-theme-value]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-theme-value') === value));
    });
  }
  applyTheme(store('theme') || 'system');
  $$('[data-theme-value]').forEach(function (b) {
    b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-value')); });
  });

  /* ---------- Navigation drawer ---------- */
  var nav = $('#site-nav');
  var openBtn = $('[data-nav-open]');
  var backdrop = $('.nav-backdrop');
  var desktop = window.matchMedia('(min-width: 1100px)');
  var outside = $$('.main, .topbar');

  function setNav(open) {
    if (!nav) return;
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    if (backdrop) backdrop.hidden = !open;
    if (openBtn) openBtn.setAttribute('aria-expanded', String(open));
    outside.forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { var first = $('.menu a', nav); if (first) first.focus(); }
    else if (openBtn && !desktop.matches) openBtn.focus();
  }
  if (openBtn) openBtn.addEventListener('click', function () { setNav(true); });
  $$('[data-nav-close]').forEach(function (el) { el.addEventListener('click', function () { setNav(false); }); });
  desktop.addEventListener && desktop.addEventListener('change', function (e) { if (e.matches) setNav(false); });
  if (nav) {
    nav.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !nav.classList.contains('is-open')) return;
      var items = $$('a[href], button:not([disabled])', nav).filter(function (el) { return el.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- Global keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav && nav.classList.contains('is-open')) setNav(false);
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); togglePalette(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); togglePalette(true); }
  });

  /* ---------- Command palette / search ---------- */
  var palette = $('#palette');
  var pInput = $('#palette-q');
  var pList = $('#palette-results');
  var index = null, results = [], selected = 0;

  function loadIndex() {
    if (index || !palette) return Promise.resolve(index);
    return fetch(palette.getAttribute('data-index'))
      .then(function (r) { return r.json(); })
      .then(function (data) { index = data; return data; })
      .catch(function () { index = []; return index; });
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function highlight(text, terms) {
    var out = escapeHtml(text);
    terms.forEach(function (t) {
      if (t.length < 2) return;
      out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    });
    return out;
  }
  function score(item, terms) {
    var title = (item.title || '').toLowerCase();
    var tags = (item.tags || []).join(' ').toLowerCase();
    var meta = [item.platform, item.category, item.difficulty, item.description].join(' ').toLowerCase();
    var body = (item.text || '').toLowerCase();
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], s = 0;
      if (title.indexOf(t) > -1) s += title.indexOf(t) === 0 ? 12 : 8;
      if (tags.indexOf(t) > -1) s += 5;
      if (meta.indexOf(t) > -1) s += 3;
      if (body.indexOf(t) > -1) s += 1;
      if (!s) return 0;
      total += s;
    }
    return total + (item.type === 'Write-up' ? 1 : 0);
  }
  function renderPalette() {
    var q = pInput.value.trim().toLowerCase();
    var terms = q.split(/\s+/).filter(Boolean);
    var data = index || [];
    results = terms.length
      ? data.map(function (it) { return { it: it, s: score(it, terms) }; })
          .filter(function (r) { return r.s > 0; })
          .sort(function (a, b) { return b.s - a.s; })
          .map(function (r) { return r.it; }).slice(0, 12)
      : data.slice(0, 12);
    selected = 0;
    if (!results.length) {
      pList.innerHTML = '<li class="palette-empty">No results for “' + escapeHtml(q) + '”</li>';
      return;
    }
    pList.innerHTML = results.map(function (it, i) {
      var sub = it.type === 'Page' ? 'Page' : [it.platform, it.difficulty, it.date].filter(Boolean).join(' · ');
      return '<li role="option" id="pr-' + i + '" aria-selected="' + (i === 0) + '"><a href="' + escapeHtml(it.url) + '"><strong>' +
        highlight(it.title, terms) + '</strong><span>' + escapeHtml(sub) + '</span></a></li>';
    }).join('');
    pInput.setAttribute('aria-activedescendant', 'pr-0');
  }
  function moveSelection(d) {
    var items = $$('[role="option"]', pList);
    if (!items.length) return;
    selected = (selected + d + items.length) % items.length;
    items.forEach(function (li, i) { li.setAttribute('aria-selected', String(i === selected)); });
    items[selected].scrollIntoView({ block: 'nearest' });
    pInput.setAttribute('aria-activedescendant', 'pr-' + selected);
  }
  function togglePalette(forceOpen) {
    if (!palette || typeof palette.showModal !== 'function') return;
    if (palette.open && !forceOpen) { palette.close(); return; }
    if (palette.open) return;
    if (nav && nav.classList.contains('is-open')) setNav(false);
    palette.showModal();
    pInput.value = '';
    loadIndex().then(renderPalette);
    pInput.focus();
  }
  if (palette) {
    $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', function () { togglePalette(true); }); });
    pInput.addEventListener('input', renderPalette);
    pInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var link = $('[aria-selected="true"] a', pList);
        if (link) window.location.href = link.href;
      }
    });
    palette.addEventListener('click', function (e) { if (e.target === palette) palette.close(); });
  }

  /* ---------- Write-up index filters (state kept in the URL) ---------- */
  var filters = $('[data-filters]');
  if (filters) {
    var cards = $$('[data-filter-list] .wcard');
    var status = $('[data-filter-status]');
    var empty = $('[data-filter-empty]');
    var params = new URLSearchParams(window.location.search);

    ['platform', 'difficulty', 'category'].forEach(function (name) {
      var v = params.get(name);
      if (v) { var r = $('input[name="' + name + '"][value="' + CSS.escape(v) + '"]', filters); if (r) r.checked = true; }
    });
    if (params.get('q')) filters.q.value = params.get('q');
    if (params.get('tag')) filters.q.value = params.get('tag');

    var applyFilters = function () {
      var q = filters.q.value.trim().toLowerCase();
      var sel = {};
      ['platform', 'difficulty', 'category'].forEach(function (n) {
        var c = $('input[name="' + n + '"]:checked', filters); sel[n] = c ? c.value : '';
      });
      var shown = 0;
      cards.forEach(function (card) {
        var ok = (!sel.platform || card.dataset.platform === sel.platform) &&
          (!sel.difficulty || card.dataset.difficulty === sel.difficulty) &&
          (!sel.category || card.dataset.category === sel.category) &&
          (!q || q.split(/\s+/).every(function (t) { return card.dataset.search.indexOf(t) > -1; }));
        card.hidden = !ok;
        if (ok) shown++;
      });
      if (status) status.textContent = shown + ' of ' + cards.length + ' write-ups';
      if (empty) empty.hidden = shown > 0;

      var p = new URLSearchParams();
      if (q) p.set('q', q);
      Object.keys(sel).forEach(function (k) { if (sel[k]) p.set(k, sel[k]); });
      var qs = p.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    };
    filters.addEventListener('input', applyFilters);
    filters.addEventListener('change', applyFilters);
    var reset = $('[data-filter-reset]');
    if (reset) reset.addEventListener('click', function () { filters.reset(); applyFilters(); filters.q.focus(); });
    applyFilters();
  }

  /* ---------- Write-up page ---------- */
  var article = $('#post-content');
  if (article) {
    // Heading ids + anchors
    var slugs = {};
    var headings = $$('h1, h2, h3', article);
    headings.forEach(function (h) {
      if (!h.id) {
        var base = h.textContent.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
        var id = base, n = 2;
        while (slugs[id] || document.getElementById(id)) id = base + '-' + n++;
        h.id = id;
      }
      slugs[h.id] = true;
      var a = document.createElement('a');
      a.className = 'heading-anchor';
      a.href = '#' + h.id;
      a.setAttribute('aria-label', 'Link to this section');
      a.textContent = '#';
      h.appendChild(a);
    });

    // Table of contents: top-level sections (h1/h2)
    var tocBox = $('[data-toc]');
    var tocNav = tocBox && $('.toc-nav', tocBox);
    var tocHeadings = headings.filter(function (h) { return h.tagName !== 'H3'; });
    if (tocNav && tocHeadings.length > 1) {
      var ol = document.createElement('ol');
      tocHeadings.forEach(function (h) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.textContent.trim() : h.textContent.replace(/#$/, '').trim();
        a.addEventListener('click', function () { if (!wide.matches) tocBox.open = false; });
        li.appendChild(a);
        ol.appendChild(li);
      });
      tocNav.appendChild(ol);
      var wide = window.matchMedia('(min-width: 1280px)');
      var syncToc = function () { tocBox.open = wide.matches; };
      syncToc();
      wide.addEventListener && wide.addEventListener('change', syncToc);

      if ('IntersectionObserver' in window) {
        var links = {};
        $$('a', tocNav).forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
        var current = null;
        var spy = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              if (current) current.classList.remove('is-active');
              current = links[en.target.id];
              if (current) {
                current.classList.add('is-active');
                if (wide.matches && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
              }
            }
          });
        }, { rootMargin: '-10% 0px -75% 0px' });
        tocHeadings.forEach(function (h) { spy.observe(h); });
      }
    } else if (tocBox) {
      tocBox.parentNode.hidden = true;
    }

    // Fences without a Rouge lexer (e.g. ```splunk) render as a bare <pre>: give them the same wrapper
    $$('pre', article).forEach(function (pre) {
      if (pre.closest('.highlighter-rouge, figure.highlight')) return;
      var code = $('code', pre);
      var wrap = document.createElement('div');
      wrap.className = 'highlighter-rouge ' + ((code && code.className.match(/language-[\w+-]+/)) || ['language-text'])[0];
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
    });

    // Code blocks: language label + copy button; keyboard-scrollable
    $$('div.highlighter-rouge, figure.highlight', article).forEach(function (block) {
      var pre = $('pre', block);
      if (!pre) return;
      pre.tabIndex = 0;
      var m = (block.className.match(/language-([\w+-]+)/) || [])[1];
      var head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML = '<span>' + (m && m !== 'plaintext' ? m : 'text') + '</span>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.innerHTML = ICON_COPY + '<span>Copy</span>';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      btn.addEventListener('click', function () {
        var text = pre.innerText.replace(/\n$/, '');
        var done = function () {
          btn.classList.add('is-copied');
          btn.innerHTML = ICON_CHECK + '<span>Copied</span>';
          setTimeout(function () { btn.classList.remove('is-copied'); btn.innerHTML = ICON_COPY + '<span>Copy</span>'; }, 1800);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
        else {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          ta.remove();
        }
      });
      head.appendChild(btn);
      block.insertBefore(head, block.firstChild);
    });

    // Tables scroll inside their own box instead of widening the page
    $$('table', article).forEach(function (t) {
      if (t.parentNode.classList.contains('table-scroll')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Scrollable table');
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    // Screenshots open in a lightbox
    var imgs = $$('img', article);
    if (imgs.length && typeof HTMLDialogElement === 'function') {
      var box = document.createElement('dialog');
      box.className = 'lightbox';
      box.setAttribute('aria-label', 'Image viewer');
      box.innerHTML = '<button class="icon-btn" type="button" aria-label="Close image">' + ICON_X + '</button><figure><img alt=""><figcaption></figcaption></figure>';
      document.body.appendChild(box);
      var bImg = $('img', box), bCap = $('figcaption', box);
      var close = function () { box.close(); };
      $('button', box).addEventListener('click', close);
      box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') close(); });
      var startY = null;
      box.addEventListener('touchstart', function (e) { if (e.touches.length === 1) startY = e.touches[0].clientY; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (startY !== null && Math.abs(e.changedTouches[0].clientY - startY) > 90) close();
        startY = null;
      });
      imgs.forEach(function (img) {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.classList.add('zoomable');
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        if (!img.hasAttribute('alt')) img.alt = 'Screenshot';
        var open = function () {
          bImg.src = img.currentSrc || img.src;
          bImg.alt = img.alt;
          bCap.textContent = img.alt && img.alt !== 'Screenshot' ? img.alt : '';
          box.showModal();
        };
        img.addEventListener('click', open);
        img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
    }

    // Reading progress
    var bar = $('.progress span');
    if (bar) {
      var ticking = false;
      var update = function () {
        var rect = article.getBoundingClientRect();
        var total = article.offsetHeight - window.innerHeight;
        var p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
        bar.style.transform = 'scaleX(' + p + ')';
        ticking = false;
      };
      window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
      update();
    }
  }

  /* ---------- Back to top ---------- */
  var toTop = $('[data-to-top]');
  if (toTop) {
    var onScroll = function () { toTop.hidden = window.scrollY < 900; };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      var main = $('#main'); if (main) main.focus({ preventScroll: true });
    });
  }
})();
