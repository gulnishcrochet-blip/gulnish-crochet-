/* =========================================================
   Gulnish Crochet — interactions
   ========================================================= */

(function () {
  "use strict";

  var GC = window.GC;

  /* Bottom bars the floating pill must sit above on phones.
     Declared up top: renderCart() runs early in this IIFE and triggers a
     re-measure. */
  var FB_BARS = [".co-bar", ".cart-bar", ".bottom-nav"];

  /* ---------- Weak-network / mobile image tier ---------- */
  var LOW_RES =
    (navigator.connection && typeof navigator.connection.effectiveType === "string" &&
      (navigator.connection.effectiveType === "slow-2g" ||
        navigator.connection.effectiveType === "2g" ||
        navigator.connection.effectiveType === "3g")) ||
    window.matchMedia("(max-width: 760px)").matches;
  function displayImage(src) {
    if (!src || !LOW_RES) return src;
    if (src.lastIndexOf("data:", 0) === 0) return src;
    var parts = src.split("/");
    if (parts.length >= 2 && parts[parts.length - 2] !== "sm") {
      parts.splice(parts.length - 1, 0, "sm");
    }
    return parts.join("/");
  }

/* Real intrinsic widths for every catalogue photo that is not the usual
     800w full / 480w sm twin. Measured off the files themselves - the
     catalogue is genuinely mixed (600w bags, 597w purses, 1024w bouquets), so
     one hardcoded pair lied to the browser on 20 of 132 files. Understating a
     1024w file as 800w made Chrome pick the 480w twin on large screens and the
     bouquet photos went soft; overstating the 597w purses made it fetch them
     when it did not need to.
     Regenerate after adding photos with:
       python3 scripts/img-widths.py > /tmp/w.json  (then paste the object)
     Anything not listed falls back to 800/480, which is correct for the
     standard files. */
  var IMAGE_WIDTHS = {
    "images/bags/bag-1.webp": 600, "images/bags/bag-2.webp": 600,
    "images/bags/bag-3.webp": 1024, "images/bags/bag-4.webp": 1024,
    "images/bouquets/bouquet-1.webp": 1024, "images/bouquets/bouquet-2.webp": 1024,
    "images/bouquets/bouquet-3.webp": 1024, "images/bouquets/bouquet-4.webp": 1024,
    "images/bouquets/bouquet-5.webp": 1024, "images/bouquets/bouquet-6.webp": 1024,
    "images/bouquets/bouquet-7.webp": 1024,
    "images/jewellery/jewellery-1.webp": 600,
    "images/keychains/keychain-1.webp": 600, "images/keychains/keychain-2.webp": 600,
    "images/purses/purse-1.webp": 597, "images/purses/purse-2.webp": 597,
    "images/purses/purse-3.webp": 597, "images/purses/purse-4.webp": 800,
    "images/purses/sm/purse-1.webp": 358, "images/purses/sm/purse-2.webp": 358,
    "images/purses/sm/purse-3.webp": 358, "images/purses/sm/purse-4.webp": 480
  };

  function imageWidth(src) {
    return IMAGE_WIDTHS[src] || (src.indexOf("/sm/") !== -1 ? 480 : 800);
  }

  /* Builds a srcset so the browser itself can choose the 480px tier.
     displayImage() above only helps browsers that expose
     navigator.connection (Chrome/Android); Safari and Firefox never get the
     small files, so a phone on wifi still downloads every 800px original.
     Local images/ paths only - Supabase URLs have no sm/ twin.
     deferred=true emits data-srcset/data-sizes for the parked images above. */
  function imgSrcset(src, sizes, deferred) {
    if (!src || src.lastIndexOf("data:", 0) === 0) return "";
    if (src.indexOf("images/") !== 0) return "";
    var parts = src.split("/");
    if (parts.length < 3 || parts[parts.length - 2] === "sm") return "";
    /* Only the catalogue directories ship an sm/ twin. Without this guard a
       stray images/og-cover-v2.webp would get a srcset pointing at the
       non-existent images/sm/og-cover-v2.webp, which is a 404 on every card. */
    var photoDirs = "bags bouquets gajrays geometry headbands jewellery keychains pencil pencilbox purses";
    if ((" " + photoDirs + " ").indexOf(" " + parts[parts.length - 2] + " ") < 0) return "";
    var small = parts.slice(0, parts.length - 1);
    small.push("sm", parts[parts.length - 1]);
    small = small.join("/");
    var ss = small + " " + imageWidth(small) + "w, " + src + " " + imageWidth(src) + "w";
    var sz = sizes || "(max-width: 760px) 44vw, 250px";
    return deferred
      ? ' data-srcset="' + ss + '" data-sizes="' + sz + '"'
      : ' srcset="' + ss + '" sizes="' + sz + '"';
  }

  /* Shown anywhere a product has no photo yet, so the grid reads as
     intentional instead of leaving an empty grey box. */
  function photoPendingHTML(modifier) {
    return (
      '<div class="photo-pending ' + (modifier || "") + '">' +
      '<span class="photo-pending__mark" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="16" rx="3"/>' +
      '<circle cx="8.5" cy="9.5" r="1.5"/>' +
      '<path d="M21 15.5l-4.8-4.8L6.5 20.5"/>' +
      "</svg></span>" +
      '<p class="photo-pending__text">The picture will be uploaded soon. ' +
      "However, you can customize your design directly on WhatsApp.</p>" +
      "</div>"
    );
  }

  /* ---------- Mobile nav toggle ---------- */
  var navToggle = document.getElementById("navToggle");
  var mainNav = document.getElementById("mainNav");
  var navOverlay = document.createElement("div");
  navOverlay.className = "nav-overlay";
  navOverlay.setAttribute("aria-hidden", "true");
  var navHeader = document.querySelector(".site-header");
  if (navHeader) navHeader.appendChild(navOverlay);

  /* The close control is styled in CSS but shipped in no markup, so on phones
     the drawer could only be dismissed by tapping the scrim or the toggle
     itself. Inject it once here so every page gets it. */
  if (mainNav && !mainNav.querySelector(".nav-close")) {
    var navClose = document.createElement("button");
    navClose.type = "button";
    navClose.className = "nav-close";
    navClose.setAttribute("aria-label", "Close menu");
    navClose.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    mainNav.insertBefore(navClose, mainNav.firstChild);
  }

  var navScrollbarPad = 0;

  function lockScroll() {
    /* Hiding the body scrollbar lets the page underneath widen by its width,
       which reads as a visible jump the moment the drawer slides in. Pad the
       body by the same amount first so nothing shifts. */
    var gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) {
      navScrollbarPad = gap;
      document.body.style.paddingRight = gap + "px";
    }
    document.body.style.overflow = "hidden";
  }

  function unlockScroll() {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    navScrollbarPad = 0;
  }

  function closeMobileNav() {
    if (!mainNav) return;
    var wasOpen = mainNav.classList.contains("open");
    if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    mainNav.classList.remove("open");
    navOverlay.classList.remove("open");
    unlockScroll();
    /* Return focus to the button that opened the drawer, otherwise the next
       Tab press lands back inside the now-collapsed menu. Guarded on wasOpen
       because Escape also runs this when the drawer was never opened, and it
       must not yank focus away from whatever the user was actually using. */
    if (wasOpen && navToggle) navToggle.focus();
  }

  function openMobileNav() {
    mainNav.classList.add("open");
    navOverlay.classList.add("open");
    if (navToggle) navToggle.setAttribute("aria-expanded", "true");
    lockScroll();
    /* The drawer is visibility:hidden until .open lands, and visibility is
       inherited, so focusing a link in this same task is dropped and the
       keyboard stays outside the drawer. Force the style flush first. */
    var firstLink = mainNav.querySelector("a");
    if (firstLink) {
      void firstLink.offsetWidth;
      firstLink.focus();
    }
  }

  if (navToggle && mainNav) {
    var navCloseBtn = mainNav.querySelector(".nav-close");

    navToggle.addEventListener("click", function () {
      if (mainNav.classList.contains("open")) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
    if (navCloseBtn) navCloseBtn.addEventListener("click", closeMobileNav);
    navOverlay.addEventListener("click", closeMobileNav);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMobileNav();
      /* Keep Tab inside the drawer while it is open. The scrim and the rest of
         the page are still in the tab order, so without this the focus ring
         walks off into invisible controls behind the overlay. */
      if (e.key === "Tab" && mainNav.classList.contains("open")) {
        var focusables = mainNav.querySelectorAll(
          'a[href], button:not([disabled])'
        );
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    mainNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMobileNav);
    });

    /* Rotating the phone or returning to a resized window can leave the drawer
       open against a layout that no longer hides it. Reset in that case. */
    window.addEventListener("resize", function () {
      if (window.innerWidth > 760 && mainNav.classList.contains("open")) {
        closeMobileNav();
      }
    });
  }

/* ---------- Bottom nav: add Call action (mobile app style) ---------- */
  var bottomNav = document.querySelector(".bottom-nav");
  if (bottomNav) {
    var callItem = document.createElement("a");
    callItem.className = "bottom-nav__item bottom-nav__call";
    callItem.href = "tel:+923075729901";
    callItem.setAttribute("aria-label", "Call us to order");
    callItem.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
      '<span>Call</span>';
    bottomNav.insertBefore(callItem, bottomNav.querySelector('[data-nav="contact"]'));
  }

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Header shadow + scroll progress ---------- */
  var header = document.querySelector(".site-header");
  var progressBar = document.getElementById("scrollProgress");
  var backToTop = document.getElementById("backToTop");
  var fbGroup = document.querySelector(".fb-group");
  var pageHero = document.querySelector(".hero");
  var headerInner = document.querySelector(".header-inner");
  if (headerInner && !document.body.classList.contains("admin-page")) {
    var searchWrap = document.createElement("form");
    searchWrap.className = "mobile-search";
    searchWrap.setAttribute("role", "search");
    searchWrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>' +
      '<input type="search" aria-label="Search products" placeholder="Search purses, jewellery, gajrays..." autocomplete="off">' +
      '<button type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"></path></svg></button>';
    searchWrap.addEventListener("submit", function (e) {
      e.preventDefault();
      var term = searchWrap.querySelector("input").value.trim();
      window.location.href = "/products?q=" + encodeURIComponent(term);
    });
    headerInner.insertAdjacentElement("afterend", searchWrap);
  }
  var scrollTicking = false;
  var lastScrollY = window.scrollY || 0;
  var onScroll = function () {
    if (!scrollTicking) {
      requestAnimationFrame(function () {
        var y = window.scrollY || 0;
        if (header) header.classList.toggle("scrolled", y > 30);
        /* Tuck the header away on scroll-down once past the hero, and bring
           it straight back on any scroll-up. Without this the search and
           wishlist buttons scroll out of reach on long product grids. */
        if (header) {
          if (y > 420 && y > lastScrollY + 4) header.classList.add("is-tucked");
          else if (y < lastScrollY - 4 || y <= 420) header.classList.remove("is-tucked");
        }
        lastScrollY = y;
        if (progressBar) {
          var h = document.documentElement.scrollHeight - window.innerHeight;
          progressBar.style.transform = "scaleX(" + (h > 0 ? y / h : 0) + ")";
        }
        if (backToTop) backToTop.classList.toggle("show", y > 560);
        if (fbGroup) {
          fbGroup.classList.toggle("fb-away", pageHero && pageHero.getBoundingClientRect().bottom > 0);
        }
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Custom smooth scroll (rAF + easing) ---------- */
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function smoothScrollTo(targetY, duration) {
    var startY = window.scrollY;
    var diff = targetY - startY;
    var startTime = null;
    if (Math.abs(diff) < 2) return;

    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      window.scrollTo(0, startY + diff * easeInOutCubic(progress));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if (backToTop) {
    backToTop.addEventListener("click", function () {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        window.scrollTo(0, 0);
      } else {
        smoothScrollTo(0, 500);
      }
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "100px 0px 10% 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("revealed"); });
  }
  /* tells the <head> safety net that reveal is wired up, so it does not
     force-reveal everything and cancel the scroll animation */
  window.__gcRevealReady = true;

  /* ---------- Toast helper ---------- */
  function showToast(message) {
    var toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("show"); }, 2400);
  }

  function flyToCart(btnEl) {
    try {
      var card = btnEl.closest('.work-card');
      var img = card ? card.querySelector('.work-card__media img') : null;
      /* The header cart button is hidden on phones, where the bottom nav
         carries the cart instead. Measuring a display:none element returns an
         all-zero rect, which sent the ghost image flying to the top-left
         corner, so pick whichever control is actually on screen. */
      var cartIcon = document.getElementById('cartToggle');
      var iconRect = cartIcon ? cartIcon.getBoundingClientRect() : null;
      if (!iconRect || (!iconRect.width && !iconRect.height)) {
        cartIcon = document.getElementById('bottomNavCart');
        iconRect = cartIcon ? cartIcon.getBoundingClientRect() : null;
      }
      if (!img || !cartIcon || !iconRect || (!iconRect.width && !iconRect.height)) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var r = img.getBoundingClientRect();
      var c = iconRect;
      var clone = img.cloneNode(true);
      Object.assign(clone.style, {
        position: 'fixed',
        left: r.left + 'px',
        top: r.top + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
        transition: 'all 0.65s cubic-bezier(.5,-.3,.5,1)',
        zIndex: '9999',
        pointerEvents: 'none',
        opacity: '0.9',
        borderRadius: '50%',
        objectFit: 'cover'
      });
      document.body.appendChild(clone);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          Object.assign(clone.style, {
            left: (c.left + c.width / 2 - 20) + 'px',
            top: (c.top + c.height / 2 - 20) + 'px',
            width: '40px',
            height: '40px',
            opacity: '0.3'
          });
        });
      });
      setTimeout(function () { clone.remove(); }, 700);
    } catch (err) { /* silent */ }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getProducts() {
    return GC.products || [];
  }

  function getSettings() {
    return GC.settings || {};
  }

  /* Subcategory keys are the positional "sgN" inside the product's own
     category, so both halves are needed to read one. */
  function subcategoriesOf(catKey) {
    if (!GC || !GC.subcategoriesOf) return [];
    return GC.subcategoriesOf(catKey) || [];
  }

  function subcategoryLabelOf(catKey, subKey) {
    if (!GC || !GC.subcategoryLabelOf) return "";
    return GC.subcategoryLabelOf(catKey, subKey) || "";
  }

  function money(value) {
    var n = parseFloat(value) || 0;
    var str = String(Math.round(n * 100) / 100);
    var parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "Rs. " + parts.join(".");
  }

  /* The published price of a handmade piece is a range, not a point: size and
     detail work decide where in the range a given order lands. So the base
     price stays the number the cart adds up to and the range is published
     alongside it, with the real figure confirmed on WhatsApp. */
  function hasRange(p) {
    return !!(p && parseFloat(p.price) > 0 && parseFloat(p.priceMax) > parseFloat(p.price));
  }

  /* A product with no photo is one the customer commissions through WhatsApp,
     so its price is not published - it shows as "..." instead. Cart and
     checkout still use the real p.price (carried in data-price) so the order
     total still adds up. */
  function displayPrice(p) {
    if (!p) return "";
    /* No price at all is a real state for products still being priced up, and
       quoting "Rs. ..." for them would promise something. A photo-pending
       product that does have a price keeps the "agreed on WhatsApp" hint. */
    if (!(parseFloat(p.price) > 0)) return "";
    if (!p.image) return "Rs. ...";
    return hasRange(p) ? money(p.price) + " \u2013 " + money(p.priceMax) : money(p.price);
  }

  function stockStatus(p) {
    var s = String((p && p.status) || "").trim().toLowerCase();
    if (s === "made to order" || s === "made-to-order") return "made to order";
    if (s === "sold out" || s === "sold-out") return "sold out";
    /* A tracked stock of 0 means sold out even when the status text still
       says "in stock" — the count is the more specific signal. */
    if (p && p.stock != null && parseInt(p.stock, 10) === 0) return "sold out";
    return "in stock";
  }

  function stockBadgeHTML(p) {
    var s = stockStatus(p);
    if (s === "made to order") return '<div class="work-card__badge work-card__badge--made">Made to order &middot; ~5 days</div>';
    return "";
  }

  /* ---------- Build shop UI ---------- */
  /* Exposed so quick view can reuse the exact same cart path (badge bump,
     toast, fly animation) instead of re-implementing the write. */
  window.addToCart = addToCart;
  window.showToast = showToast;
  window.showProduct = showProduct;

  var productGrid = document.getElementById("productGrid");
  var filterWrap = document.getElementById("filters");
  var subFilterWrap = document.getElementById("subFilters");
  var activeSubFilter = "all";
  var noProducts = document.getElementById("noProducts");
  var searchInput = document.getElementById("searchInput");
  var noResults = document.getElementById("noResults");
  var sortSelect = document.getElementById("sortSelect");
  var productCountLabel = document.getElementById("productCountLabel");
  var featuredGrid = document.getElementById("featuredGrid");

  /* Catalog images are parked in data-src and only promoted to a real src
     once their card is on screen. Writing src into innerHTML starts the fetch
     straight away: the browser committed the request before applyFilters() had
     a chance to hide the 106 cards past the first page, and a display:none
     arriving afterwards cannot cancel an in-flight request. That pulled the
     whole 114-piece catalogue - about 1.4MB - to show eight products. */
  function hydrateCardImages(card) {
    if (!card) return;
    /* Main image only. .work-card__alt is deliberately excluded: it is the
       hover state and must stay parked until hydrateHoverImage() releases it,
       otherwise every visible card downloads a second photo nobody sees. */
    var imgs = card.querySelectorAll("img.work-card__main[data-src]");
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.dataset.srcset) im.srcset = im.dataset.srcset;
      if (im.dataset.sizes) im.sizes = im.dataset.sizes;
      im.src = im.dataset.src;
      im.removeAttribute("data-src");
      im.removeAttribute("data-srcset");
      im.removeAttribute("data-sizes");
    }
  }

  /* The second gallery photo only ever shows on hover, which a touch screen
     cannot do. It stays parked until a real pointer arrives, so phones never
     download a second image per card. */
  function hydrateHoverImage(card) {
    if (!card || !window.matchMedia("(hover: hover)").matches) return;
    var alt = card.querySelector("img.work-card__alt[data-src]");
    if (!alt) return;
    if (alt.dataset.srcset) alt.srcset = alt.dataset.srcset;
    if (alt.dataset.sizes) alt.sizes = alt.dataset.sizes;
    alt.src = alt.dataset.src;
    alt.removeAttribute("data-src");
    alt.removeAttribute("data-srcset");
    alt.removeAttribute("data-sizes");
  }

  function cardHTML(p, index) {
    var imgSrc = displayImage(p.image);
    var isFirst = typeof index === "number" && index === 0;
    var image = imgSrc
      ? '<img class="work-card__main" data-src="' + imgSrc + '"' + imgSrcset(p.image, null, true) +
        ' alt="' + escapeHtml(p.name) + '"' +
        (isFirst ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"') + ">"
      : "";
    /* Second gallery photo as the hover state. Parked like the main image and
       released by hydrateHoverImage() only where hovering is possible. */
    var altImage =
      p.image && p.gallery && p.gallery.length
        ? '<img class="work-card__alt" data-src="' + displayImage(p.gallery[0]) +
          '"' + imgSrcset(p.gallery[0], null, true) +
          ' alt="" aria-hidden="true" loading="lazy" decoding="async">'
        : "";
    var colors =
      p.colors && p.colors.length
        ? '<div class="work-card__colors" data-colors="' +
          p.colors
            .map(function (c) { return c.name + "|" + c.hex; })
            .join(",") +
          '"></div>'
        : "";
      var price =
        parseFloat(p.price) > 0
          ? '<div class="work-card__price">' + displayPrice(p) + "</div>"
          : "";
    /* Use stockStatus(), not a raw status read: a product with a tracked
       stock of 0 is sold out even when its status text still says
       "in stock", and the overlay has to agree with the button below. */
    var soldOut =
      stockStatus(p) === "sold out"
        ? '<div class="work-card__soldout"><span>Sold Out</span></div>'
        : "";
    /* Every card links to the product's own page at /product/<slug>. That
       address is generated ahead of time by scripts/generate-product-pages.js
       and is the only thing a search engine can follow, so it has to be real
       markup rather than a click handler. The condition matches the
       generator's exactly - a photo and a price - because a card pointing at an
       address that was never generated would just be a dead link. */
    var slug =
      p.image && parseFloat(p.price) > 0 && GC && GC.canonicalProductSlug ? GC.canonicalProductSlug(p) : "";
    var linkAttrs = slug ? ' href="/product/' + escapeHtml(slug) + '"' : "";
    var media =
      '<div class="work-card__media js-product-view" data-view="' + p.id + '">' +
      '<a class="work-card__link js-product-link" data-view="' + p.id + '"' + linkAttrs +
      ' aria-label="' + escapeHtml(p.name) + '">' +
      (p.image ? image + altImage : photoPendingHTML()) +
      "</a>" +
      soldOut +
      "</div>";
    /* The card tool sits outside .work-card__media on purpose: the media
       is the click target for opening the product, so a button inside it
       would have to stopPropagation to stay clickable. */
    var tools =
      '<div class="work-card__tools">' +
      '<button type="button" class="card-tool card-tool--qv" data-quick-view data-id="' +
        escapeHtml(p.id) + '" aria-label="Quick view of ' + escapeHtml(p.name) + '">Quick view</button>' +
      "</div>";
    return (
      '<article class="work-card" data-category="' + p.category + '"' +
      (p.subcategory ? ' data-subcategory="' + p.subcategory + '"' : "") + ">" +
      media +
      tools +
      '<div class="work-card__body">' +
      '<h3 class="work-card__name">' +
      (slug
        ? '<a class="js-product-link" data-view="' + p.id + '"' + linkAttrs + ">" + escapeHtml(p.name) + "</a>"
        : escapeHtml(p.name)) +
      "</h3>" +
      price +
      stockBadgeHTML(p) +
      colors +
      buildCardAddBtn(p) +
      "</div></article>"
    );
  }

  function buildCardAddBtn(p) {
    var common = ' type="button" data-id="' + p.id + '" data-name="' + escapeHtml(p.name) + '" data-price="' + (p.price || 0) + '"';
    /* Keep the button in the DOM (applyFilters and the fly-to-cart animation
       both query for it) but make it inert, so a product badged Sold Out
       cannot be added from the grid either. */
    if (stockStatus(p) === "sold out") {
      return (
        '<button class="add-btn add-btn--sold is-disabled" disabled aria-disabled="true"' +
        common +
        ">Sold Out</button>"
      );
    }
    return '<button class="add-btn"' + common + '>' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="9" cy="21" r="1"></circle>' +
      '<circle cx="20" cy="21" r="1"></circle>' +
      '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>' +
      "</svg>" +
      "Add to Cart</button>";
  }

  function buildFilters(settings) {
    if (!filterWrap) return;
    filterWrap.innerHTML = "";
    var makeBtn = function (filter, label, active) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn" + (active ? " active" : "");
      btn.dataset.filter = filter;
      btn.textContent = label;
      return btn;
    };
    filterWrap.appendChild(makeBtn("all", "All", true));
    var products = getProducts();
    (settings.categories || []).forEach(function (label, i) {
      var key = "gr" + (i + 1);
      if (!products.some(function (p) { return p.category === key; })) return;
      filterWrap.appendChild(makeBtn(key, label || "Category " + (i + 1), false));
    });
  }

  /* Sub-filters only exist for categories that actually have subcategories, so
     the row is empty (and hidden) for the flat ones. The active parent decides
     what it offers, which keeps one row instead of a nested tree. */
  function buildSubFilters(catKey) {
    if (!subFilterWrap) return;
    subFilterWrap.innerHTML = "";
    var subs = subcategoriesOf(catKey);
    if (!subs.length || catKey === "all") {
      subFilterWrap.hidden = true;
      activeSubFilter = "all";
      return;
    }
    var products = getProducts().filter(function (p) { return p.category === catKey; });
    var makeBtn = function (filter, label, active) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn filter-btn--sub" + (active ? " active" : "");
      btn.dataset.subFilter = filter;
      btn.textContent = label;
      return btn;
    };
    subFilterWrap.appendChild(makeBtn("all", "All " + (categoryLabelOf(catKey) || "items"), true));
    subs.forEach(function (label, i) {
      var key = "sg" + (i + 1);
      if (!products.some(function (p) { return p.subcategory === key; })) return;
      subFilterWrap.appendChild(makeBtn(key, label, false));
    });
    /* Every subcategory was empty, so there is nothing to narrow down. */
    subFilterWrap.hidden = subFilterWrap.childElementCount < 2;
    if (subFilterWrap.hidden) activeSubFilter = "all";
  }

  function activeCategoryKey() {
    var btn = filterWrap && filterWrap.querySelector(".filter-btn.active");
    return (btn && btn.dataset.filter) || "all";
  }

  function activeSubcategoryKey() {
    var btn = subFilterWrap && subFilterWrap.querySelector(".filter-btn.active");
    return (btn && btn.dataset.subFilter) || "all";
  }

  function setSubFilterUI(key) {
    activeSubFilter = key || "all";
    if (!subFilterWrap) return;
    subFilterWrap.querySelectorAll(".filter-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.subFilter === activeSubFilter);
    });
  }

  var cards = [];
  var INITIAL_VISIBLE = 8;
  var SHOW_STEP = 8;
  var visibleCount = INITIAL_VISIBLE;
  var showMoreBtn = document.getElementById("showMore");

  function isFiltering() {
    var term = searchInput ? searchInput.value.trim() : "";
    var activeBtn = filterWrap && filterWrap.querySelector(".filter-btn.active");
    return (
      term !== "" ||
      (activeBtn && activeBtn.dataset.filter !== "all") ||
      activeSubcategoryKey() !== "all"
    );
  }

  function updateShowMoreBtn() {
    if (!showMoreBtn) return;
    var remaining = cards.length - visibleCount;
    showMoreBtn.hidden = isFiltering() || remaining <= 0;
    showMoreBtn.textContent = "Show more (" + remaining + ")";
  }

  function applyFilters() {
    var term =
      (searchInput ? searchInput.value.trim().toLowerCase() : "") || "";
    var target = activeCategoryKey();
    var subTarget = activeSubcategoryKey();
    var filtering = isFiltering();

    var visible = 0;
    var shown = [];
    cards.forEach(function (card, index) {
      var inRange = filtering || index < visibleCount;
      var categoryMatch = target === "all" || card.dataset.category === target;
      var subMatch =
        target === "all" ||
        subTarget === "all" ||
        card.dataset.subcategory === subTarget;

      var addBtn = card.querySelector(".add-btn");
      var nameEl = card.querySelector(".work-card__name");
      var name = (
        (addBtn && addBtn.dataset.name ? addBtn.dataset.name : "") +
        " " +
        (nameEl ? nameEl.textContent : "")
      ).toLowerCase();

      var prod = addBtn ? getProducts().find(function (x) { return x.id === addBtn.dataset.id; }) : null;
      if (prod) {
        name += " " + ((prod.keywords && prod.keywords.join) ? prod.keywords.join(" ") : "");
        name += " " + ((prod.colors || []).map(function (c) { return c.name; }).join(" "));
        name += " " + (categoryLabelOf(prod.category) || "");
        name += " " + (subcategoryLabelOf(prod.category, prod.subcategory) || "");
      }

      var termMatch = !term || name.indexOf(term) !== -1;
      var show = inRange && categoryMatch && subMatch && termMatch;
      card.classList.toggle("is-hidden", !show);
      /* Release the parked photo only once the card is actually shown, which
         covers the first page, "Show more", and every filter change. */
      if (show) hydrateCardImages(card);
      if (show) {
        visible += 1;
        if (prod) shown.push(prod);
      }
    });

    if (noResults) noResults.hidden = visible > 0;
    updateShowMoreBtn();
    applyProductSeo(shown);
  }

  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", function () {
      visibleCount += SHOW_STEP;
      applyFilters();
    });
  }

  function refreshCards() {
    cards = Array.from(document.querySelectorAll("[data-category]"));
    if (cards.length) applyFilters();
  }

  /* One delegated listener for every card's second photo, rather than one per
     card. Pointer devices only, so the touch path never registers it. */
  if (productGrid && window.matchMedia("(hover: hover)").matches) {
    productGrid.addEventListener("mouseover", function (e) {
      var card = e.target.closest ? e.target.closest(".work-card") : null;
      if (card) hydrateHoverImage(card);
    });
  }

  function renderProducts(products) {
    var withImages = (products || []).slice();
    if (productGrid) productGrid.innerHTML = withImages.map(cardHTML).join("");
    if (noProducts) noProducts.hidden = withImages.length > 0;
    if (productCountLabel) {
      productCountLabel.textContent =
        "Showing " + withImages.length + " handmade piece" +
        (withImages.length === 1 ? "" : "s");
    }

    var empty = !withImages.length;
    document.querySelectorAll(".shop-tools, .products-topbar, .show-more-wrap, .shop-bar").forEach(function (el) {
      el.hidden = empty;
    });
    if (productsView) productsView.hidden = false;

    buildColorSwatches();
    refreshCards();
  }

  function sortProducts(products, value) {
    var arr = (products || []).slice();
    if (value === "low") {
      arr.sort(function (a, b) { return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0); });
    } else if (value === "high") {
      arr.sort(function (a, b) { return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0); });
    } else if (value === "name") {
      arr.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
    }
    return arr;
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", function () {
      var withImages = sortProducts(getProducts(), sortSelect.value);
      if (productGrid) productGrid.innerHTML = withImages.map(cardHTML).join("");
      buildColorSwatches();
      refreshCards();
    });
  }

  /* How many pieces each featured group contributes. */
  var FEATURED_PER_GROUP = 2;

  /* The strip covers every branch a shopper can filter by rather than the tail
     of its parent category, which would only ever show the last branch - just
     bouquets for Wedding Gift, just pencils for School Items. A flat category
     is one group; a category with branches is one group per branch, so all of
     them get the same amount of space. Branch keys are positional "sgN", the
     same convention buildSubFilters and theme.js read them by. */
  function featuredGroups() {
    var groups = [];
    (getSettings().categories || []).forEach(function (label, i) {
      var key = "gr" + (i + 1);
      var subs = subcategoriesOf(key);
      if (!subs.length) {
        groups.push({ category: key, subcategory: "" });
        return;
      }
      subs.forEach(function (name, si) {
        groups.push({ category: key, subcategory: "sg" + (si + 1) });
      });
    });
    return groups;
  }

  function renderFeatured() {
    if (!featuredGrid) return;
    var products = getProducts();
    /* The newest end of each group, so the strip reads as "fresh off the hook".
       A group tops up from its photo-less products rather than dropping out,
       so a branch nobody has photographed yet still gets a card - the same
       photoPending placeholder the catalogue grid shows - instead of quietly
       vanishing from the strip. */
    var items = [];
    var groups = featuredGroups();
    groups.forEach(function (g) {
      var rows = products.filter(function (p) {
        return p.category === g.category && (p.subcategory || "") === g.subcategory;
      });
      var chosen = rows.filter(function (p) { return p.image; }).slice(-FEATURED_PER_GROUP);
      if (chosen.length < FEATURED_PER_GROUP) {
        rows.slice().reverse().forEach(function (p) {
          if (chosen.length >= FEATURED_PER_GROUP) return;
          if (chosen.indexOf(p) < 0) chosen.push(p);
        });
      }
      items = items.concat(chosen);
    });
    /* A product on a category key the settings no longer list, or on a branch
       key that has since been removed, would otherwise never reach the strip at
       all. This also covers a catalogue with no categories configured, where
       the loop above picks nothing. */
    var inGroup = function (p) {
      return groups.some(function (g) {
        return p.category === g.category && (p.subcategory || "") === g.subcategory;
      });
    };
    var strays = products.filter(function (p) { return p.image && !inGroup(p); });
    items = items.concat(strays.slice(0, FEATURED_PER_GROUP * 4));
    featuredGrid.innerHTML = items.map(cardHTML).join("");
    /* The featured grid is never filtered, so applyFilters never runs over it
       and nothing would promote its parked photos. */
    Array.prototype.forEach.call(featuredGrid.querySelectorAll(".work-card"), hydrateCardImages);
    var featuredSection = featuredGrid.closest(".section") || featuredGrid.closest("section");
    if (featuredSection) featuredSection.hidden = !items.length;
  }

  /* ---------- Category overview (one main image per category) ---------- */
  var categoryView = document.getElementById("categoryView");
  var productsView = document.getElementById("productsView");

  function categoryCardHTML(label, count, images, catKey, subs) {
    var slides = (images || []).filter(Boolean).map(function (s) { return displayImage(s); });
    var img = slides.length
      ? '<img src="' + slides[0] + '"' + imgSrcset((images || []).filter(Boolean)[0], "(max-width: 760px) 44vw, 260px") + ' alt="' + escapeHtml(label) + '" loading="lazy" decoding="async" data-slides="' +
        slides.join("|").replace(/"/g, "&quot;") + '">'
      : "";
    return (
      '<button class="category-card" type="button" data-cat="' + catKey + '">' +
      '<span class="category-card__img"><span class="image-slot">' + (img || photoPendingHTML()) + "</span></span>" +
      '<span class="category-card__body">' +
      '<span class="category-card__name">' + escapeHtml(label) + "</span>" +
      '<span class="category-card__count">' + count + " item" + (count === 1 ? "" : "s") + "</span>" +
      "</span>" +
      ((subs && subs.length)
        ? '<span class="category-card__subs">' +
          subs.map(escapeHtml).join('<span class="category-card__subsep" aria-hidden="true">&middot;</span>') +
          "</span>"
        : "") +
      "</button>"
    );
  }

  function startCategorySlideshows() {
    document
      .querySelectorAll(".category-card__img [data-slides]")
      .forEach(function (firstLayer) {
        var slides = firstLayer.dataset.slides.split("|").filter(Boolean);
        if (slides.length < 2) return;

        var box = firstLayer.parentElement;
        box.classList.add("slideshow");
        var secondLayer = firstLayer.cloneNode(true);
        secondLayer.removeAttribute("data-slides");
        secondLayer.src = slides[1];
        secondLayer.style.opacity = "0";
        firstLayer.classList.add("slideshow-layer");
        secondLayer.classList.add("slideshow-layer");
        box.appendChild(secondLayer);

        var showingFirst = true;
        var timer = null;
        var tick = function () {
          var show = showingFirst ? secondLayer : firstLayer;
          var hide = showingFirst ? firstLayer : secondLayer;
          showingFirst = !showingFirst;
          show.style.opacity = "1";
          hide.style.opacity = "0";
        };
        var startSlideshow = function () {
          if (timer) return;
          timer = window.setInterval(tick, 2400);
        };
        var stopSlideshow = function () {
          if (timer) {
            window.clearInterval(timer);
            timer = null;
          }
        };
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) startSlideshow();
              else stopSlideshow();
            });
          }, { threshold: 0.1 }).observe(box);
        } else {
          startSlideshow();
        }
      });
  }

  function renderCategoryCards() {
    var grid = document.getElementById("categoryGrid");
    if (!grid) return;
    var settings = getSettings();
    var products = getProducts().filter(function (p) { return p.category; });
    var cats = settings.categories || [];
    var out = [];
    cats.forEach(function (label, i) {
      var key = "gr" + (i + 1);
      var items = products.filter(function (p) { return p.category === key; });
      if (!items.length) return;
      var catImg =
        settings.categoryImages && settings.categoryImages[key]
          ? settings.categoryImages[key]
          : "";
      var imagesRaw = (Array.isArray(catImg) ? catImg : catImg ? [catImg] : []).filter(Boolean);
      out.push(
        categoryCardHTML(
          label || "Category " + (i + 1),
          items.length,
          imagesRaw,
          key,
          subcategoriesOf(key)
        )
      );
    });
    grid.innerHTML = out.join("");

    var shopSection = grid.closest(".section") || grid.closest("section");
    if (shopSection) shopSection.hidden = !out.length;
    startCategorySlideshows();
  }

  function showCategories() {
    if (categoryView) categoryView.hidden = false;
    if (productsView) productsView.hidden = true;
  }

  function showProducts(catKey, subKey) {
    if (categoryView) categoryView.hidden = true;
    if (productsView) productsView.hidden = false;
    if (searchInput) searchInput.value = "";
    if (filterWrap) {
      filterWrap.querySelectorAll(".filter-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.filter === catKey);
      });
    }
    buildSubFilters(catKey);
    setSubFilterUI(subKey || "all");
    visibleCount = INITIAL_VISIBLE;
    /* Branch meta first: applyProductSeo() reads the canonical back out of the
       head, so it has to be the branch URL and not the generic /products one. */
    applyBranchSeo(catKey, subKey);
    applyFilters();
    if (productsView) {
      productsView.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

/* ---------- SEO for the branch on screen ----------
     The catalogue is one page of filters, so on its own /products is a single
     URL standing in for 111 products. Two things fix that without a rewrite:
     Product schema for the cards actually on screen, and a real title,
     description and canonical for each branch the URL names
     (?cat=gr1&sub=sg2). Both are progressive - a crawler that never runs JS
     still sees the correct static head in products.html. */

  var SEO_ORIGIN = "https://gulnishcrochet.vercel.app";
  var SEO_PRODUCTS_URL = SEO_ORIGIN + "/products";
  var SEO_DEFAULT_TITLE = "Shop Handmade Crochet Products | Gulnish Crochet";
  var SEO_DEFAULT_DESC =
    "Browse handmade crochet purses, gajrays, keychains, bags, jewellery and headbands by Gulnish Crochet. Custom designs and made-to-order gifts available.";

  function seoAttr(selector, name, value) {
    var el = document.querySelector(selector);
    if (el && value) el.setAttribute(name, value);
  }

  /* Reuses the id on products.html's own breadcrumb block when it is there, so
     a filtered view updates it instead of adding a second BreadcrumbList. */
  function seoJsonLd(id, payload) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(payload);
  }

  /* Only catalogue photos get a schema image: an admin upload can be a data
     URL, which is not something a crawler can fetch. */
  function seoImage(src) {
    if (!src || String(src).indexOf("images/") !== 0) return "";
    return SEO_ORIGIN + "/" + String(src).replace(/^\/+/, "");
  }

  function seoBranchUrl(catKey, subKey) {
    var url = new URL(SEO_PRODUCTS_URL);
    if (catKey && catKey !== "all") url.searchParams.set("cat", catKey);
    if (subKey && subKey !== "all") url.searchParams.set("sub", subKey);
    return url.toString();
  }

  function applyBranchSeo(catKey, subKey) {
    if (!productsView) return;
    var cat = catKey && catKey !== "all" ? catKey : "";
    var sub = cat && subKey && subKey !== "all" ? subKey : "";
    var label = cat ? categoryLabelOf(cat) : "";
    var subLabel = cat && sub ? subcategoryLabelOf(cat, sub) : "";
    var branch = [label, subLabel].filter(Boolean).join(" ");
    var url = seoBranchUrl(cat, sub);

    /* The subcategory is what people search for, so it leads; the branch name
       follows after a dash. "Crochet Wedding Gift Bouquet" reads badly,
       "Crochet Bouquet - Wedding Gift" reads like a shelf. "in Pakistan" only
       rides along on the short flat titles - the branch ones are already long
       enough to push the brand name out of the search result. */
    var title = branch
      ? "Crochet " + (subLabel ? subLabel + " \u2013 " + label : label + " in Pakistan") + " | Gulnish Crochet"
      : SEO_DEFAULT_TITLE;
    var desc = branch
      ? "Handmade crochet " +
        (subLabel ? subLabel.toLowerCase() + " from our " + label + " collection." : label.toLowerCase() + " from Gulnish Crochet.") +
        " Stitched to order in Pakistan, custom colours and sizes, delivery confirmed on WhatsApp."
      : SEO_DEFAULT_DESC;

    document.title = title;
    seoAttr('meta[name="description"]', "content", desc);
    seoAttr('meta[property="og:title"]', "content", title);
    seoAttr('meta[property="og:description"]', "content", desc);
    seoAttr('meta[property="og:url"]', "content", url);
    seoAttr('meta[name="twitter:title"]', "content", title);
    seoAttr('meta[name="twitter:description"]', "content", desc);
    /* A named branch points at itself; the unfiltered grid keeps the one
       canonical /products URL so the filters never compete with it. */
    seoAttr('link[rel="canonical"]', "href", branch ? url : SEO_PRODUCTS_URL);

    var crumbs = [
      { "@type": "ListItem", position: 1, name: "Home", item: SEO_ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: "Products", item: SEO_PRODUCTS_URL }
    ];
    if (label) crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name: label, item: seoBranchUrl(cat, "") });
    if (subLabel) crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name: subLabel, item: url });

    seoJsonLd("seoBreadcrumbLd", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs
    });
  }

  /* Product markup follows what the shopper can actually see: only priced
     products with a real photo, and only the ones applyFilters() left
     visible. A price range becomes an AggregateOffer because that is exactly
     what the card prints. */
  function applyProductSeo(visible) {
    if (!productsView) return;
    var list = (visible || []).filter(function (p) {
      return p && seoImage(p.image) && parseFloat(p.price) > 0;
    });

    var url = document.querySelector('link[rel="canonical"]');
    var pageUrl = url ? url.href : SEO_PRODUCTS_URL;
    var products = list.map(function (p, i) {
      var sold = stockStatus(p) === "sold out";
      var availability = sold ? "https://schema.org/OutOfStock" : "https://schema.org/InStock";
      var offer = hasRange(p)
        ? {
            "@type": "AggregateOffer",
            lowPrice: String(parseFloat(p.price)),
            highPrice: String(parseFloat(p.priceMax)),
            priceCurrency: "PKR",
            offerCount: 1,
            availability: availability
          }
        : {
            "@type": "Offer",
            price: String(parseFloat(p.price)),
            priceCurrency: "PKR",
            availability: availability
          };
      var where = subcategoryLabelOf(p.category, p.subcategory) || categoryLabelOf(p.category);
      /* Each product has an address of its own now, so the shop page points at
         it instead of at itself: that is the page a shopper would be forwarded
         to, and the one Google should attach this offer to. */
      var productUrl =
        GC && GC.canonicalProductSlug
          ? SEO_ORIGIN + "/product/" + GC.canonicalProductSlug(p)
          : pageUrl;

      return {
        "@type": "Product",
        "@id": productUrl + "#product",
        name: p.name,
        description:
          String(p.name || "") +
          (where ? " - handmade crochet " + where.toLowerCase() : "") +
          " from Gulnish Crochet, made to order in Pakistan.",
        image: seoImage(p.image),
        sku: p.id,
        url: productUrl,
        inLanguage: "en",
        itemCondition: "https://schema.org/NewCondition",
        category: where,
        brand: { "@type": "Brand", name: "Gulnish Crochet" },
        offers: offer
      };
    });

    seoJsonLd("seoProductLd", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "ItemList",
          name: document.title,
          numberOfItems: products.length,
          itemListElement: products.map(function (p, i) {
            return { "@type": "ListItem", position: i + 1, item: { "@id": p["@id"] } };
          })
        }
      ].concat(products)
    });
  }

  /* ---------- Product page ---------- */
  var productView = document.getElementById("productView");
  var ppImage = document.getElementById("ppImage");
  var ppName = document.getElementById("ppName");
  var ppPrice = document.getElementById("ppPrice");
  var ppPriceNote = document.getElementById("ppPriceNote");
  var ppCategory = document.getElementById("ppCategory");
  var ppStatus = document.getElementById("ppStatus");
  var ppColors = document.getElementById("ppColors");
  var ppQtyVal = document.getElementById("ppQtyVal");
  var ppAdd = document.getElementById("ppAdd");
  var ppWa = document.getElementById("ppWa");
  var ppThumbs = document.getElementById("ppThumbs");
  var currentProduct = null;
  var currentQty = 1;

  function updatePpWa() {
    if (!ppWa || !currentProduct) return;
    var waNum = GC && GC.shopWhatsApp ? GC.shopWhatsApp() : "";
    var swatch = ppColors ? ppColors.querySelector(".color-swatch.selected") : null;
    var color = swatch ? swatch.dataset.color : "";
    var lines = ["Hi Gulnish Crochet, I'd like to order:"];
    lines.push("*" + (currentProduct.name || "this item") + "*");
    var extra = [];
      if (parseFloat(currentProduct.price) > 0) {
        /* No photo means the price is agreed on WhatsApp, so it is left out
           of the pre-filled message rather than quoted. money() already
           includes the "Rs." prefix. A ranged item is quoted as the range so
           the shop and the customer are working from the same figure. */
        var quote = !currentProduct.image
          ? "Rs. ..."
          : (hasRange(currentProduct)
            ? money(currentProduct.price) + " - " + money(currentProduct.priceMax)
            : money(currentProduct.price));
        extra.push(quote);
      }
    if (color) extra.push("Colour: " + color);
    if (currentQty > 1) extra.push("Qty: " + currentQty);
    if (extra.length) lines.push(extra.join(" \u2022 "));
    lines.push("");
    lines.push("Is it available?");
    ppWa.href = waNum
      ? "https://wa.me/" + encodeURIComponent(waNum) + "?text=" + encodeURIComponent(lines.join("\n"))
      : "#";
  }

  function categoryLabelOf(val, settings) {
    var idx = parseInt(String(val || "").replace("gr", ""), 10) - 1;
    var cats = (settings || getSettings()).categories || [];
    return idx >= 0 && cats[idx] ? cats[idx] : val || "";
  }

  function showProduct(id) {
    var p = getProducts().find(function (x) { return x.id === id; });
    if (!p) return;
    currentProduct = p;
    currentQty = 1;
    if (ppQtyVal) ppQtyVal.textContent = "1";

    if (ppImage) {
      ppImage.innerHTML = p.image
        ? '<img src="' + displayImage(p.image) + '"' + imgSrcset(p.image, "(max-width: 900px) 92vw, 520px") + ' alt="' + escapeHtml(p.name) + '">'
        : photoPendingHTML("photo-pending--lg");
    }
    if (ppThumbs) {
      var all = [p.image].concat((p.gallery || []).filter(Boolean).filter(function (s) { return s !== p.image; }));
      ppThumbs.innerHTML = all.map(function (src, i) {
        return '<button type="button" class="pp-thumb' + (i === 0 ? " active" : "") +
          '" data-pp-thumb="' + escapeHtml(src) + '" aria-label="' + escapeHtml(p.name) + " image " + (i + 1) + '">' +
          '<img src="' + displayImage(src) + '"' + imgSrcset(src, "96px") + ' alt="" loading="lazy" decoding="async"></button>';
      }).join("");
      ppThumbs.hidden = all.length <= 1;
    }
    if (ppName) ppName.textContent = p.name || "";
      if (ppPrice) {
        ppPrice.textContent = displayPrice(p);
      }
      /* A range needs saying out loud: read on its own, a two-figure price can
         look like the amount due. */
      if (ppPriceNote) {
        ppPriceNote.hidden = !hasRange(p);
        ppPriceNote.textContent = hasRange(p)
          ? "Price varies with size and detailing \u2014 the exact figure is confirmed on WhatsApp."
          : "";
      }
    if (ppCategory) {
      /* "Small Gifts · Keychains" reads better than the bare category once a
         product is filed under a subcategory. */
      var catLabel = categoryLabelOf(p.category);
      var subLabel = subcategoryLabelOf(p.category, p.subcategory);
      ppCategory.textContent = subLabel
        ? catLabel + " \u00b7 " + subLabel
        : catLabel;
    }
    if (ppStatus) {
      var s = stockStatus(p);
      if (s === "made to order") {
        ppStatus.hidden = false;
        ppStatus.className = "product-page__status status-made";
        ppStatus.textContent = "Made to order \u2014 takes about 5 days";
      } else if (s === "sold out") {
        ppStatus.hidden = false;
        ppStatus.className = "product-page__status status-out";
        ppStatus.textContent = "Sold out \u2014 message us and we can make one for you";
      } else {
        ppStatus.hidden = true;
      }
    }
    if (ppAdd) {
      /* Same sold-out rule as the card overlay and quick view: a product
         marked sold out must not be purchasable from any surface. */
      var ppSoldOut = s === "sold out";
      ppAdd.disabled = ppSoldOut;
      ppAdd.textContent = ppSoldOut ? "Sold Out" : "Add to Cart";
      ppAdd.classList.toggle("is-disabled", ppSoldOut);
    }
    if (ppColors) {
      ppColors.setAttribute(
        "data-colors",
        (p.colors || [])
          .map(function (c) { return c.name + "|" + c.hex; })
          .filter(function (s) { return s.split("|")[0]; })
          .join(",")
      );
    }
    buildColorSwatches();
    updatePpWa();

    if (categoryView) categoryView.hidden = true;
    if (productsView) productsView.hidden = true;
    if (productView) productView.hidden = false;
    if (productView) productView.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function showProductList() {
    currentProduct = null;
    if (productView) productView.hidden = true;
    if (productsView) productsView.hidden = false;
    applyFilters();
    if (productsView) productsView.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  if (ppAdd) {
    ppAdd.addEventListener("click", function () {
      if (!currentProduct) return;
      /* Matches the card and quick-view rule: a sold-out product is not
         purchasable from any surface. */
      if (ppAdd.disabled) {
        showToast("This piece is sold out — message us on WhatsApp.");
        return;
      }
      var swatch = ppColors
        ? ppColors.querySelector(".color-swatch.selected")
        : null;
      var bigImg = ppImage ? ppImage.querySelector("img") : null;
      addToCart({
        id: currentProduct.id,
        name: currentProduct.name || "",
        price: parseFloat(currentProduct.price) || 0,
        color: swatch ? swatch.dataset.color : "",
        image: bigImg && bigImg.src ? bigImg.currentSrc || bigImg.src : "",
        qty: currentQty
      });
      flyToCart(ppAdd);
    });
  }

  document.querySelectorAll("[data-pq]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!currentProduct) return;
      var n =
        btn.dataset.pq === "plus" ? currentQty + 1 : currentQty - 1;
      currentQty = Math.min(99, Math.max(1, n));
      if (ppQtyVal) ppQtyVal.textContent = String(currentQty);
      updatePpWa();
    });
  });

  document.addEventListener("click", function (e) {
    var catBtn = e.target.closest(".category-card");
    if (catBtn) {
      if (productsView) {
        showProducts(catBtn.dataset.cat);
      } else {
        location.href =
          "/products?cat=" + encodeURIComponent(catBtn.dataset.cat);
      }
      return;
    }
    var backBtn = e.target.closest("[data-back-categories]");
    if (backBtn) {
      if (backBtn.dataset.backCategories === "all") {
        if (productsView) showProducts("all");
        else location.href = "/products";
      } else if (categoryView) {
        showCategories();
      } else {
        location.href = "/";
      }
      return;
    }
    /* A card photo or title is a real link to that product's page. A plain left
       click keeps quick view, which is the fast way to shop, while a modified
       or middle click follows the href - that is what "open in new tab",
       "open in new window" and "copy link address" all rely on, and they all
       pass a modifier or a non-primary button, so they are left alone. */
    var productLink = e.target.closest("a.js-product-link");
    if (productLink) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      var linkId = productLink.dataset.view;
      if (linkId && productView) {
        showProduct(linkId);
      } else {
        location.href = productLink.getAttribute("href");
      }
      return;
    }
    var viewBtn = e.target.closest(".js-product-view");
    if (viewBtn) {
      if (productView) {
        showProduct(viewBtn.dataset.view);
      } else {
        location.href = "/products";
      }
      return;
    }
    var backP = e.target.closest("[data-back-products]");
    if (backP) showProductList();
  });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".filter-btn");
    if (!btn) return;
    if (subFilterWrap && subFilterWrap.contains(btn)) {
      setSubFilterUI(btn.dataset.subFilter);
      applyFilters();
      return;
    }
    /* Switching parent category starts a fresh sub-filter: the sub row is
       rebuilt from scratch, so a stale "sg1" must not carry over. */
    buildSubFilters(btn.dataset.filter);
    if (filterWrap) {
      filterWrap.querySelectorAll(".filter-btn").forEach(function (b) {
        b.classList.remove("active");
      });
    }
    btn.classList.add("active");
    applyFilters();
  });

  /* ---------- Build color swatches from data-colors ---------- */
  function buildColorSwatches() {
    document
      .querySelectorAll(".work-card__colors[data-colors]")
      .forEach(function (box) {
        var raw = box.dataset.colors;
        if (!raw) return;
        box.innerHTML = "";
        raw.split(",").forEach(function (pair, idx) {
          var parts = pair.split("|");
          var name = parts[0];
          var hex = parts[1];
          var swatch = document.createElement("button");
          swatch.type = "button";
          swatch.className = "color-swatch";
          swatch.dataset.color = (name || "").trim();
          swatch.style.setProperty("--swatch", (hex || "#ccc").trim());
          swatch.setAttribute("aria-label", (name || "Color").trim());
          swatch.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
          if (idx === 0) swatch.classList.add("selected");
          box.appendChild(swatch);
        });
      });
  }

  /* ---------- Cart ---------- */
  var STORAGE_KEY = "gulnish-cart";

  var cart = loadCart();

  var cartToggle = document.getElementById("cartToggle");
  var cartClose = document.getElementById("cartClose");
  var cartOverlay = document.getElementById("cartOverlay");
  var cartDrawer = document.getElementById("cartDrawer");
  var cartItemsEl = document.getElementById("cartItems");
  var cartCountEl = document.getElementById("cartCount");
  var cartSubtotalEl = document.getElementById("cartSubtotal");
  var cartSubtotalLabelEl = document.getElementById("cartSubtotalLabel");
  var cartDeliveryRow = document.getElementById("cartDeliveryRow");
  var cartDeliveryEl = document.getElementById("cartDelivery");
  var cartGrandRow = document.getElementById("cartGrandRow");
  var cartGrandEl = document.getElementById("cartGrand");
  var cartGrandLabelEl = document.getElementById("cartGrandLabel");
  var cartBar = document.getElementById("cartBar");
  var cartBarCount = document.getElementById("cartBarCount");
  var cartBarTotal = document.getElementById("cartBarTotal");
  var cartBarBtn = document.getElementById("cartBarBtn");
  var bottomNavCount = document.getElementById("bottomNavCount");
  var bottomNavCart = document.getElementById("bottomNavCart");

  /* The header cart button is hidden on phones and the bottom nav one is
     hidden on desktop, so every cart control has to be driven together:
     aria-expanded has to land on whichever is visible, and closing the drawer
     has to hand focus back to a control that can actually take it. */
  function cartTriggers() {
    return [cartToggle, bottomNavCart].filter(Boolean);
  }

  function visibleCartTrigger() {
    var triggers = cartTriggers();
    for (var i = 0; i < triggers.length; i++) {
      var rect = triggers[i].getBoundingClientRect();
      if (rect.width || rect.height) return triggers[i];
    }
    return cartToggle;
  }


  function loadCart() {
    try {
      var items = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      return items.map(function (item) {
        return Object.assign({}, item, { key: item.key || itemKey(item) });
      });
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }

  function cartTotalQty() {
    return cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
  }

  function cartUnitPrice(item) {
    var found = (getProducts() || []).find(function (x) { return x.id === item.id; });
    return found && parseFloat(found.price) > 0
      ? parseFloat(found.price)
      : (parseFloat(item.price) || 0);
  }

  /* Top of the published range, or 0 for a single fixed price. Read off the
     live product so an admin price edit shows up in the drawer at once. */
  function cartUnitPriceMax(item) {
    var found = (getProducts() || []).find(function (x) { return x.id === item.id; });
    var base = cartUnitPrice(item);
    var top = found ? parseFloat(found.priceMax) || 0 : 0;
    return top > base ? top : 0;
  }

  function cartTotalPrice() {
    return cart.reduce(
      function (sum, item) { return sum + cartUnitPrice(item) * item.qty; }, 0
    );
  }

  /* Keychains ship at a flat Rs. 250, charged once per order however many are
     in the basket. Every other category is still quoted on WhatsApp. */
  function cartDeliveryCharge() {
    return GC && GC.deliveryCharge ? GC.deliveryCharge(cart) : 0;
  }

  function itemKey(item) {
    return item.id + (item.color ? "__" + item.color : "");
  }

  function addToCart(product) {
    var qty = Math.max(1, parseInt(product.qty, 10) || 1);
    var key = itemKey(product);
    var existing = cart.find(function (item) { return itemKey(item) === key; });
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push(Object.assign({}, product, { key: key, qty: qty }));
    }
    saveCart();
    renderCart();
    bumpBadge();
    showToast("Added to cart");
  }

  function removeFromCart(key) {
    cart = cart.filter(function (item) { return item.key !== key; });
    saveCart();
    renderCart();
  }

  function setQty(key, qty) {
    var item = cart.find(function (i) { return i.key === key; });
    if (!item) return;
    item.qty = Math.max(0, qty);
    if (item.qty === 0) cart = cart.filter(function (i) { return i.key !== key; });
    saveCart();
    renderCart();
  }

  function renderCart() {
    var n = cartTotalQty();
    var total = cartTotalPrice();
    document.body.classList.toggle("has-cart", n > 0);
    if (bottomNavCount) {
      bottomNavCount.textContent = n;
      bottomNavCount.classList.toggle("show", n > 0);
    }
    if (cartCountEl) {
      cartCountEl.textContent = n;
      cartCountEl.classList.toggle("show", n > 0);
    }
    if (cartBar) cartBar.classList.toggle("show", n > 0);
    if (cartBarCount) cartBarCount.textContent = n;
    if (cartBarTotal) cartBarTotal.textContent = money(total + cartDeliveryCharge());
    positionFloatingActions();
    if (!cartItemsEl) return;

    if (!cart.length) {
      cartItemsEl.innerHTML =
        '<div class="cart-empty"><span class="cart-empty__ph">&#128722;</span>' +
        "<p>Your cart is empty</p></div>";
      if (cartSubtotalEl) cartSubtotalEl.textContent = money(0);
      /* Clear the delivery rows with the rest of the drawer, or an emptied
         basket would keep showing a Rs. 250 charge and a grand total. */
      if (cartDeliveryRow) cartDeliveryRow.hidden = true;
      if (cartGrandRow) cartGrandRow.hidden = true;
      return;
    }

    cartItemsEl.innerHTML = cart
      .map(function (item) {
        return (
          '<div class="cart-item">' +
          '<div class="cart-item__img">' +
          (item.image
            ? '<img src="' + item.image + '"' + imgSrcset(item.image, "72px") + ' alt="' + (item.name || "").replace(/"/g, "&quot;") + '">'
            : '<span class="cart-item__ph">&#128722;</span>') +
          "</div>" +
          '<div class="cart-item__info">' +
          '<span class="cart-item__name">' + escapeHtml(item.name || "Item") + "</span>" +
          '<span class="cart-item__price">' + money(cartUnitPrice(item)) + "</span>" +
          (item.color ? '<span class="cart-item__color">' + escapeHtml(item.color) + "</span>" : "") +
          '<div class="qty">' +
          '<button class="qty__btn" data-action="minus" data-key="' + item.key + '" aria-label="Decrease">&#8722;</button>' +
          '<span class="qty__val">' + item.qty + "</span>" +
          '<button class="qty__btn" data-action="plus" data-key="' + item.key + '" aria-label="Increase">+</button>' +
          "</div></div>" +
          '<button class="cart-item__remove" data-action="remove" data-key="' + item.key + '" aria-label="Remove">&times;</button>' +
          "</div>"
        );
      })
      .join("");

    var sub = cartTotalPrice();
    if (cartSubtotalEl) cartSubtotalEl.textContent = money(sub);

    /* A ranged item makes the subtotal a floor rather than the amount owed, so
       say so instead of letting it read as a settled figure. */
    var ranged = cart.some(function (item) { return cartUnitPriceMax(item) > 0; });
    if (cartSubtotalLabelEl) {
      cartSubtotalLabelEl.textContent = ranged ? "Subtotal (from)" : "Subtotal";
    }

    /* The delivery rows show only for a basket holding a keychain. */
    var delivery = cartDeliveryCharge();
    if (cartDeliveryRow) cartDeliveryRow.hidden = !delivery;
    if (cartDeliveryEl) cartDeliveryEl.textContent = money(delivery);
    if (cartGrandRow) cartGrandRow.hidden = !delivery;
    if (cartGrandEl) cartGrandEl.textContent = money(sub + delivery);
    if (cartGrandLabelEl) {
      cartGrandLabelEl.textContent = ranged ? "Total (from)" : "Total";
    }
  }

  function openCart() {
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden", "false");
    cartTriggers().forEach(function (t) { t.setAttribute("aria-expanded", "true"); });
    cartOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
    /* The drawer is visibility:hidden until .open lands, and visibility is
       inherited, so focusing the close button in this same task is a no-op -
       the browser still computes it as unfocusable and keyboard focus stays
       stranded on the page behind the overlay. Reading offsetWidth forces
       Blink to flush style, which commits visibility:visible; only then will
       focus() take effect. (A rAF here would also work, but this is
       deterministic and cannot be skipped by a throttled frame.) */
    var closeBtn = document.getElementById("cartClose");
    if (closeBtn) {
      void closeBtn.offsetWidth;
      closeBtn.focus();
    }
  }

  function closeCart() {
    var wasOpen = cartDrawer.classList.contains("open");
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden", "true");
    cartTriggers().forEach(function (t) { t.setAttribute("aria-expanded", "false"); });
    cartOverlay.classList.remove("open");
    document.body.style.overflow = "";
    if (wasOpen) visibleCartTrigger().focus();
  }

  function bumpBadge() {
    if (!cartCountEl) return;
    cartCountEl.classList.remove("bump");
    void cartCountEl.offsetWidth;
    cartCountEl.classList.add("bump");
  }

  document.addEventListener("click", function (e) {
    var swatch = e.target.closest(".color-swatch");
    if (swatch) {
      var scope =
        swatch.closest(".work-card") || swatch.closest(".product-page");
      if (scope) {
        scope.querySelectorAll(".color-swatch").forEach(function (s) {
          s.classList.remove("selected");
          s.setAttribute("aria-pressed", "false");
        });
        swatch.classList.add("selected");
        swatch.setAttribute("aria-pressed", "true");
      }
      updatePpWa();
      return;
    }

    var thumbBtn = e.target.closest("[data-pp-thumb]");
    if (thumbBtn && ppImage) {
      var mainImg = ppImage.querySelector("img");
      if (mainImg) mainImg.src = displayImage(thumbBtn.dataset.ppThumb);
      document.querySelectorAll("[data-pp-thumb]").forEach(function (b) {
        b.classList.toggle("active", b === thumbBtn);
      });
      return;
    }

    var addBtn = e.target.closest(".add-btn");
    if (addBtn) {
      /* The card button is marked disabled for sold-out products, but this
         is a delegated handler, so the click still arrives here. Without
         this guard a sold-out piece could be added to the cart. */
      if (addBtn.disabled || addBtn.getAttribute("aria-disabled") === "true") {
        showToast("This piece is sold out — message us on WhatsApp.");
        return;
      }
      var card = addBtn.closest(".work-card");
      /* Safety net: the photo is parked until the card is shown, so make sure
         it is released before its URL is copied into the cart line. */
      hydrateCardImages(card);
      var img = card ? card.querySelector(".work-card__media img") : null;
      var swatchEl = card ? card.querySelector(".color-swatch.selected") : null;
      addToCart({
        id: addBtn.dataset.id || Math.random().toString(36).slice(2),
        name: addBtn.dataset.name || "",
        price: parseFloat(addBtn.dataset.price) || 0,
        color: swatchEl ? swatchEl.dataset.color : "",
        /* On a product's own page the photo is not inside a card, so the
           button carries it in data-image and the cart line still gets one. */
        image: (img && img.src ? img.currentSrc || img.src : "") || addBtn.dataset.image || ""
      });
      flyToCart(addBtn);
      return;
    }

    var removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) {
      removeFromCart(removeBtn.dataset.key);
      return;
    }

    var qtyBtn = e.target.closest(".qty__btn");
    if (qtyBtn) {
      var item = cart.find(function (i) { return i.key === qtyBtn.dataset.key; });
      if (item) {
        setQty(
          item.key,
          qtyBtn.dataset.action === "plus" ? item.qty + 1 : item.qty - 1
        );
      }
      return;
    }

    if (e.target.closest("#cartCheckout")) {
      if (!cart.length) {
        showToast("Your cart is empty.");
        return;
      }
      window.location.href = "/checkout";
      return;
    }
  });

  if (cartToggle) cartToggle.addEventListener("click", openCart);
  if (cartClose) cartClose.addEventListener("click", closeCart);
  if (cartOverlay) cartOverlay.addEventListener("click", closeCart);
  if (cartBarBtn) {
    cartBarBtn.addEventListener("click", function () {
      window.location.href = "/cart";
    });
  }
  /* Cross-file sync: other pages (e.g. cart) push cart changes here */
  window.addEventListener("gulnish:cart", function () {
    cart = loadCart();
    renderCart();
  });
  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      cartDrawer &&
      cartDrawer.classList.contains("open")
    ) {
      closeCart();
    }
  });

  renderCart();

  /* ---------- Lightbox ---------- */
  var lightbox = document.querySelector(".lightbox");
  if (lightbox) {
    var images = [];
    var current = 0;

    var imgEl = lightbox.querySelector(".lightbox__img");
    var capEl = lightbox.querySelector(".lightbox__caption");
    var closeBtn = lightbox.querySelector(".lightbox__close");
    var prevBtn = lightbox.querySelector(".lightbox__nav--prev");
    var nextBtn = lightbox.querySelector(".lightbox__nav--next");

    var open = function (index) {
      current = index;
      var item = images[current];
      imgEl.src = item.src;
      imgEl.alt = item.alt || "";
      capEl.textContent = item.name || "";
      lightbox.classList.add("open");
      document.body.style.overflow = "hidden";
    };

    var close = function () {
      lightbox.classList.remove("open");
      document.body.style.overflow = "";
    };

    document
      .querySelectorAll(".js-lightbox")
      .forEach(function (slot) {
        slot.addEventListener("click", function () {
          var currentImages = Array.from(
            document.querySelectorAll(".js-lightbox img")
          ).map(function (img) {
            var cardName = img.closest(".work-card") ?
              img.closest(".work-card").querySelector(".work-card__name") : null;
            var prodName = img.closest(".product-page") ?
              img.closest(".product-page").querySelector(".product-page__name") : null;
            return {
              src: img.currentSrc || img.src,
              alt: img.alt,
              name: (cardName ? cardName.textContent : "") ||
                (prodName ? prodName.textContent : "") || ""
            };
          });

          if (slot.classList.contains("product-page__media") && currentProduct) {
            var all = [currentProduct.image]
              .concat((currentProduct.gallery || []).filter(Boolean))
              .filter(Boolean);
            currentImages = all.map(function (src) {
              return {
                src: src,
                alt: (ppName ? ppName.textContent : "") + " photo",
                name: ppName ? ppName.textContent : ""
              };
            });
          }
          images = currentImages;

          var img = slot.querySelector("img");
          if (!img || !img.src) return;
          var shown = img.currentSrc || img.src;
          var idx = images.findIndex(function (i) {
            return i.src === shown || displayImage(i.src) === shown;
          });
          open(idx === -1 ? 0 : idx);
        });
      });

    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      open((current - 1 + images.length) % images.length);
    });
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      open((current + 1) % images.length);
    });
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prevBtn.click();
      if (e.key === "ArrowRight") nextBtn.click();
    });
  }

  /* ---------- Skeleton placeholders ---------- */
  var skeletonGrids = ["productGrid", "featuredGrid", "categoryGrid"];
  skeletonGrids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el && !el.innerHTML) {
      var block =
        '<div class="skeleton-card"><div class="skeleton skeleton--img"></div>' +
        '<div class="skeleton skeleton--line"></div>' +
        '<div class="skeleton skeleton--line skeleton--short"></div></div>';
      el.innerHTML = new Array(9).join(block);
    }
  });

  /* ---------- Contact buttons: WhatsApp + Call (from settings) ---------- */
  function updateContactButtons() {
    var waNum = GC && GC.shopWhatsApp ? GC.shopWhatsApp() : "";
    var intl = waNum || "923075729901";

    /* Floating pill opens a WhatsApp chat. */
    document.querySelectorAll(".fb-wa").forEach(function (a) {
      a.href = "https://wa.me/" + intl;
    });

    /* The cart drawer keeps a direct-call option. */
    document.querySelectorAll(".cart-call").forEach(function (a) {
      a.href = "tel:+" + intl;
    });
  }

  /* ---------- keep the floating pill clear of the mobile bottom bars ----------
     On phones the bottom of the screen stacks up: the nav bar, then the
     view-cart bar, then (at checkout) the place-order bar. A pill pinned to
     a fixed offset ends up sitting on top of one of them and hides the
     "View Cart" call to action. Rather than hard-code bar heights, measure
     whichever bars are actually on screen and sit just above the tallest. */
  function positionFloatingActions() {
    var stack = 0;
    FB_BARS.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el || el.hidden) return;
      if (window.getComputedStyle(el).display === "none") return;
      var r = el.getBoundingClientRect();
      if (!r.height) return;
      /* distance from the viewport bottom up to the top of this bar */
      stack = Math.max(stack, window.innerHeight - r.top);
    });

    /* Publish the same measurement as --bar-stack so the body's bottom padding
       reserves exactly as much room as the bars occupy. Guessing the height in
       CSS was wrong: the checkout bar is taller than the value assumed there,
       so the last line of the footer sat underneath it. */
    document.documentElement.style.setProperty(
      "--bar-stack",
      stack ? Math.round(stack) + "px" : ""
    );

    var group = document.querySelector(".fb-group");
    if (!group) return;

    group.style.setProperty(
      "--fb-bottom",
      stack ? Math.round(stack + 14) + "px" : ""
    );
  }

  /* Re-measure whenever a bar appears/disappears or the viewport changes. */
  (function watchFloatingActions() {
    var pending = false;
    var schedule = function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        positionFloatingActions();
      });
    };

    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("visibilitychange", schedule);

    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(schedule);
      FB_BARS.forEach(function (sel) {
        var el = document.querySelector(sel);
        if (el) ro.observe(el);
      });
    }

    /* Show/hide flips class or hidden, and the bar also changes height once
       the item count and total are written into it — watch both, and re-check
       on the next frame because attribute changes fire before layout settles. */
    if (typeof MutationObserver === "function") {
      var mo = new MutationObserver(schedule);
      FB_BARS.forEach(function (sel) {
        var el = document.querySelector(sel);
        if (el) {
          mo.observe(el, {
            attributes: true,
            attributeFilter: ["class", "hidden"],
            childList: true,
            subtree: true,
            characterData: true
          });
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule);
    }
    window.addEventListener("load", schedule);
    schedule();
    setTimeout(schedule, 350);
    setTimeout(schedule, 900);
    setTimeout(schedule, 2000);
  })();


  /* ---------- Mobile bottom navigation ---------- */
  if (bottomNavCart) {
    bottomNavCart.addEventListener("click", function () {
      if (cartDrawer && cartToggle) {
        if (!cartDrawer.classList.contains("open")) openCart();
      }
    });
  }
  (function highlightBottomNav() {
    if (!document.querySelector(".bottom-nav")) return;
    var page = (location.pathname.split("/").pop() || "index")
      .toLowerCase()
      .replace(/\.html$/, "");
    var key = {
      "index": "home",
      "products": "products",
      "about": "about",
      "contact": "contact"
    }[page] || "";
    document.querySelectorAll(".bottom-nav__item[data-nav]").forEach(function (el) {
      if (el.dataset.nav === key) el.classList.add("active");
    });
  })();

  /* ---------- Render shop once shared data is loaded ---------- */
  function renderShop() {
    var settings = getSettings();
    updateContactButtons();
    buildFilters(settings);
    renderCategoryCards();
    renderFeatured();
    renderProducts(getProducts());
    var urlCat = new URLSearchParams(location.search).get("cat");
    var urlSub = new URLSearchParams(location.search).get("sub");
    var urlQ = (new URLSearchParams(location.search).get("q") || "").trim();
    if (searchInput && urlQ) searchInput.value = urlQ;
    if (productsView) {
      showProducts(urlCat ? urlCat : "all", urlSub || "all");
      /* The header search overlay and the wishlist both deep-link with
         ?q=<product id>. Treat an exact id hit as "open this product" —
         otherwise the id gets fed to the text filter and the shopper lands
         on an empty grid. Anything else stays a normal text query. */
      if (urlQ) {
        var exact = getProducts().find(function (p) { return p.id === urlQ; });
        if (exact) {
          if (searchInput) searchInput.value = "";
          showProduct(exact.id);
        }
      }
    } else {
      showCategories();
    }
    if (searchInput) searchInput.addEventListener("input", applyFilters);
  }

  if (GC && GC.init) {
    GC.init().then(renderShop);
  } else {
    renderShop();
  }

  /* Lets checkout.js re-measure after it toggles the place-order bar. */
  if (GC) GC.positionFloatingActions = positionFloatingActions;
})();
