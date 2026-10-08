(function () {
  "use strict";

  var STORAGE_KEY = "gulnish-cart";
  var GC = window.GC;

  var wrap = document.getElementById("cpWrap");
  var empty = document.getElementById("cpEmpty");
  var itemsEl = document.getElementById("cpItems");
  var countLabel = document.getElementById("cpCountLabel");
  var subtotalEl = document.getElementById("cpSubtotal");
  var subtotalLabel = document.getElementById("cpSubtotalLabel");
  var waLink = document.getElementById("cpWa");
  var deliveryRow = document.getElementById("cpDeliveryRow");
  var deliveryEl = document.getElementById("cpDelivery");
  var grandRow = document.getElementById("cpGrandRow");
  var grandEl = document.getElementById("cpGrand");

  function getProducts() { return GC ? GC.products || [] : []; }
  function getSettings() { return GC ? GC.settings || {} : {}; }

  function money(value) {
    var n = parseFloat(value) || 0;
    var str = String(Math.round(n * 100) / 100);
    var parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "Rs. " + parts.join(".");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function saveCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("gulnish:cart"));
  }

  function itemKey(item) {
    return item.id + (item.color ? "__" + item.color : "");
  }

  function unitPrice(item) {
    var found = getProducts().find(function (x) { return x.id === item.id; });
    return found && parseFloat(found.price) > 0 ? parseFloat(found.price) : (parseFloat(item.price) || 0);
  }

  /* The top of a product's published price range, or 0 when it has a single
     fixed price. Read live off the product rather than the cart copy so a
     price edited in the admin panel is picked up straight away. */
  function unitPriceMax(item) {
    var found = getProducts().find(function (x) { return x.id === item.id; });
    var base = unitPrice(item);
    var top = found ? parseFloat(found.priceMax) || 0 : 0;
    return top > base ? top : 0;
  }

  function hasRange(item) { return unitPriceMax(item) > 0; }

  /* A ranged item is quoted as a range for the whole line, so the figure on
     screen can never read as the amount actually owed. */
  function linePrice(item) {
    var base = unitPrice(item) * item.qty;
    var top = unitPriceMax(item);
    if (!top) return money(base);
    return money(base) + " – " + money(top * item.qty);
  }

  function totalPrice(cart) {
    return cart.reduce(function (sum, item) { return sum + unitPrice(item) * item.qty; }, 0);
  }

  function totalQty(cart) {
    return cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
  }

  /* Keychains carry a flat Rs. 250 delivery, added once per order. Every
     other category is still quoted on WhatsApp, never here. */
  function deliveryCharge(cart) {
    return GC && GC.deliveryCharge ? GC.deliveryCharge(cart) : 0;
  }

  function waBase() {
    var num = GC && GC.shopWhatsApp ? GC.shopWhatsApp() : "";
    return num ? "https://wa.me/" + encodeURIComponent(num) : "";
  }

  /* The message itself is built by GC.whatsappOrderLink so the cart page, the
     cart drawer and checkout all send the same wording. This only has to supply
     the basket. */
  function buildWaHref(cart) {
    if (!cart || !cart.length) return "#";
    if (GC && GC.whatsappOrderLink) return GC.whatsappOrderLink(cart) || "#";
    return "#";
  }

  /* The subtotal is the sum of the base prices, so with a ranged item in the
     basket it is a floor rather than the amount owed. Say so on the line
     instead of letting it read as the total. */
  function updateSubtotalLabel(cart) {
    var ranged = cart.some(function (item) { return hasRange(item); });
    if (subtotalLabel) subtotalLabel.textContent = ranged ? "Subtotal (from)" : "Subtotal";
  }

  function render() {
    var cart = loadCart();
    var n = totalQty(cart);
    var subtotal = totalPrice(cart);

    if (!itemsEl) return;
    if (!n) {
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (wrap) wrap.hidden = false;
    if (empty) empty.hidden = true;

    if (countLabel) {
      countLabel.textContent = n === 1 ? "1 item in your bag" : n + " items in your bag";
    }

    itemsEl.innerHTML = cart
      .map(function (item) {
        return (
          '<div class="cp-item">' +
          '<a class="cp-item__img" href="/products">' +
          (item.image
            ? '<img src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.name || "Item") + '" loading="lazy">'
            : '<span class="cp-item__ph">&#128722;</span>') +
          "</a>" +
          '<div class="cp-item__info">' +
          '<span class="cp-item__name">' + escapeHtml(item.name || "Item") + "</span>" +
          (item.color ? '<span class="cp-item__color">' + escapeHtml(item.color) + "</span>" : "") +
          '<span class="cp-item__price">' + linePrice(item) + "</span>" +
          "</div>" +
          '<div class="cp-item__actions">' +
          '<div class="qty cp-qty">' +
          '<button type="button" class="qty__btn cp-qty__btn" data-action="minus" data-key="' + escapeHtml(item.key) + '" aria-label="Decrease">&#8722;</button>' +
          '<span class="qty__val">' + item.qty + "</span>" +
          '<button type="button" class="qty__btn cp-qty__btn" data-action="plus" data-key="' + escapeHtml(item.key) + '" aria-label="Increase">+</button>' +
          "</div>" +
          '<button type="button" class="cp-item__remove" data-action="remove" data-key="' + escapeHtml(item.key) + '" aria-label="Remove">Remove</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    updateSubtotalLabel(cart);

    /* The delivery row only exists for a basket holding a keychain, and the
       grand total follows it so the shopper sees one figure to expect. */
    var delivery = deliveryCharge(cart);
    if (deliveryRow) deliveryRow.hidden = !delivery;
    if (deliveryEl) deliveryEl.textContent = money(delivery);
    if (grandRow) grandRow.hidden = !delivery;
    if (grandEl) grandEl.textContent = money(subtotal + delivery);

    if (waLink) waLink.href = buildWaHref(cart);
  }

  function broadcastAndRender(cart) {
    saveCart(cart);
    render();
  }

  if (itemsEl) {
    itemsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".cp-qty__btn, .cp-item__remove");
      if (!btn) return;
      /* Mark the event so script.js's document listener skips it: it runs after
         this one (the click bubbles from #cpItems to document) and by then the
         list has been rebuilt, so its own #cpItems test sees a detached node
         and the same change would be applied twice. */
      e.gulnishHandled = true;
      var cart = loadCart();
      var key = btn.getAttribute("data-key");
      if (btn.classList.contains("cp-item__remove")) {
        cart = cart.filter(function (item) { return item.key !== key; });
      } else {
        cart = cart.map(function (item) {
          if (item.key !== key) return item;
          var q = btn.getAttribute("data-action") === "plus" ? item.qty + 1 : item.qty - 1;
          return Object.assign({}, item, { qty: q });
        });
        cart = cart.filter(function (item) { return item.qty > 0; });
      }
      broadcastAndRender(cart);
    });
  }

  var checkoutBtn = document.getElementById("cpCheckout");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", function () {
      if (!totalQty(loadCart())) {
        var toast = document.querySelector(".toast, #toast");
        if (toast) toast.classList.add("show");
        return;
      }
      window.location.href = "/checkout";
    });
  }

  /* First paint waits for the catalogue snapshot. Rendering immediately would
     paint the fallback WhatsApp number and delivery copy, and nothing repaints
     the cart once boot() resolves — the basket would stay on the defaults for
     the whole visit. */
  if (GC && typeof GC.init === "function") {
    var started = false;
    var paint = function () {
      if (started) return;
      started = true;
      render();
    };
    GC.init().then(paint, paint);
    /* If the snapshot never settles (blocked network), paint the local copy
       rather than leaving an empty cart page. */
    setTimeout(paint, 1500);
  } else {
    render();
  }
})();