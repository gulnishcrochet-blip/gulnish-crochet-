/* =========================================================
   Gulnish Crochet — Quick View modal
   ========================================================= */
(function () {
  "use strict";

  var GC = window.GC;
  var modal, cardEl, closeBtn, mediaEl, thumbsEl, catEl, nameEl, priceEl, statusEl, colorsEl, descEl, addBtn, waBtn, current = null, currentQty = 1;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function buildModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'qv-modal';
    modal.setAttribute('aria-hidden', 'true');

    cardEl = document.createElement('div');
    cardEl.className = 'qv-card';
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-modal', 'true');
    cardEl.setAttribute('aria-label', 'Quick view');

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qv-close';
    closeBtn.setAttribute('aria-label', 'Close quick view');
    closeBtn.innerHTML = '&times;';

    var grid = document.createElement('div');
    grid.className = 'qv-grid';

    var mediaWrap = document.createElement('div');
    mediaWrap.className = 'qv-media';
    mediaEl = document.createElement('div');
    thumbsEl = document.createElement('div');
    thumbsEl.className = 'qv-thumbs';
    mediaWrap.appendChild(mediaEl);
    mediaWrap.appendChild(thumbsEl);

    var body = document.createElement('div');
    body.className = 'qv-body';

    catEl = document.createElement('div');
    catEl.className = 'qv-cat';
    nameEl = document.createElement('h3');
    nameEl.className = 'qv-name';
    priceEl = document.createElement('div');
    priceEl.className = 'qv-price';
    statusEl = document.createElement('div');
    statusEl.className = 'qv-status';
    colorsEl = document.createElement('div');
    colorsEl.className = 'qv-colors';
    var cLabel = document.createElement('span');
    cLabel.className = 'qv-colors-label';
    cLabel.textContent = 'Colors';
    colorsEl.appendChild(cLabel);

    descEl = document.createElement('div');
    descEl.className = 'qv-desc';

    var actions = document.createElement('div');
    actions.className = 'qv-actions';

    addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--primary';
    addBtn.textContent = 'Add to Cart';

    var viewFull = document.createElement('a');
    viewFull.href = '/products';
    viewFull.className = 'btn btn--ghost';
    viewFull.textContent = 'View full product';

    waBtn = document.createElement('a');
    waBtn.target = '_blank';
    waBtn.rel = 'noopener';
    waBtn.className = 'btn btn--wa';
    waBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>Customize on WhatsApp';

    actions.appendChild(addBtn);
    actions.appendChild(viewFull);
    actions.appendChild(waBtn);

    body.appendChild(catEl);
    body.appendChild(nameEl);
    body.appendChild(priceEl);
    body.appendChild(statusEl);
    body.appendChild(colorsEl);
    body.appendChild(descEl);
    body.appendChild(actions);

    grid.appendChild(mediaWrap);
    grid.appendChild(body);
    cardEl.appendChild(closeBtn);
    cardEl.appendChild(grid);
    modal.appendChild(cardEl);
    document.body.appendChild(modal);

    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });

    addBtn.addEventListener('click', function () {
      if (!current) return;
      /* Disabled attribute already blocks clicks, but a programmatic
         .click() would still land here, so re-check the state. */
      var st = String((current.status || '')).toLowerCase();
      if (st === 'sold out' || st === 'sold-out' ||
          (current.stock != null && parseInt(current.stock, 10) === 0)) {
        if (window.showToast) window.showToast('This piece is sold out — message us on WhatsApp');
        return;
      }
      var sel = colorsEl.querySelector('.color-swatch.selected');
      var img = mediaEl.querySelector('img');
      if (window.addToCart) {
        window.addToCart({
          id: current.id,
          name: current.name || '',
          price: parseFloat(current.price) || 0,
          color: sel ? sel.dataset.color : '',
          image: img && img.src ? img.currentSrc || img.src : '',
          qty: currentQty
        });
      }
      close();
    });

    thumbsEl.addEventListener('click', function (e) {
      var t = e.target.closest('.qv-thumb');
      if (!t) return;
      var src = t.dataset.src;
      var mainImg = mediaEl.querySelector('img');
      if (mainImg && src) mainImg.src = src;
      thumbsEl.querySelectorAll('.qv-thumb').forEach(function (x) { x.classList.toggle('is-active', x === t); });
    });

    colorsEl.addEventListener('click', function (e) {
      var sw = e.target.closest('.color-swatch');
      if (!sw) return;
      colorsEl.querySelectorAll('.color-swatch').forEach(function (x) { x.classList.remove('selected'); x.setAttribute('aria-pressed', 'false'); });
      sw.classList.add('selected');
      sw.setAttribute('aria-pressed', 'true');
    });
  }

  function isOpen() {
    return modal && modal.classList.contains('is-open');
  }

  function open(id) {
    var list = (GC && GC.products) || [];
    var p = list.find(function (x) { return x.id === id; });
    if (!p) return;
    current = p;
    currentQty = 1;
    buildModal();

    // media
    var all = [];
    if (p.image) all.push(p.image);
    (p.gallery || []).forEach(function (g) { if (g && g !== p.image) all.push(g); });
    mediaEl.innerHTML = all[0]
      ? '<img src="' + all[0] + '" alt="' + escapeHtml(p.name) + '">'
      : '<div class="photo-pending photo-pending--lg"><span class="photo-pending__mark"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15.5l-4.8-4.8L6.5 20.5"/></svg></span><p class="photo-pending__text">Photo coming soon — customize on WhatsApp.</p></div>';
    thumbsEl.innerHTML = all
      .slice(0, 6)
      .map(function (src, i) {
        return '<button type="button" class="qv-thumb' + (i === 0 ? ' is-active' : '') + '" data-src="' + escapeHtml(src) + '"><img src="' + src + '" alt=""></button>';
      })
      .join('');
    thumbsEl.hidden = all.length <= 1;

    // meta
    var cl = categoryLabel(p.category);
    var sl = subcategoryLabel(p.category, p.subcategory);
    catEl.textContent = sl ? (cl + ' · ' + sl) : (cl || '');
    nameEl.textContent = p.name || '';
    priceEl.textContent = parseFloat(p.price) > 0 ? money(p.price) : '';
    var s = String((p.status || '')).toLowerCase();
    /* A product can reach the admin panel with a "sold out" status (older
       rows, or a status written straight into Supabase). A card already
       badges those as Sold Out, so the modal must not offer a working
       Add to Cart — that is the one place a shopper would actually commit
       to buying. */
    var isSoldOut = (s === 'sold out' || s === 'sold-out') ||
      (p.stock != null && parseInt(p.stock, 10) === 0);
    if (isSoldOut) {
      statusEl.textContent = 'Sold out — message us and we can make one for you';
      statusEl.hidden = false;
    } else {
      statusEl.textContent = (s === 'made to order' || s === 'made-to-order') ? 'Made to order · ~5 days' : '';
      statusEl.hidden = !statusEl.textContent;
    }
    addBtn.disabled = isSoldOut;
    addBtn.textContent = isSoldOut ? 'Sold Out' : 'Add to Cart';
    addBtn.classList.toggle('btn--disabled', isSoldOut);

    // colors
    colorsEl.innerHTML = '<span class="qv-colors-label">Colors</span>';
    (p.colors || []).forEach(function (c, i) {
      if (!c || !c.name) return;
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'color-swatch' + (i === 0 ? ' selected' : '');
      sw.dataset.color = c.name;
      sw.style.setProperty('--swatch', c.hex || '#ccc');
      sw.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      colorsEl.appendChild(sw);
    });
    colorsEl.hidden = colorsEl.childElementCount <= 1;

    // desc
    descEl.textContent = p.description || (p.keywords ? p.keywords.slice(0, 6).join(', ') : '');

    // wa
    /* Same resolution as script.js: admin can change the number in the
       panel, and this link must follow it. */
    var waNum = (GC && GC.shopWhatsApp ? GC.shopWhatsApp() : "") || '923075729901';
    var intl = waNum.replace(/^\+/, '');
    var lines = [];
    lines.push('Hi Gulnish Crochet, I\'d like to order:');
    lines.push('• ' + (p.name || ''));
    if (p.category) lines.push('Category: ' + (sl ? (cl + ' · ' + sl) : cl));
    if (parseFloat(p.price) > 0) lines.push('Price: ' + money(p.price));
    lines.push('');
    lines.push('Is it available?');
    waBtn.href = 'https://wa.me/' + intl + '?text=' + encodeURIComponent(lines.join('\n'));

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    current = null;
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-quick-view]');
    if (btn) {
      e.preventDefault();
      var id = btn.dataset.id;
      if (id) open(id);
      return;
    }
  });

  window.GulnishQuickView = { open: open, close: close };
})();
