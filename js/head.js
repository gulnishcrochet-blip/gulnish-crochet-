/* Loaded as a blocking script in <head>, before the stylesheets, so the
   "js" class lands on <html> before first paint.

   css/style.css only hides .reveal when html.js is set. That keeps reveal
   content visible when scripting is off or the bundle fails, but means a
   late-running script would flash hidden content. The setTimeout is a safety
   net: js/script.js normally sets window.__gcRevealReady once the observer is
   wired up, and this only forces everything visible if that never happens. */
document.documentElement.classList.add("js");

/* Kick off the TLS/DNS handshakes for the hosts the page will talk to before
   the deferred bundles actually need them: the Supabase REST API, the
   jsdelivr CDN that serves the Supabase SDK, and the analytics endpoints. */
(function resourceHints() {
  var hosts = [
    "https://nmdojjoxqfbaxogehsxc.supabase.co",
    "https://cdn.jsdelivr.net",
    "https://www.googletagmanager.com",
    "https://connect.facebook.net"
  ];
  for (var i = 0; i < hosts.length; i++) {
    var link = document.createElement("link");
    link.rel = "preconnect";
    link.href = hosts[i];
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    var dns = document.createElement("link");
    dns.rel = "dns-prefetch";
    dns.href = hosts[i];
    document.head.appendChild(dns);
  }
})();

document.addEventListener("load", function () {
  setTimeout(function () {
    if (window.__gcRevealReady) return;
    var els = document.querySelectorAll(".reveal");
    for (var i = 0; i < els.length; i++) els[i].classList.add("revealed");
  }, 1500);
});

/* Injected (rather than baked into every page) so a keyboard or screen-reader
   user lands on the same skip link whichever of the 160+ pages they open:
   the link must be the first focusable element, and <main> needs an anchor. */
document.addEventListener("DOMContentLoaded", function () {
  var main = document.querySelector("main");
  if (main && !main.id) main.id = "main";
  if (!document.querySelector(".skip-link")) {
    var a = document.createElement("a");
    a.className = "skip-link";
    a.href = "#main";
    a.textContent = "Skip to content";
    document.body.insertBefore(a, document.body.firstChild);
  }
});
