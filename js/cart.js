(function () {
  "use strict";

  var STORAGE_KEY = "gulnish-cart";
  var GC = window.GC;

  var wrap = document.getElementById("cpWrap");
  var empty = document.getElementById("cpEmpty");
  var itemsEl = document.getElementById("cpItems");
  var countLabel = document.getElementById("cpCountLabel");
  var subtotalEl = document.getElementById("cpSubtotal");
  var waLink = document.getElementById("cpWa");

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

  /* Delivery charge and date are confirmed on WhatsApp, never quoted here. */

  function waBase() {
    var num = GC && GC.shopWhatsApp ? GC.shopWhatsApp() : "";
    return num ? "https://wa.me/" + encodeURIComponent(num) : "";
  }

  function buildWaHref(cart, subtotal) {
    var base = waBase();
    if (!base || !cart.length) return "#";
    var lines = ["Hi Gulnish Crochet, I'd like to place this order:", ""];
    cart.forEach(function (item) {
      var imageUrl = item.image
        ? (/^https?:\/\//i.test(item.image)
            ? item.image
            : window.location.origin + "/" + String(item.image).replace(/^\/+/, ""))
        : "";
      lines.push(
        "\u2022 " + (item.name || "Item") +
        (imageUrl ? " \u2014 Photo: " + imageUrl : "") +
        (item.qty > 1 ? " x" + item.qty : "") +
        (item.color ? " (" + item.color + ")" : "") +
        " \u2014 " + money(unitPrice(item) * item.qty)
      );
    });
    lines.push("");
    lines.push("Items total: " + money(subtotal));
    var profile = GC && GC.getCustomerProfile ? GC.getCustomerProfile() : null;
    if (profile && (profile.name || profile.phone || profile.city)) {
      lines.push("");
      lines.push("Name: " + (profile.name || "-"));
      if (profile.phone) lines.push("Phone: " + (GC && GC.formatPhone ? GC.formatPhone(profile.phone) : "+" + String(profile.phone).replace(/^0+/, "")));
      if (profile.city) lines.push("City: " + profile.city);
      if (profile.address) lines.push("Address: " + profile.address);
    } else {
      lines.push("");
      lines.push("My delivery name, phone and city:");
    }
    lines.push("");
    lines.push("Please confirm availability, and the delivery charge and date.");
    return base + "?text=" + encodeURIComponent(lines.join("\n"));
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

    if (waLink) waLink.href = buildWaHref(cart, subtotal);
  }

  function broadcastAndRender(cart) {
    saveCart(cart);
    render();
  }

  if (itemsEl) {
    itemsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".cp-qty__btn, .cp-item__remove");
      if (!btn) return;
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

  render();
})();