/* =========================================================
   Gulnish Crochet — Analytics loader (GTM, GA4, Meta Pixel)

   Put your IDs in js/config.js under window.GC_ANALYTICS and
   they load here automatically. Leave empty to stay untagged.

   Three slots, three different things:
     gtm  - a Tag Manager container (GTM-XXXXXXX). Fires whatever tags you
            configure in its own UI, so events are published to dataLayer.
     ga4  - a GA4 measurement ID (G-XXXXXXX). Talks to GA4 directly, no
            container involved. Setting a GTM ID here does nothing useful.
     meta - the Meta Pixel.
   ========================================================= */
(function () {
  "use strict";
  var cfg = (window.GC_ANALYTICS) || {};

  /* Opening the site straight from disk (file:///.../index.html) is a local
     preview. Reporting those hits would mix development traffic into the real
     GA4 / Meta numbers and skew them, so never tag a local file. */
  if (location.protocol === "file:") return;

  /* Google Tag Manager. Loaded verbatim from Google's snippet so behaviour
     matches what their docs describe: it creates dataLayer itself and pushes
     gtm.start/gtm.js before fetching the container. It has to run before the
     GA4 block below, because both write to the same dataLayer array. */
  if (cfg.gtm && !window.__gtmLoaded) {
    window.__gtmLoaded = true;
    window.dataLayer = window.dataLayer || [];
    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
      var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s),
        dl = l != "dataLayer" ? "&l=" + l : "";
      j.async = true;
      j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, "script", "dataLayer", cfg.gtm);
  }

  if (cfg.ga4 && !window.gtag) {
    var g = document.createElement("script");
    g.async = true;
    g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(cfg.ga4);
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", cfg.ga4);
  }

  if (cfg.meta && !window.fbq) {
    var f = document.createElement("script");
    f.async = true;
    f.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(f);

    /* This must mirror Meta's own stub character for character: same queue
       property, same version and loaded flags. When a stub looks half-built
       Meta's library reports "Multiple pixels with conflicting versions", and
       it replays only `.queue` when the real library lands - so events queued
       through an invented `.q` in the first second after load would sit in an
       array nobody reads and quietly never reach Meta. */
    window.fbq = window.fbq || function () {
      fbq.callMethod
        ? fbq.callMethod.apply(fbq, arguments)
        : fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = window.fbq;
    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = "2.0";
    window.fbq.queue = [];
    fbq("init", cfg.meta);
    fbq("track", "PageView");

    var n = document.createElement("noscript");
    var img = document.createElement("img");
    img.height = 1;
    img.width = 1;
    img.style.display = "none";
    img.src = "https://www.facebook.com/tr?id=" + encodeURIComponent(cfg.meta) + "&ev=PageView&noscript=1";
    n.appendChild(img);
    document.body.appendChild(n);
  }

  /* Reports one shopper action to both platforms. Written as a standalone
     function because this file loads before supabase.js defines GC, and the
     other pages call it through GC.track().

     Events fired before either remote script has arrived are not lost: the
     gtag and fbq stubs above buffer their arguments, so an action taken in the
     first second is still reported once the network script lands.

     GA4 gets its standard ecommerce event names, which is what its reporting
     and any Google Ads bidding are built around. Meta gets its own standard
     names where one exists, because "ViewContent" and "AddToCart" are what the
     Meta algorithm optimises towards; a custom name would report correctly but
     would not feed anything it can act on.

     whatsapp_order is the important one here. Advance payment means most
     orders never complete inside the site, so a report built purely from
     purchase events would show almost nothing happening on a shop that is in
     fact doing steady trade. This counts the moment a customer actually starts
     an order in the chat, which is the action that matters. */
  var META_NAMES = {
    view_item: "ViewContent",
    add_to_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    purchase: "Purchase",
    search: "Search",
    whatsapp_order: "Contact"
  };

  window.gcTrack = function (name, params) {
    var p = params || {};
    var k;

    /* Direct GA4, when a measurement ID is configured. */
    if (window.gtag) window.gtag("event", name, p);

    /* Tag Manager reads dataLayer looking for plain objects carrying an
       `event` key - that is what makes a GTM trigger fire. Pushing the gtag
       Arguments object instead would arrive as an opaque array-like with no
       `event` property and the container would ignore it, which is the easy
       mistake to make here. Numbers and strings stay as they are so a GTM
       variable can read them.

       GA4's ecommerce tags in GTM look for their figures inside `ecommerce`,
       not at the top level, so anything carrying items gets mirrored in there
       as well as kept on the payload. */
    if (window.dataLayer) {
      var payload = {};
      for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) payload[k] = p[k];
      payload.event = name;
      if (p.items && p.items.length) {
        var ecommerce = {};
        for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) ecommerce[k] = p[k];
        payload.ecommerce = ecommerce;
      }
      window.dataLayer.push(payload);
    }

    /* Meta takes its own event names - see META_NAMES above - because that is
       what its algorithm optimises towards. */
    if (window.fbq) window.fbq("trackCustom", META_NAMES[name] || name, p);
  };
})();