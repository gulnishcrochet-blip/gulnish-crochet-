(function () {
  "use strict";

  var GC = window.GC;

  var input = document.getElementById("trackInput");
  var btn = document.getElementById("trackBtn");
  var msg = document.getElementById("trackMsg");
  var results = document.getElementById("trackResults");

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

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var day = d.getDate();
    var month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    var year = d.getFullYear();
    var hour = d.getHours();
    var min = String(d.getMinutes()).padStart(2, "0");
    var ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return day + " " + month + " " + year + ", " + hour + ":" + min + " " + ampm;
  }

  var STATUS_ORDER = ["Pending", "Confirmed", "Processing", "Shipped", "Delivered"];
  var STATUS_ICONS = {
    Pending: '&#128221;',
    Confirmed: '&#9989;',
    Processing: '&#128736;',
    Shipped: '&#128666;',
    Delivered: '&#127873;',
    Cancelled: '&#10060;'
  };

  function renderTimeline(history) {
    if (!history || !history.length) return "";
    var seen = {};
    var steps = [];
    history.forEach(function (entry) {
      var s = entry.status || "Pending";
      if (seen[s]) return;
      seen[s] = true;
      steps.push(
        '<li class="track-timeline__item' + (steps.length === history.length - 1 ? " is-current" : "") + '">' +
        '<span class="track-timeline__icon">' + (STATUS_ICONS[s] || '&#128336;') + "</span>" +
        '<span class="track-timeline__label">' + escapeHtml(s) + "</span>" +
        '<time class="track-timeline__time">' + formatDate(entry.at) + "</time>" +
        (entry.note ? '<span class="track-timeline__note">' + escapeHtml(entry.note) + "</span>" : "") +
        "</li>"
      );
    });
    return '<ol class="track-timeline">' + steps.join("") + "</ol>";
  }

  function renderOrder(order) {
    var items = Array.isArray(order.items) ? order.items : [];
    var status = order.status || "Pending";
    var hist = order.statusHistory || [];
    var pay = order.payment || {};
    var method = typeof order.payment === "string" ? order.payment : (pay.method || GC.paymentDefault);
    var pStatus = typeof order.payment === "string" ? "Pending" : (pay.status || "Pending");
    return (
      '<div class="track-card">' +
      '<div class="track-card__head">' +
      '<span class="track-card__id">Order ' + escapeHtml(order.id) + "</span>" +
      '<span class="track-card__status track-card__status--' + status.toLowerCase().replace(/\s+/g, "-") + '">' + escapeHtml(status) + "</span>" +
      "</div>" +
      '<div class="track-card__time">Placed ' + formatDate(order.placedAt) + "</div>" +
      renderTimeline(hist.length ? hist : [{ status: status, at: order.placedAt || order.updatedAt, note: "" }]) +
      '<div class="track-card__items">' +
      items.map(function (item) {
        return (
          '<div class="track-card__item">' +
          '<span class="track-card__item-name">' + escapeHtml(item.name || "Item") +
          (item.qty > 1 ? " &times; " + item.qty : "") + "</span>" +
          '<span class="track-card__item-price">' + money(item.price * item.qty) + "</span>" +
          "</div>"
        );
      }).join("") +
      "</div>" +
      '<div class="track-card__foot">' +
      '<div class="track-card__detail"><span>Total</span><span>' + money(order.total) + "</span></div>" +
      '<div class="track-card__detail"><span>Payment</span><span>' + escapeHtml(method) + " (" + escapeHtml(pStatus) + ")</span></div>" +
      "</div>" +
      "</div>"
    );
  }

  function showMsg(text, isError) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = "track-msg" + (isError ? " track-msg--error" : "");
    msg.hidden = false;
  }

  function hideMsg() { if (msg) msg.hidden = true; }

  async function lookup() {
    if (!input || !btn) return;
    var q = input.value.trim();
    if (!q) {
      showMsg("Please enter an order number or phone number.", true);
      return;
    }
    btn.disabled = true;
    btn.textContent = "Looking\u2026";
    hideMsg();
    results.innerHTML = "";
    try {
      var orders = await GC.lookupOrders(q);
      if (!orders || !orders.length) {
        showMsg("No orders found. Please check your order number or phone number.", true);
        return;
      }
      results.innerHTML = orders.map(renderOrder).join("");
    } catch (e) {
      showMsg("Something went wrong. Please try again.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Track";
    }
  }

  if (btn) btn.addEventListener("click", lookup);
  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") lookup();
    });
  }
})();