/* =========================================================
   Gulnish Crochet — Live search overlay
   ========================================================= */
(function () {
  "use strict";

  var GC = window.GC;
  var overlay, panel, input, resultsEl, closeBtn, suggestEl, hintEl, emptyEl;
  var isOpen = false;
  var cursor = -1;
  var hitsCache = [];
  var firstFocusable;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* True on the catalogue page. Vercel serves /products via cleanUrls, but a
     plain static host (or file://) leaves the .html in the path — and the
     .html variant is also what a local preview uses, so matching only
     /products sent search hits to a full page reload instead of opening the
     product in place. */
  function onProductsPage() {
    return /\/products(\.html)?\/?$/.test(location.pathname);
  }

  function openProductById(id) {
    if (onProductsPage() && window.showProduct) {
      window.showProduct(id);
    } else {
      location.href = '/products?q=' + encodeURIComponent(id);
    }
  }

  function money(v) {
    var n = parseFloat(v) || 0;
    var str = String(Math.round(n * 100) / 100);
    var parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "Rs. " + parts.join(".");
  }

  function categoryLabel(val) {
    if (GC && GC.settings) {
      var idx = parseInt(String(val || '').replace('gr', ''), 10) - 1;
      var cats = GC.settings.categories || [];
      if (idx >= 0 && cats[idx]) return cats[idx];
    }
    return val || '';
  }

  function subcategoryLabel(catKey, subKey) {
    if (GC && GC.subcategoryLabelOf) return GC.subcategoryLabelOf(catKey, subKey) || '';
    return '';
  }

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    panel = document.createElement('div');
    panel.className = 'search-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Search products');

    var top = document.createElement('div');
    top.className = 'search-panel__top';

    var icon = document.createElement('span');
    icon.className = 'search-panel__icon';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    input = document.createElement('input');
    input.type = 'search';
    input.className = 'search-panel__input';
    input.placeholder = 'Search products, colors, keywords...';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    hintEl = document.createElement('span');
    hintEl.className = 'search-panel__hint';
    hintEl.innerHTML = 'ESC to close &bull; ↑↓ arrows &bull; ↵ to open';

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'search-panel__close';
    closeBtn.setAttribute('aria-label', 'Close search');
    closeBtn.style.cssText =
      'width:34px;height:34px;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer;font-size:1.2rem;line-height:1;display:grid;place-items:center;';
    closeBtn.innerHTML = '&times;';

    top.appendChild(icon);
    top.appendChild(input);
    top.appendChild(hintEl);
    top.appendChild(closeBtn);

    suggestEl = document.createElement('div');
    suggestEl.className = 'search-suggest';

    resultsEl = document.createElement('div');
    resultsEl.className = 'search-panel__results';

    emptyEl = document.createElement('div');
    emptyEl.className = 'search-empty';
    emptyEl.hidden = true;
    emptyEl.innerHTML =
      '<strong>No results found</strong><p>Try a different keyword or browse our categories.</p>';

    var foot = document.createElement('div');
    foot.className = 'search-panel__foot';
    foot.innerHTML =
      '<div><kbd>Enter</kbd> open product &bull; <kbd>Esc</kbd> close &bull; <kbd>↑</kbd> <kbd>↓</kbd> navigate</div><div>Searches name, category, keywords & colors</div>';

    panel.appendChild(top);
    panel.appendChild(suggestEl);
    panel.appendChild(resultsEl);
    panel.appendChild(emptyEl);
    panel.appendChild(foot);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    firstFocusable = input;

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener('click', close);
    /* Pass the value explicitly. A bare `debounce(render, 160)` would hand
       render() the InputEvent, so every query would stringify to
       "[object InputEvent]" and match nothing. */
    input.addEventListener('input', debounce(function () { render(input.value); }, 160));
    input.addEventListener('keydown', onKey);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
        return;
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        open();
        return;
      }
      if (e.key === 'Escape' && isOpen) close();
    });

    // quick suggestions
    suggestEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.search-chip');
      if (chip) {
        input.value = chip.dataset.q || chip.textContent;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    });
    resultsEl.addEventListener('click', function (e) {
      var hit = e.target.closest('.search-hit');
      if (hit) {
        var id = hit.dataset.id;
        close();
        if (id) {
          openProductById(id);
        }
      }
    });
    resultsEl.addEventListener('mousemove', function (e) {
      var hit = e.target.closest('.search-hit');
      if (!hit) return;
      var idx = Array.prototype.indexOf.call(resultsEl.querySelectorAll('.search-hit'), hit);
      setCursor(idx);
    });
  }

  function open() {
    buildOverlay();
    isOpen = true;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      input.value = '';
      render('');
      input.focus();
    }, 10);
  }

  function close() {
    if (!overlay) return;
    isOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    cursor = -1;
    /* Send focus back to whatever opened the overlay. Without this a
       keyboard user is dropped at the top of the document after Esc, and
       the next Tab starts again from the header. */
    if (returnFocusTo && returnFocusTo.isConnected) {
      try { returnFocusTo.focus({ preventScroll: true }); } catch (e) { returnFocusTo.focus(); }
    }
    returnFocusTo = null;
  }

  function getProducts() {
    return (GC && GC.products) || [];
  }

  function tokenise(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s\+\/\.\-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function score(p, q) {
    if (!q) return 0;
    var name = String(p.name || '').toLowerCase();
    var cat = (categoryLabel(p.category) || '').toLowerCase();
    var sub = (subcategoryLabel(p.category, p.subcategory) || '').toLowerCase();
    var keys = (Array.isArray(p.keywords) ? p.keywords.join(' ') : '').toLowerCase();
    var cols = (p.colors || []).map(function (c) { return (c.name || '').toLowerCase(); }).join(' ');
    var hay = [name, cat, sub, keys, cols].join('  ');
    var toks = tokenise(q);
    var s = 0;
    toks.forEach(function (t) {
      if (!t) return;
      if (name === t) s += 40;
      if (name.indexOf(t) === 0) s += 24;
      if (name.indexOf(t) >= 0) s += 10;
      if (cat.indexOf(t) >= 0) s += 6;
      if (sub.indexOf(t) >= 0) s += 6;
      if (keys.indexOf(t) >= 0) s += 4;
      if (cols.indexOf(t) >= 0) s += 4;
    });
    return s;
  }

  function render(q) {
    var products = getProducts();
    var query = String(q || '').trim();
    hitsCache = [];

    if (!query) {
      // suggestions
      suggestEl.innerHTML = '';
      var sugg = ['Bags', 'Purses', 'Keychains', 'Jewellery', 'Gajrays', 'Bouquet', 'School', 'Custom'];
      sugg.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'search-chip';
        b.dataset.q = t;
        b.textContent = t;
        suggestEl.appendChild(b);
      });
      resultsEl.innerHTML = '';
      emptyEl.hidden = true;
      cursor = -1;
      return;
    }

    suggestEl.innerHTML = '';

    var list = products
      .map(function (p) { return Object.assign({}, p, { _s: score(p, query) }); })
      .filter(function (p) { return p._s > 0 || query.length <= 2; })
      .sort(function (a, b) { return b._s - a._s || a.name.localeCompare(b.name); })
      .slice(0, 12);

    if (query.length >= 2) {
      list = list.filter(function (p) { return p._s > 0; });
    }

    hitsCache = list;
    resultsEl.innerHTML = '';
    emptyEl.hidden = hitsCache.length !== 0;

    hitsCache.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'search-hit';
      row.dataset.id = p.id;

      var img = document.createElement('img');
      if (p.image) {
        img.className = 'search-hit__img';
        img.loading = 'lazy';
        img.src = p.image;
        img.alt = '';
      } else {
        var ph = document.createElement('div');
        ph.className = 'search-hit__img search-hit__img--ph';
        ph.innerHTML =
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15.5l-4.8-4.8L6.5 20.5"/></svg>';
        img = ph;
      }
      row.appendChild(img);

      var body = document.createElement('div');
      body.className = 'search-hit__body';
      var name = document.createElement('div');
      name.className = 'search-hit__name';
      name.textContent = p.name || '';
      var cat = document.createElement('div');
      cat.className = 'search-hit__cat';
      var cl = categoryLabel(p.category);
      var sl = subcategoryLabel(p.category, p.subcategory);
      cat.textContent = sl ? (cl + ' · ' + sl) : (cl || '');
      body.appendChild(name);
      body.appendChild(cat);
      row.appendChild(body);

      var price = document.createElement('div');
      price.className = 'search-hit__price';
      var pr = parseFloat(p.price) > 0 ? money(p.price) : '';
      price.textContent = pr;
      row.appendChild(price);

      resultsEl.appendChild(row);
    });

    cursor = -1;
    setCursor(-1);
  }

  function setCursor(i) {
    var els = resultsEl.querySelectorAll('.search-hit');
    els.forEach(function (el, idx) {
      el.classList.toggle('is-cursor', idx === i);
    });
    cursor = i;
  }

  function moveCursor(dir) {
    var els = resultsEl.querySelectorAll('.search-hit');
    if (!els.length) return;
    cursor = cursor + dir;
    if (cursor < 0) cursor = els.length - 1;
    if (cursor >= els.length) cursor = 0;
    setCursor(cursor);
    var active = els[cursor];
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function openActive() {
    var els = resultsEl.querySelectorAll('.search-hit');
    if (cursor >= 0 && els[cursor]) {
      els[cursor].click();
    } else if (hitsCache[0]) {
      close();
      openProductById(hitsCache[0].id);
    }
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCursor(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openActive();
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // wire header search buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-open-search]');
    if (btn) {
      e.preventDefault();
      open();
      return;
    }
  });

  window.GulnishSearch = { open: open, close: close };
})();
