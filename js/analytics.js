/* =========================================================
   Gulnish Crochet — Analytics loader (GA4 + Meta Pixel)

   Put your IDs in js/config.js under window.GC_ANALYTICS and
   they load here automatically. Leave empty to stay untagged.
   ========================================================= */
(function () {
  "use strict";
  var cfg = (window.GC_ANALYTICS) || {};

  /* Opening the site straight from disk (file:///.../index.html) is a local
     preview. Reporting those hits would mix development traffic into the real
     GA4 / Meta numbers and skew them, so never tag a local file. */
  if (location.protocol === "file:") return;

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

    window.fbq = window.fbq = window.fbq || function () {
      (fbq.q = fbq.q || []).push(arguments);
    };
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
    if (window.gtag) window.gtag("event", name, p);
    if (window.fbq) window.fbq("trackCustom", META_NAMES[name] || name, p);
  };
})();