/* =========================================================
   Gulnish Crochet — Wishlist (localStorage)
   ========================================================= */
(function () {
  "use strict";

  var GC = window.GC;
  var KEY = 'gulnish-wishlist';
  var wishlist = load();
  var panel, overlay, itemsEl, countEl, headCount, emptyEl, closeBtn, clearBtn;

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(wishlist));
    updateBadges();
    renderPanel();
    /* Cards re-render on every filter/search/pagination pass, so the heart
       states have to be reapplied from outside too. */
    document.dispatchEvent(new CustomEvent('gc:wishlist-change'));
  }

  function has(id) {
    return wishlist.some(function (x) { return x.id === id; });
  }

  function add(p) {
    if (!p || !p.id) return;
    if (has(p.id)) return remove(p.id);
    wishlist.unshift({
      id: p.id,
      name: p.name || '',
      price: p.price || 0,
      image: p.image || '',
      category: p.category || '',
      subcategory: p.subcategory || ''
    });
    save();
    showToast('Added to wishlist');
  }

  function remove(id) {
    wishlist = wishlist.filter(function (x) { return x.id !== id; });
    save();
    showToast('Removed from wishlist');
  }

  function clearAll() {
    wishlist = [];
    save();
  }

  function updateBadges() {
    var c = wishlist.length;
    document.querySelectorAll('[data-wl-count]').forEach(function (el) {
      el.textContent = String(c);
      el.classList.toggle('show', c > 0);
    });
    if (headCount) headCount.textContent = '(' + c + ')';
  }

  function getProducts() {
    return (GC && GC.products) || [];
  }

  function find(pId) {
    return getProducts().find(function (x) { return x.id === pId; }) || null;
  }

  function money(v) {
    var n = parseFloat(v) || 0;
    var str = String(Math.round(n * 100) / 100);
    var parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "Rs. " + parts.join(".");
  }

  function buildPanel() {
    if (panel) return;
    overlay = document.createElement('div');
    overlay.className = 'wl-overlay';

    panel = document.createElement('aside');
    panel.className = 'wl-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    var head = document.createElement('div');
    head.className = 'wl-head';
    var h = document.createElement('div');
    h.className = 'wl-head__title';
    h.innerHTML = 'Wishlist <span class="wl-head__count"></span>';
    headCount = h.querySelector('.wl-head__count');
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wl-close';
    closeBtn.setAttribute('aria-label', 'Close wishlist');
    closeBtn.innerHTML = '&times;';
    head.appendChild(h);
    head.appendChild(closeBtn);

    itemsEl = document.createElement('div');
    itemsEl.className = 'wl-items';

    emptyEl = document.createElement('div');
    emptyEl.className = 'wl-empty';
    emptyEl.innerHTML =
      '<div class="wl-empty__icon"><svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><strong>Your wishlist is empty</strong><p>Tap the heart on any product to save it here.</p>';

    var foot = document.createElement('div');
    foot.className = 'wl-foot';
    var shopAll = document.createElement('a');
    shopAll.href = '/products';
    shopAll.className = 'btn btn--ghost';
    shopAll.textContent = 'Continue Shopping';
    clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--danger';
    clearBtn.textContent = 'Clear Wishlist';
    var note = document.createElement('div');
    note.className = 'wl-foot__note';
    note.textContent = 'Your wishlist is saved on this device only';
    foot.appendChild(shopAll);
    foot.appendChild(clearBtn);
    foot.appendChild(note);

    panel.appendChild(head);
    panel.appendChild(itemsEl);
    panel.appendChild(emptyEl);
    panel.appendChild(foot);
    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', close);
    clearBtn.addEventListener('click', function () { clearAll(); renderPanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
  }

  function isOpen() {
    return panel && panel.classList.contains('is-open');
  }

  function open() {
    buildPanel();
    renderPanel();
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function renderPanel() {
    if (!itemsEl) return;
    itemsEl.innerHTML = '';
    emptyEl.hidden = wishlist.length !== 0;
    wishlist.forEach(function (w) {
      var p = find(w.id) || w;
      var it = document.createElement('div');
      it.className = 'wl-item';

      var imgWrap = document.createElement('div');
      if (p.image) {
        var im = document.createElement('img');
        im.className = 'wl-item__img';
        im.src = p.image;
        im.alt = '';
        imgWrap = im;
      } else {
        imgWrap = document.createElement('div');
        imgWrap.className = 'wl-item__img wl-item__img--ph';
        imgWrap.innerHTML =
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15.5l-4.8-4.8L6.5 20.5"/></svg>';
      }
      it.appendChild(imgWrap);

      var b = document.createElement('div');
      b.className = 'wl-item__body';
      var nm = document.createElement('div');
      nm.className = 'wl-item__name';
      nm.textContent = p.name || '';
      var pr = document.createElement('div');
      pr.className = 'wl-item__price';
      pr.textContent = parseFloat(p.price) > 0 ? money(p.price) : '';
      var row = document.createElement('div');
      row.className = 'wl-item__row';
      var addc = document.createElement('button');
      addc.type = 'button';
      addc.className = 'wl-mini wl-mini--primary';
      addc.textContent = 'Add to Cart';
      addc.dataset.wlAdd = p.id;
      var view = document.createElement('a');
      view.href = '/products?q=' + encodeURIComponent(p.id);
      view.className = 'wl-mini';
      view.textContent = 'View';
      view.dataset.wl-view = p.id;
      row.appendChild(addc);
      row.appendChild(view);
      b.appendChild(nm);
      b.appendChild(pr);
      b.appendChild(row);
      it.appendChild(b);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'wl-item__remove';
      rm.setAttribute('aria-label', 'Remove');
      rm.innerHTML = '&times;';
      rm.dataset.wl-remove = p.id;
      it.appendChild(rm);

      itemsEl.appendChild(it);
    });
  }

  function showToast(msg) {
    if (window.showToast) return window.showToast(msg);
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg || '';
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 280); }, 1600);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-wishlist-toggle]');
    if (t) {
      e.preventDefault();
      var id = t.dataset.id;
      if (id) {
        var p = find(id) || { id: id };
        add(p);
        var on = has(id);
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
        t.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Save to wishlist');
      }
      return;
    }
    var openBtn = e.target.closest('[data-open-wishlist]');
    if (openBtn) {
      e.preventDefault();
      open();
      return;
    }
    var rm = e.target.closest('[data-wl-remove]');
    if (rm) {
      remove(rm.dataset.wlRemove);
      return;
    }
    var addc = e.target.closest('[data-wl-add]');
    if (addc) {
      var pid = addc.dataset.wlAdd;
      var pf = find(pid) || { id: pid };
      if (window.addToCart) {
        window.addToCart({ id: pf.id, name: pf.name || '', price: parseFloat(pf.price) || 0, image: pf.image || '' });
      }
      remove(pid);
      return;
    }
    var v = e.target.closest('[data-wl-view]');
    if (v) {
      close();
      if (location.pathname !== '/products' && window.GulnishQuickView) {
        // go to products or quick view not needed
      }
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', updateBadges);
  setTimeout(updateBadges, 120);
  window.addEventListener('storage', function (e) { if (e.key === KEY) { wishlist = load(); updateBadges(); renderPanel(); } });

  window.GulnishWishlist = { add: add, remove: remove, has: has, open: open, close: close, list: function () { return wishlist.slice(); } };
})();
