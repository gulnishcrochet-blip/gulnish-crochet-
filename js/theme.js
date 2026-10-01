/* =========================================================
   Gulnish Crochet — theme shell
   Announcement bar, mega menu from the live taxonomy, sticky
   header state and the shared mobile/footer affordances.
   Everything is optional: each block bails out when its anchor
   element is missing, so admin.html and the checkout keep the
   markup they already have.
   ========================================================= */
(function () {
  "use strict";

  var GC = window.GC;

  var TOPBAR_KEY = "gulnish-topbar-dismissed";
  /* Set by buildTopbar, called again after the catalogue loads so the
     delivery line picks up the configured charge. */
  var repaintTopbar = null;
  /* Delivery is never free, so the announcement must not promise it is.
     buildTopbar fills the delivery slot from the admin setting once the
     catalogue has loaded; the placeholder keeps the bar from rendering
     empty in the meantime. */
  var ANNOUNCEMENTS = [
    { icon: "truck", html: "Delivery charge confirmed on WhatsApp", slot: "delivery" },
    { icon: "sparkles", html: "Every piece is <b>handmade to order</b> &mdash; send us your idea" },
    { icon: "whatsapp", html: "Order on WhatsApp: <a class='topbar__link' href='https://wa.me/923075729901'>+92 307 5729901</a>" }
  ];

  function announcementHTML(item) {
    if (item.slot === "delivery") {
      var label = (window.GC && GC.deliveryLabel) ? GC.deliveryLabel() : item.html;
      return escapeHTML(label);
    }
    return item.html;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- icon set ---------- */
  var ICONS = {
    truck:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    sparkles:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>',
    palette:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1-.24-.27-.39-.62-.39-1 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-5.52-4.48-10-10-10z"/></svg>',
    ruler:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 15.5l9-9 6.5 6.5-9 9L2 15.5z"/><path d="M6 11.5l2 2"/><path d="M9 8.5l2 2"/><path d="M12 5.5l2 2"/></svg>',
    chat:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6.5l-10 6-10-6"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  };

  /* ---------- Announcement bar ---------- */
  function buildTopbar() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    if (document.querySelector(".topbar")) return;

    var bar = document.createElement("div");
    bar.className = "topbar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Store announcements");

    var inner = document.createElement("div");
    inner.className = "container topbar__inner";

    var msg = document.createElement("div");
    msg.className = "topbar__msg";

    var close = document.createElement("button");
    close.type = "button";
    close.className = "topbar__close";
    close.setAttribute("aria-label", "Dismiss announcements");
    close.innerHTML = "&times;";

    inner.appendChild(msg);
    inner.appendChild(close);
    bar.appendChild(inner);

    var idx = 0;
    var timer = null;

    function paint() {
      var item = ANNOUNCEMENTS[idx % ANNOUNCEMENTS.length];
      msg.classList.add("topbar__fade");
      window.setTimeout(function () {
        msg.innerHTML = (ICONS[item.icon] || "") + "<span>" + announcementHTML(item) + "</span>";
        msg.classList.remove("is-out");
        msg.classList.remove("topbar__fade");
      }, 260);
    }

    close.addEventListener("click", function () {
      bar.hidden = true;
      document.body.classList.remove("has-topbar");
      try { localStorage.setItem(TOPBAR_KEY, "1"); } catch (e) { /* ignore */ }
      stop();
    });

    function start() {
      if (timer) return;
      timer = window.setInterval(function () {
        idx = (idx + 1) % ANNOUNCEMENTS.length;
        msg.classList.add("is-out");
        paint();
      }, 4200);
    }
    function stop() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }
    /* Lets the boot sequence repaint the delivery line once the admin
       settings have loaded, without restarting the rotation. */
    repaintTopbar = function () {
      if (dismissed || bar.hidden) return;
      var item = ANNOUNCEMENTS[idx % ANNOUNCEMENTS.length];
      msg.innerHTML = (ICONS[item.icon] || "") + "<span>" + announcementHTML(item) + "</span>";
    };

    header.parentNode.insertBefore(bar, header);
    document.body.classList.add("has-topbar");

    var dismissed = false;
    try { dismissed = localStorage.getItem(TOPBAR_KEY) === "1"; } catch (e) { /* ignore */ }
    if (dismissed) {
      bar.hidden = true;
      document.body.classList.remove("has-topbar");
    } else {
      paint();
      start();
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else if (!dismissed && bar.hidden === false) start();
    });
  }

  /* ---------- Mega menu from the live taxonomy ---------- */
  function buildMegaMenu() {
    var list = document.querySelector("#mainNav > ul");
    if (!list || !GC) return;

    /* The nav ships a plain "Products" link; promote it into a dropdown only
       once the catalogue has actually loaded, so the fallback link keeps
       working if Supabase never answers. */
    var shopLink = Array.prototype.find.call(
      list.querySelectorAll(":scope > li > a"),
      function (a) {
        return /\/(products|shop)\b/.test(a.getAttribute("href") || "");
      }
    );
    if (!shopLink) return;

    var li = shopLink.parentElement;
    if (li.classList.contains("nav-item")) return;

    li.classList.add("nav-item");
    li.setAttribute("data-has-mega", "");

    var caret = document.createElement("svg");
    caret.className = "nav-caret";
    caret.setAttribute("viewBox", "0 0 24 24");
    caret.setAttribute("fill", "none");
    caret.setAttribute("stroke", "currentColor");
    caret.setAttribute("stroke-width", "2.4");
    caret.setAttribute("aria-hidden", "true");
    caret.innerHTML = '<polyline points="6 9 12 15 18 9"/>';
    shopLink.appendChild(caret);

    var panel = document.createElement("div");
    panel.className = "nav-mega";
    panel.setAttribute("aria-label", "Product categories");
    li.appendChild(panel);

    renderMega(panel);

    /* Both input modes are wired up rather than picked between with
       matchMedia("(hover: none)").
       - Hover/focus listeners are inert on a real touch device, where no
         mouseenter ever fires.
       - The click handler only intercepts the *first* tap while the panel
         is closed, which is exactly the tap-to-expand affordance touch
         needs. Once open, the link navigates as normal.
       Gating on the media query was wrong: hybrid devices (touchscreen
       laptops) and some embedded webviews report `hover: none` while still
       having a real mouse, and the menu then became unreachable by hover. */

    li.addEventListener("mouseenter", function () { li.classList.add("is-open"); });
    li.addEventListener("mouseleave", function () { li.classList.remove("is-open"); });
    li.addEventListener("focusin", function () { li.classList.add("is-open"); });
    li.addEventListener("focusout", function (e) {
      if (!li.contains(e.relatedTarget)) li.classList.remove("is-open");
    });

    shopLink.addEventListener("click", function (e) {
      if (!panel.childElementCount) return;
      if (!li.classList.contains("is-open")) {
        e.preventDefault();
        li.classList.add("is-open");
        panel.scrollIntoView({ block: "nearest" });
      }
    });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) li.classList.remove("is-open");
    });
  }

  function renderMega(panel) {
    var settings = (GC && GC.settings) || {};
    var cats = Array.isArray(settings.categories) ? settings.categories : [];
    var products = (GC && GC.products) || [];
    if (!cats.length || !products.length) return;

    var groups = [];
    cats.forEach(function (label, i) {
      var key = "gr" + (i + 1);
      var count = products.filter(function (p) { return p.category === key; }).length;
      if (!count) return;

      var subs = GC.subcategoriesOf ? GC.subcategoriesOf(key) : [];
      /* Only offer a subcategory that something is actually filed under,
         otherwise the menu advertises an empty result page. */
      var liveSubs = subs.filter(function (name, si) {
        return products.some(function (p) {
          return p.category === key && p.subcategory === "sg" + (si + 1);
        });
      });

      groups.push({ key: key, label: label || "Category " + (i + 1), count: count, subs: liveSubs });
    });

    if (!groups.length) return;

    panel.innerHTML =
      groups
        .map(function (g) {
          var subs = g.subs.length
            ? '<div class="nav-mega__subs">' +
              g.subs
                .map(function (name, si) {
                  /* Subcategory labels are positional inside the parent, so
                     the index here is the original one, not the filtered one. */
                  var idx = (GC.subcategoriesOf(g.key) || []).indexOf(name) + 1;
                  return (
                    '<a href="/products?cat=' + encodeURIComponent(g.key) + "&sub=sg" + idx + '">' +
                    escapeHtml(name) +
                    "</a>"
                  );
                })
                .join("") +
              "</div>"
            : "";
          return (
            '<div class="nav-mega__group">' +
            '<a class="nav-mega__label" href="/products?cat=' + encodeURIComponent(g.key) + '">' +
            "<span>" + escapeHtml(g.label) + "</span>" +
            "<small>" + g.count + "</small>" +
            "</a>" +
            subs +
            "</div>"
          );
        })
        .join("") +
      '<a class="nav-mega__all" href="/products">Browse all products <span>' +
      escapeHTML((window.GC && GC.deliveryShort) ? GC.deliveryShort() : "Delivery charge applies") +
      " &rarr;</span></a>";
  }

  function refreshMenus() {
    document.querySelectorAll(".nav-mega").forEach(function (p) {
      if (!p.childElementCount) renderMega(p);
    });
    var list = document.getElementById("footerShopLinks");
    if (list) renderFooterShop(list);
  }

  function renderFooterShop(list) {
    var settings = (GC && GC.settings) || {};
    var cats = Array.isArray(settings.categories) ? settings.categories : [];
    var products = (GC && GC.products) || [];
    if (!cats.length || !products.length) return;

    var links = cats
      .map(function (label, i) {
        var key = "gr" + (i + 1);
        if (!products.some(function (p) { return p.category === key; })) return "";
        return (
          '<a href="/products?cat=' + encodeURIComponent(key) + '">' +
          escapeHtml(label || "Category " + (i + 1)) +
          "</a>"
        );
      })
      .filter(Boolean);

    list.innerHTML = links.join("");
  }

  /* ---------- Header: sticky state + scroll progress ---------- */
  /* ---------- Header + sticky-affordance upkeep ---------- */
  /* The scroll listener itself lives in js/script.js (it already drives the
     progress bar and back-to-top). Here we only patch over the gaps on pages
     where that file's UI bundle did not attach, so the header never ends up
     without its scrolled state. */
  function buildHeaderBehaviour() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    if (header.dataset.themeScrollBound === "1") return;
    header.dataset.themeScrollBound = "1";

    var progress = document.getElementById("scrollProgress");
    if (progress && !progress.dataset.themeBound) {
      progress.dataset.themeBound = "1";
      /* script.js animates this with scaleX; match that so the two never
         fight over the same property. */
      progress.style.transformOrigin = "left center";
      progress.style.width = "100%";
    }

    /* Card wishlist hearts need their saved state applied whenever the grid
       is re-rendered (filters, search, pagination all rewrite innerHTML). */
    if (window.GulnishWishlist) {
      var syncHearts = function () {
        document.querySelectorAll("[data-wishlist-toggle]").forEach(function (b) {
        var on = window.GulnishWishlist.has(b.dataset.id);
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.setAttribute("aria-label", on ? "Remove from wishlist" : "Save to wishlist");
      });
      };
      syncHearts();
      var grids = document.getElementById("productGrid");
      var featured = document.getElementById("featuredGrid");
      [grids, featured].forEach(function (g) {
        if (!g || typeof MutationObserver === "undefined") return;
        new MutationObserver(syncHearts).observe(g, { childList: true, subtree: true });
      });
      document.addEventListener("gc:wishlist-change", syncHearts);
    }
  }

  /* ---------- Footer: current year + contact block ---------- */
  function buildFooter() {
    var year = document.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());

    var contact = document.getElementById("footerContact");
    if (contact && !contact.childElementCount) {
      contact.innerHTML =
        '<a class="footer-contact__row" href="https://wa.me/923075729901" target="_blank" rel="noopener">' +
        ICONS.whatsapp + "<span>WhatsApp +92 307 5729901</span></a>" +
        '<a class="footer-contact__row" href="tel:+923075729901">' +
        ICONS.phone + "<span>+92 307 5729901</span></a>" +
        '<a class="footer-contact__row" href="mailto:gulnishcrochet@gmail.com">' +
        ICONS.mail + "<span>gulnishcrochet@gmail.com</span></a>" +
        '<span class="footer-contact__row">' +
        ICONS.pin + "<span>Handmade in Pakistan — all Pakistan delivery</span></span>";
    }
  }

  /* ---------- Mobile menu: turn the mega panel into an accordion ---------- */
  function buildMobileNav() {
    var list = document.querySelector("#mainNav > ul");
    if (!list) return;
    list.addEventListener("click", function (e) {
      var caretBtn = e.target.closest(".nav-caret");
      if (caretBtn) {
        var li = caretBtn.closest(".nav-item");
        if (!li) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.toggle("is-open");
      }
    });
  }

  /* ---------- Trust chips injected on cart + checkout ---------- */
  function buildTrustRows() {
    var rows = [
      { icon: "shield", title: "Cash on delivery", text: "Pay when your parcel arrives" },
      { icon: "truck", title: "2-5 day delivery", text: "Tracked across Pakistan" },
      { icon: "refresh", title: "Easy exchanges", text: "7-day return on unused pieces" }
    ];
    document.querySelectorAll("[data-trust-row]").forEach(function (host) {
      if (host.childElementCount) return;
      host.classList.add("trust-row");
      host.innerHTML = rows
        .map(function (r) {
          return (
            '<div class="trust-chip">' + ICONS[r.icon] +
            "<div><strong>" + r.title + "</strong>" + r.text + "</div></div>"
          );
        })
        .join("");
    });
  }

  /* ---------- delivery wording on the home value strip ---------- */
  /* The static HTML is a safe fallback; once the admin settings load the
     title/text are replaced with whatever the owner configured. */
  function paintDeliveryCopy() {
    if (!(window.GC && GC.deliveryLabel)) return;
    var title = document.querySelector("[data-delivery-title]");
    var text = document.querySelector("[data-delivery-text]");
    if (title) {
      var fee = GC.deliveryFee();
      title.textContent = fee
        ? "Flat delivery Rs. " + fee
        : "Delivery charge applies";
    }
    if (text) {
      var note = String((GC.settings && GC.settings.deliveryNote) || "").trim();
      text.textContent = note
        ? note
        : "Tracked shipping across Pakistan, quoted on WhatsApp";
    }
    /* Cart and checkout both describe the payment terms. Nothing is
       collected from the card here, but the order is paid for in advance,
       so the copy must not imply payment happens on delivery. */
    var fee = GC.deliveryFee();
    var short = fee ? "Rs. " + fee : "";
    document.querySelectorAll("#cartDeliveryNote, #checkoutDeliveryNote, #checkoutDeliveryNote2")
      .forEach(function (el) {
        el.textContent = fee
          ? "Pay in advance \u2014 we confirm your payment and the " + short +
            " delivery charge on WhatsApp before we start stitching."
          : "Pay in advance \u2014 we confirm your payment and the delivery " +
            "charge on WhatsApp before we start stitching.";
      });
  }

  /* ---------- boot ---------- */
  function start() {
    buildTopbar();
    buildMegaMenu();
    buildHeaderBehaviour();
    buildFooter();
    buildMobileNav();
    buildTrustRows();
    paintDeliveryCopy();
    refreshMenus();
  }

  if (GC && GC.init) {
    /* The menu and footer lists are derived from settings + products, so they
       have to wait for the catalogue. Everything else renders immediately so
       the header never depends on a network round trip. */
    GC.init().then(function () {
      buildMegaMenu();
      /* Delivery wording comes from the admin settings, so the topbar and
         the home value strip are repainted now that they are known. */
      if (repaintTopbar) repaintTopbar();
      paintDeliveryCopy();
      refreshMenus();
    });
    start();
  } else {
    start();
  }

  window.addEventListener("load", function () {
    buildMegaMenu();
    refreshMenus();
  });

  window.GulnishTheme = { refreshMenus: refreshMenus };
})();