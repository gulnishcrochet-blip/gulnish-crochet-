/* Kept out of the page markup so the site can ship a Content-Security-Policy
   without needing script-src 'unsafe-inline'. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    /* Root-anchored: a relative "sw.js" resolves against the document, so
       every /product/* and shelf page would request /product/sw.js and 404. */
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
