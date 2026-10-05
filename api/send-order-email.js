/* =========================================================
   Gulnish Crochet — order confirmation email (Vercel function)

   Sends an "Order received" receipt to the customer's email via
   Resend (https://resend.com). Works for static/Edge deployments
   with NO extra framework: dropping files in /api makes Vercel
   treat them as Node serverless functions.

   Env vars (add in Vercel dashboard):
     RESEND_API_KEY  — required to actually send
     EMAIL_FROM      — verified sender, e.g. "Gulnish Crochet <orders@gulnishcrochet.com>"
     EMAIL_NOTIFY_TO — (optional) store address that gets CC'd on every receipt
     ALLOWED_ORIGINS — (optional) comma-separated extra hostnames allowed to
                       call this. Empty means "the host serving the request",
                       which already covers the live domain and previews.

   Abuse protection: because the recipient address comes from the caller and
   the send uses the store's own Resend key, this endpoint would otherwise be
   an open relay. It therefore only answers same-origin browser requests, rate
   limits each caller, and whitelists every field that reaches the email.

   If RESEND_API_KEY is missing the endpoint returns ok:false,
   disabled:true, so the storefront keeps working untouched.
   ========================================================= */

const RESEND = "https://api.resend.com/emails";

/* This function sends email to an address supplied by whoever calls it, using
   the store's own Resend key. Without the guards below that is an open relay:
   any third party could POST here and spend the store's email quota (or get
   the sending domain suspended). Three layers, cheapest first:

     1. ALLOWED_ORIGINS - a browser cannot forge Origin, so a same-origin
        check stops another website from driving the endpoint via fetch/XHR.
     2. Rate limit - bounds abuse from direct non-browser callers, which can
        set any header they like.
     3. Strict payload validation - caps the size of what a caller can make
        us send, so a single request cannot generate a huge email.

   Set ALLOWED_ORIGINS in Vercel (comma separated) if you serve the storefront
   from more than one hostname. Left empty, the request's own Host is used,
   which already covers the production domain and Vercel preview URLs. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (s) { return s.trim().replace(/\/$/, ""); })
  .filter(Boolean);

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;
const MAX_ITEMS = 50;
const rate = new Map();

function clientIp(req) {
  return String(
    (req.headers["x-forwarded-for"] || "").split(",")[0] ||
    req.socket && req.socket.remoteAddress ||
    "unknown"
  ).trim();
}

function originAllowed(req) {
  const seen = [];
  if (req.headers["origin"]) seen.push(String(req.headers["origin"]));
  if (req.headers["referer"]) {
    try { seen.push(new URL(String(req.headers["referer"])).origin); } catch (e) { /* ignore */ }
  }
  /* No Origin and no Referer means a non-browser client, which we cannot
     attribute to the site - allow it through and let the rate limit apply. */
  if (!seen.length) return true;

  const hosts = [String(req.headers["host"] || "")];
  ALLOWED_ORIGINS.forEach(function (o) {
    try { hosts.push(new URL(o).host); } catch (e) { /* ignore */ }
  });

  return seen.some(function (c) {
    try { return hosts.indexOf(new URL(c).host) > -1; } catch (e) { return false; }
  });
}

function tooManyRequests(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = rate.get(ip);

  if (rate.size > 5000) {
    rate.forEach(function (v, k) { if (now - v.start > RATE_WINDOW_MS) rate.delete(k); });
  }

  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    rate.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > RATE_MAX;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(v) {
  const n = parseFloat(v) || 0;
  return "Rs. " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function str(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Whitelists and coerces every field that reaches the email, so a caller
   cannot inject markup or unbounded text into the HTML part. */
function cleanOrder(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return null;

  const id = str(order.id, 64);
  if (!id) return null;
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > MAX_ITEMS) return null;

  const items = [];
  for (let i = 0; i < order.items.length; i++) {
    const it = order.items[i];
    if (!it || typeof it !== "object") continue;
    const name = str(it.name, 120);
    if (!name) continue;
    const qty = Math.min(Math.max(Math.floor(num(it.qty) || 1), 1), 99);
    const price = Math.round(num(it.price) * 100) / 100;
    /* priceMax is the top of a published price range. It only counts when it
       sits above the price the order was totalled on, so a blank or stale
       value cannot turn into a back-to-front range in the email. */
    const rawMax = Math.round(num(it.priceMax) * 100) / 100;
    items.push({
      name: name,
      color: str(it.color, 40),
      qty: qty,
      price: price,
      priceMax: rawMax > price ? rawMax : 0
    });
  }
  if (!items.length) return null;

  const customer = order.customer && typeof order.customer === "object" ? order.customer : {};
  const payment = order.payment && typeof order.payment === "object" ? order.payment : {};

  return {
    id: id,
    items: items,
    total: Math.round(num(order.total) * 100) / 100,
    /* The flat keychain delivery charge, and the total including it. Absent on
       orders placed before the charge existed. */
    deliveryCharge: Math.round(num(order.deliveryCharge) * 100) / 100,
    grandTotal: order.grandTotal == null
      ? null
      : Math.round(num(order.grandTotal) * 100) / 100,
    customer: { name: str(customer.name, 80), email: str(customer.email, 120) },
    payment: { method: str(payment.method, 40) || "Bank transfer" },
    estDelivery: order.estDelivery
  };
}

/* Strips angle brackets and control characters from a value used in the
   text/plain body. Conformant clients never render text/plain as HTML, but
   stripping them means a sloppy client still cannot execute anything. */
function plain(v) {
  return String(v == null ? "" : v)
    .replace(/[<>]/g, "")
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emailBody(order) {
  const c = order.customer || {};
  const items = order.items || [];
  const total = money(order.total || 0);
  /* Line price as a range when the item has one: the total below is a floor,
     and saying so is the difference between an estimate and a bill. */
  const linePrice = function (i) {
    const base = (i.price || 0) * i.qty;
    return i.priceMax > 0
      ? money(base) + " - " + money(i.priceMax * i.qty)
      : money(base);
  };
  const anyRange = items.some(function (i) { return i.priceMax > 0; });

  const lines = [
    "Hi " + (plain(c.name) || "there") + ",",
    "",
    "Thank you for your order with Gulnish Crochet. We've received it and will send our payment details and confirm delivery with you on WhatsApp shortly.",
    "",
    "Order number: " + plain(order.id),
    "",
    "Items:"
  ];

  items.forEach(function (i) {
    lines.push("- " + plain(i.name || "Item") +
      (i.color ? " (" + plain(i.color) + ")" : "") +
      " x " + i.qty + " = " + linePrice(i));
  });

  lines.push("");
  lines.push((anyRange ? "Items total (from): " : "Items total: ") + total);
  /* The flat keychain delivery charge is a real, known cost rather than a
     quote, so it is itemised separately and the grand total repeated. */
  const delivery = order.deliveryCharge || 0;
  const grand = order.grandTotal != null ? order.grandTotal : order.total + delivery;
  if (delivery) {
    lines.push("Keychain delivery: " + money(delivery));
    lines.push((anyRange ? "Total to pay (from): " : "Total to pay: ") + money(grand));
  } else {
    lines.push((anyRange ? "Total (from): " : "Total: ") + money(grand));
  }
  if (anyRange) {
    lines.push("Some items are quoted as a price range. We will confirm the final price for each on WhatsApp.");
  }
  lines.push("Payment: " + (plain(order.payment && order.payment.method) || "Bank transfer"));
  if (order.estDelivery) {
    try {
      lines.push("Estimated delivery: " + new Date(order.estDelivery).toDateString());
    } catch (e) { /* ignore */ }
  }
  lines.push("");
  lines.push("For updates on your order, message us on WhatsApp at +92 307 5729901.");
  lines.push("");
  lines.push("Questions? WhatsApp us at +92 307 5729901.");

  const rowHtml = "  <h2>Order " + escapeHtml(order.id) + "</h2>\n" +
    "  <table width=\"100%\" cellpadding=\"6\" cellspacing=\"0\" style=\"border-collapse:collapse\">\n" +
    items.map(function (i) {
      return "    <tr><td>" + escapeHtml(i.name) +
        (i.color ? " <em>(" + escapeHtml(i.color) + ")</em>" : "") +
        "</td><td align=\"right\">x " + i.qty + " &middot; " + linePrice(i) + "</td></tr>";
    }).join("\n") +
    "\n  </table>\n" +
    "  <p><strong>" + (anyRange ? "Total (from): " : "Total: ") + money(order.total || 0) + "</strong>" +
    (anyRange
      ? "<br>Some items are quoted as a price range. We will confirm the final price for each on WhatsApp."
      : "") +
    "<br>Payment: " + escapeHtml((order.payment && order.payment.method) || "Bank transfer") + "</p>\n" +
    "  <p style=\"color:#68706b;font-size:13px\">For updates on your order, message us on WhatsApp at +92 307 5729901.</p>";

  return {
    /* The order id reaches an email header, so angle brackets and control
       characters are stripped rather than HTML-escaped. */
    subject: "Order received " + plain(order.id) + " — Gulnish Crochet",
    text: lines.join("\n"),
    html:
      '<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#1b211d">' +
      '<h1 style="color:#a87e2c">Gulnish Crochet</h1>' +
      '<p>Hi ' + escapeHtml(c.name || "there") + ',</p>' +
      '<p>Thank you for your order! We\'ve received it and will send our payment details and confirm delivery with you on WhatsApp shortly.</p>' +
      rowHtml +
      '</div>'
  };
}

async function sendViaResend(from, to, cc, subject, text, html) {
  const payload = {
    from: from,
    to: [to],
    subject: subject,
    text: text,
    html: html
  };
  if (cc) payload.cc = [cc];
  const res = await fetch(RESEND, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    return { ok: false, status: res.status, error: body && body.message ? body.message : "Resend error" };
  }
  return { ok: true, id: body && body.id };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "send-order-email" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: "Origin not allowed" });
  }

  if (tooManyRequests(req)) {
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({ ok: false, error: "Invalid payload" });
  }

  const to = typeof payload.to === "string" ? payload.to.trim() : "";
  const order = cleanOrder(payload.order);
  if (!to || !order) {
    return res.status(400).json({ ok: false, error: "Missing or invalid to/order" });
  }
  if (to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ ok: false, error: "Invalid email address" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ ok: false, disabled: true, error: "Email sending not configured" });
  }

  const from = process.env.EMAIL_FROM || "Gulnish Crochet <onboarding@resend.dev>";
  const cc = process.env.EMAIL_NOTIFY_TO || "";
  const body = emailBody(order);

  const result = await sendViaResend(from, to, cc, body.subject, body.text, body.html);

  if (!result.ok) {
    return res.status(result.status === 200 ? 500 : result.status).json(result);
  }
  return res.status(200).json({ ok: true, id: result.id });
};