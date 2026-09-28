const fs = require("fs");
let h = fs.readFileSync("cart.html", "utf8");
// fix first occurrences: header logo, canonical, og:url
h = h.replace('href="products.html"', 'href="cart.html"');
h = h.replace('canonical" href="products.html"', 'canonical" href="cart.html"');
h = h.replace('content="https://gulnishcrochet.vercel.app/products.html"', 'content="https://gulnishcrochet.vercel.app/cart.html"');
fs.writeFileSync("cart.html", h);
console.log("cart.html metadata fixed");
