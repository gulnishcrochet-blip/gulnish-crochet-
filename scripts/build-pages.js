const fs = require("fs");

function buildCart() {
  let h = fs.readFileSync("cart.html", "utf8");
  h = h.replace(/<title>.*?<\/title>/, "<title>Your Cart | Gulnish Crochet</title>");
  h = h.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Review your Gulnish Crochet cart, adjust quantities and proceed to checkout.">');
  h = h.replace(/<meta name="keywords" content="[^"]*">/, "  ");
  const start = h.indexOf("<main>");
  const end = h.indexOf("</main>") + "</main>".length;
  const main =
    "<main>\n" +
    '    <section class="section" id="cartPage">\n' +
    '      <div class="container">\n' +
    '        <nav class="breadcrumbs reveal" aria-label="Breadcrumb">\n' +
    "          <ol>\n" +
    '            <li><a href="index.html">Home</a></li>\n' +
    '            <li class="is-current" aria-current="page">Cart</li>\n' +
    "          </ol>\n" +
    "        </nav>\n\n" +
    '        <div class="section-head reveal">\n' +
    '          <span class="section-eyebrow">Shopping bag</span>\n' +
    '          <h1 class="section-title">Your <em>Cart</em></h1>\n' +
    "        </div>\n\n" +
    '        <div id="cpEmpty" class="cart-page-empty reveal" hidden>\n' +
    '          <div class="cart-empty__ph">&#128722;</div>\n' +
    "          <p>Your cart is empty.</p>\n" +
    '          <div class="cart-page-empty__actions">\n' +
    '            <a class="btn" href="products.html">Browse products</a>\n' +
    "          </div>\n" +
    "        </div>\n\n" +
    '        <div class="cart-page" id="cpWrap">\n' +
    '          <div class="cart-page__main">\n' +
    '            <p class="cart-page__total-label" id="cpCountLabel"></p>\n' +
    '            <div id="cpItems" class="cp-items"></div>\n' +
    '            <a class="btn btn--ghost cart-page__continue" href="products.html">&larr; Continue shopping</a>\n' +
    "          </div>\n\n" +
    '          <aside class="cart-page__aside">\n' +
    '            <div class="checkout-card cart-summary">\n' +
    "              <h3>Order summary</h3>\n" +
    '              <div class="co-total">\n' +
    '                <span>Subtotal</span>\n' +
    '                <span id="cpSubtotal">Rs. 0.00</span>\n' +
    "              </div>\n" +
    '              <div class="co-shipping" id="cpShipping"></div>\n' +
    '              <div class="cart-delivery-progress" id="cpProgress" hidden>\n' +
    '                <div class="cart-delivery-bar"><div class="cart-delivery-fill" id="cpProgressFill"></div></div>\n' +
    '                <p class="cart-delivery-msg" id="cpProgressMsg"></p>\n' +
    "              </div>\n" +
    '              <button class="btn co-place" type="button" id="cpCheckout">Proceed to Checkout &rarr;</button>\n' +
    '              <a class="btn btn--ghost cart-page__wa" id="cpWa" href="#" target="_blank" rel="noopener">Order on WhatsApp</a>\n' +
    '              <p class="cart-note co-trust">Pay in advance &mdash; we confirm payment and delivery details on WhatsApp before we start stitching.</p>\n' +
    "            </div>\n" +
    "          </aside>\n" +
    "        </div>\n\n" +
    "      </div>\n" +
    "    </section>\n" +
    "  </main>";
  h = h.slice(0, start) + main + h.slice(end);
  h = h.replace('<script src="js/script.js"></script>', '<script src="js/script.js"></script>\n  <script src="js/cart.js"></script>');
  fs.writeFileSync("cart.html", h);
  console.log("cart.html ready");
}

function buildTrack() {
  let h = fs.readFileSync("track.html", "utf8");
  h = h.replace(/<title>.*?<\/title>/, "<title>Track Your Order | Gulnish Crochet</title>");
  h = h.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Track your Gulnish Crochet order by order number or phone number.">');
  h = h.replace(/<meta name="keywords" content="[^"]*">/, "  ");
  h = h.replace(/products\.html/g, "track.html");
  const start = h.indexOf("<main>");
  const end = h.indexOf("</main>") + "</main>".length;
  const main =
    "<main>\n" +
    '    <section class="section" id="trackPage">\n' +
    '      <div class="container">\n' +
    '        <nav class="breadcrumbs reveal" aria-label="Breadcrumb">\n' +
    "          <ol>\n" +
    '            <li><a href="index.html">Home</a></li>\n' +
    '            <li class="is-current" aria-current="page">Track Order</li>\n' +
    "          </ol>\n" +
    "        </nav>\n\n" +
    '        <div class="section-head reveal">\n' +
    '          <span class="section-eyebrow">Stay updated</span>\n' +
    '          <h1 class="section-title">Track your <em>order</em></h1>\n' +
    '          <p class="section-lead">Enter your order number or phone number to see its current status.</p>\n' +
    "        </div>\n\n" +
    '        <div class="track-search reveal">\n' +
    '          <input type="text" id="trackInput" placeholder="e.g. GC-20260911-XXXX or 0300 0000000" autocomplete="off">\n' +
    '          <button class="btn" type="button" id="trackBtn">Track</button>\n' +
    "        </div>\n\n" +
    '        <div id="trackMsg" class="track-msg" hidden></div>\n' +
    '        <div id="trackResults" class="track-results"></div>\n\n' +
    "      </div>\n" +
    "    </section>\n" +
    "  </main>";
  h = h.slice(0, start) + main + h.slice(end);
  h = h.replace('<script src="js/script.js"></script>', '<script src="js/script.js"></script>\n  <script src="js/track.js"></script>');
  fs.writeFileSync("track.html", h);
  console.log("track.html ready");
}

buildCart();
buildTrack();