/* =========================================================
   Gulnish Crochet - product page generator
   =========================================================
   Writes one static HTML page per product to product/<slug>.html, which
   Vercel serves at /product/<slug> because cleanUrls is on.

   Why generate pages instead of letting the shop page show them: every
   product used to live at /products and was opened by a button, so no
   product had an address a search engine could store, rank or link to.
   Rendering them as real files also means the title, description,
   canonical, social tags and Product schema are in the delivered HTML
   rather than appearing only after a script runs, and an address that does
   not exist returns a real 404 instead of an empty page.

   Run: node scripts/generate-product-pages.js
   It is called by scripts/auto-deploy.js, so a change to the catalogue in
   js/supabase.js regenerates the pages before the commit is made. Files are
   only written when their content actually changes, so the watcher does not
   loop on its own output.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "product");
const ORIGIN = (() => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)/);
  return m ? m[1] : "https://gulnishcrochet.vercel.app";
})();

/* ---------- helpers that must match the shop's own formatting ---------- */

function money(value) {
  const n = parseFloat(value) || 0;
  const str = String(Math.round(n * 100) / 100);
  const parts = str.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "Rs. " + parts.join(".");
}

function hasRange(p) {
  return !!(p && parseFloat(p.price) > 0 && parseFloat(p.priceMax) > parseFloat(p.price));
}

function priceText(p) {
  if (!(parseFloat(p.price) > 0)) return "Price on request";
  return hasRange(p) ? money(p.price) + " \u2013 " + money(p.priceMax) : money(p.price);
}

function stockStatus(p) {
  const s = String((p && p.status) || "").trim().toLowerCase();
  if (s === "made to order" || s === "made-to-order") return "made to order";
  if (s === "sold out" || s === "sold-out") return "sold out";
  if (p && p.stock != null && parseInt(p.stock, 10) === 0) return "sold out";
  return "in stock";
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/* Image dimensions, so the page does not shift while the photo loads. */
function imageSize(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const tag = buf.toString("ascii", 12, 16);
  if (tag === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  if (tag === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (tag === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/* The shop serves a half-width twin for each photo; use it when it exists so
   a phone never downloads the full-size file for a card-sized image. */
function smallTwin(rel) {
  const i = rel.lastIndexOf("/");
  if (i < 0) return "";
  const dir = rel.slice(0, i);
  const file = rel.slice(i + 1);
  const ext = file.slice(file.lastIndexOf("."));
  const stem = file.slice(0, file.lastIndexOf("."));
  const twin = `${dir}/sm/${stem}${ext}`;
  return fs.existsSync(path.join(ROOT, twin)) ? twin : "";
}

/* ---------- load the catalogue the same way the browser does ---------- */

function loadCatalog() {
  const src = fs.readFileSync(path.join(ROOT, "js", "supabase.js"), "utf8");
  const store = {};
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { href: `${ORIGIN}/`, search: "", pathname: "/" },
    navigator: { userAgent: "node" },
    fetch: () => Promise.reject(new Error("offline")),
    addEventListener() {},
    removeEventListener() {},
    document: { addEventListener() {}, documentElement: {}, readyState: "complete" },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 10000 });
  return sandbox.window.GC;
}

/* ---------- text ---------- */

/* Every sentence below is built from data the shop already holds: the name,
   the collection it sits in, the price, the availability, and the two facts
   stated on the contact page. No material, size or care detail is guessed. */
function describe(p, catLabel, subLabel) {
  const bits = [];
  const where = subLabel || catLabel;
  bits.push(
    `${p.name} is handmade crochet, worked by Gulnish Crochet in Wazirabad and filed under our ${where.toLowerCase()} collection.`
  );
  bits.push(`Priced at ${priceText(p)}.`);
  const status = stockStatus(p);
  if (status === "sold out") {
    bits.push("This piece is sold out, but the same design is usually available to commission again \u2014 message us and we will confirm.");
  } else if (status === "made to order") {
    bits.push("Made to order, so allow about five days before it is ready to post.");
  } else {
    bits.push("In stock and ready to post.");
  }
  bits.push("Delivery is available across Pakistan, and colours and small details can be changed \u2014 message us on WhatsApp to talk it through.");
  return bits.join(" ");
}

/* Google truncates around 60 characters of title and 155 of description, so
   the name leads and the suffix is the longest one that still fits. */
function buildTitle(p, catLabel) {
  const name = p.name;
  const suffixes = [` | ${catLabel} | Gulnish Crochet`, ` | ${catLabel}`, " | Handmade Crochet", " | Pakistan", ""];
  for (const s of suffixes) {
    const t = name + s;
    if (t.length <= 60) return t;
  }
  return name.slice(0, 60);
}

function buildDescription(p, catLabel) {
  const base = describe(p, catLabel, "");
  if (base.length <= 155) return base;
  /* Trim at a sentence boundary so the description never ends mid-clause. */
  const parts = base.split(". ");
  let out = "";
  for (const part of parts) {
    const next = out ? out + ". " + part : part;
    if (next.length > 155 && out) break;
    out = next;
  }
  return (out || base).replace(/\s+/g, " ").trim();
}

/* ---------- page ---------- */

function jsonLd(p, catLabel, subLabel, canonical, description, canonicalIsSelf) {
  const slug = GC.productSlug(p);
  const url = `${ORIGIN}/product/${slug}`;
  const product = {
    "@type": "Product",
    "@id": url + "#product",
    url,
    name: p.name,
    description,
    image: [`${ORIGIN}/${p.image}`],
    productID: p.id,
    category: subLabel ? `${catLabel} > ${subLabel}` : catLabel,
    brand: { "@type": "Brand", name: "Gulnish Crochet" },
    manufacturer: { "@id": `${ORIGIN}/#org` },
    offers: {
      "@type": hasRange(p) ? "AggregateOffer" : "Offer",
      url,
      priceCurrency: "PKR",
      lowPrice: (parseFloat(p.price) || 0).toFixed(2),
      ...(hasRange(p) ? { highPrice: (parseFloat(p.priceMax) || 0).toFixed(2) } : { price: (parseFloat(p.price) || 0).toFixed(2) }),
      offerCount: hasRange(p) ? 2 : undefined,
      availability: stockStatus(p) === "sold out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": `${ORIGIN}/#org` },
      areaServed: { "@type": "Country", name: "Pakistan" },
    },
  };
  if (!canonicalIsSelf) {
    product.isRelatedTo = { "@id": canonical + "#product" };
  }
  const crumbs = [
    { name: "Home", url: `${ORIGIN}/` },
    { name: "Products", url: `${ORIGIN}/products` },
  ];
  if (subLabel) {
    crumbs.push({ name: catLabel, url: `${ORIGIN}/products?cat=${p.category}` });
    crumbs.push({ name: subLabel, url: `${ORIGIN}/products?cat=${p.category}&sub=${p.subcategory}` });
  } else if (catLabel) {
    crumbs.push({ name: catLabel, url: `${ORIGIN}/products?cat=${p.category}` });
  }
  crumbs.push({ name: p.name, url });

  return {
    "@context": "https://schema.org",
    "@graph": [
      product,
      {
        "@type": "BreadcrumbList",
        "@id": url + "#breadcrumb",
        itemListElement: crumbs.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: c.url,
        })),
      },
    ],
  };
}

function renderPage(p, catLabel, subLabel, shell) {
  const slug = GC.productSlug(p);
  const canonicalSlug = GC.canonicalProductSlug(p);
  const canonical = `${ORIGIN}/product/${canonicalSlug}`;
  const canonicalIsSelf = canonicalSlug === slug;
  const url = canonicalIsSelf ? canonical : `${ORIGIN}/product/${slug}`;
  const description = buildDescription(p, catLabel);
  const title = canonicalIsSelf ? buildTitle(p, catLabel) : `${p.name} | Gulnish Crochet`;
  const status = stockStatus(p);
  const size = imageSize(p.image) || { w: 800, h: 800 };
  const twin = smallTwin(p.image);
  const imgTag =
    `<img class="product-page__img" src="${escapeAttr(p.image)}" ` +
    (twin ? `srcset="${escapeAttr(twin)} 480w, ${escapeAttr(p.image)} ${size.w}w" ` : "") +
    `sizes="(max-width: 760px) 92vw, 520px" width="${size.w}" height="${size.h}" ` +
    `alt="${escapeAttr(p.name)}" decoding="async" fetchpriority="high">`;

  const related = (GC.products || [])
    .filter((o) => o.id !== p.id && o.category === p.category && parseFloat(o.price) > 0 && o.image)
    .slice(0, 6)
    .map((o) => {
      const oSlug = GC.canonicalProductSlug(o);
      return (
        `<li class="product-page__related-item"><a class="product-page__related-link" href="/product/${escapeAttr(oSlug)}">` +
        `<img src="${escapeAttr(o.image)}" width="200" height="200" loading="lazy" decoding="async" alt="${escapeAttr(o.name)}">` +
        `<span class="product-page__related-name">${escapeHtml(o.name)}</span>` +
        `<span class="product-page__related-price">${escapeHtml(priceText(o))}</span>` +
        `</a></li>`
      );
    })
    .join("");

  const catUrl = `/products?cat=${p.category}`;
  const subUrl = p.subcategory ? `${catUrl}&sub=${p.subcategory}` : "";
  const waText = encodeURIComponent(
    `Hello Gulnish Crochet, I would like to order "${p.name}" (${priceText(p)}). Here is the page: ${url}`
  );

  const breadcrumbHtml =
    `<nav class="product-page__crumbs" aria-label="Breadcrumb">` +
    `<a href="/">Home</a> <span aria-hidden="true">/</span> ` +
    `<a href="/products">Products</a>` +
    (subLabel
      ? ` <span aria-hidden="true">/</span> <a href="${escapeAttr(catUrl)}">${escapeHtml(catLabel)}</a>` +
        ` <span aria-hidden="true">/</span> <a href="${escapeAttr(subUrl)}">${escapeHtml(subLabel)}</a>`
      : catLabel
        ? ` <span aria-hidden="true">/</span> <a href="${escapeAttr(catUrl)}">${escapeHtml(catLabel)}</a>`
        : "") +
    ` <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(p.name)}</span>` +
    `</nav>`;

  const buyRow =
    `<div class="product-page__buy">` +
    (status === "sold out"
      ? `<button class="add-btn add-btn--sold is-disabled" disabled aria-disabled="true">Sold Out</button>`
      : `<button class="add-btn" data-id="${escapeAttr(p.id)}" data-name="${escapeAttr(p.name)}" ` +
        `data-price="${parseFloat(p.price) || 0}" data-image="${escapeAttr(p.image)}">` +
        `Add to cart</button>`) +
    `<a class="btn btn--wa" href="https://wa.me/923075729901?text=${waText}" target="_blank" rel="noopener">Order on WhatsApp</a>` +
    `</div>`;

  const notCanonical =
    canonicalIsSelf
      ? ""
      : `<p class="muted">This piece is listed under <a href="/product/${escapeAttr(canonicalSlug)}">${escapeHtml(
          (GC.products || []).find((o) => GC.productSlug(o) === canonicalSlug) || p
        ).name}</a>, which is the page to bookmark and share.</p>`;

  const body =
    `${breadcrumbHtml}
    <div class="product-page__grid">
      <div class="product-page__media">${imgTag}</div>
      <div class="product-page__info">
        <h1 class="product-page__name">${escapeHtml(p.name)}</h1>
        <p class="product-page__price">${escapeHtml(priceText(p))}</p>
        <p class="product-page__status">${status === "in stock" ? "In stock" : status === "made to order" ? "Made to order" : "Sold out"}</p>
        <dl class="product-page__specs">
          <div><dt>Collection</dt><dd><a href="${escapeAttr(subUrl || catUrl)}">${escapeHtml(subLabel || catLabel)}</a></dd></div>
          <div><dt>Category</dt><dd><a href="${escapeAttr(catUrl)}">${escapeHtml(catLabel)}</a></dd></div>
          <div><dt>Price</dt><dd>${escapeHtml(priceText(p))}</dd></div>
          <div><dt>Availability</dt><dd>${status === "in stock" ? "In stock" : status === "made to order" ? "Made to order" : "Sold out"}</dd></div>
          <div><dt>Made in</dt><dd>Wazirabad, Pakistan</dd></div>
        </dl>
        ${buyRow}
        <p class="product-page__desc">${escapeHtml(describe(p, catLabel, subLabel))}</p>
        ${notCanonical}
      </div>
    </div>
    ${
      related
        ? `<section class="product-page__related">
      <h2 class="product-page__related-title">More handmade crochet ${escapeHtml((subLabel || catLabel).toLowerCase())}</h2>
      <ul class="product-page__related-list">${related}</ul>
    </section>`
        : ""
    }`;

  /* ---- head: every value that identifies the product is written here ---- */
  let head = shell.head;
  const set = (re, value) => {
    head = head.replace(re, value);
  };

  set(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(description)}">`);
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(url)}">`);
  set(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="product">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`);
  set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(url)}">`);
  set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(ORIGIN + "/" + p.image)}">`);
  set(
    /<meta property="og:image:alt" content="[^"]*">/,
    `<meta property="og:image:alt" content="${escapeAttr(p.name)}">`
  );
  set(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`);
  set(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`
  );
  set(
    /<meta name="twitter:image" content="[^"]*">/,
    `<meta name="twitter:image" content="${escapeAttr(ORIGIN + "/" + p.image)}">`
  );
  set(
    /<meta name="twitter:image:alt" content="[^"]*">/,
    `<meta name="twitter:image:alt" content="${escapeAttr(p.name)}">`
  );

  const ld = jsonLd(p, catLabel, subLabel, canonical, description, canonicalIsSelf);

  let page = head.replace(/<main>[\s\S]*?<\/main>/, `<main>
    <section class="section">
      <div class="container product-page">
${body}
      </div>
    </section>
  </main>`);

  /* The shell carries the shop's own breadcrumb block for /products; a product
     page states its own trail, so that block is replaced, not duplicated. */
  page = page.replace(
    /<script type="application\/ld\+json" id="seoBreadcrumbLd">[\s\S]*?<\/script>/,
    `<script type="application/ld+json" id="productLd">${JSON.stringify(ld, null, 2)}</script>`
  );
  page = page.replace(/<\/main>\s*/, "</main>\n");
  page = page.replace(shell.tail, shell.tail);
  return { page, title, description, canonical: url, canonicalIsSelf, slug };
}

/* The shell is products.html with its own <main> removed, so a product page
   gets the same header, footer, styles and scripts as every other page. */
function loadShell() {
  const src = fs.readFileSync(path.join(ROOT, "products.html"), "utf8");
  const mainStart = src.indexOf("<main>");
  const mainEnd = src.indexOf("</main>") + "</main>".length;
  return {
    head: src.slice(0, mainStart),
    tail: src.slice(mainEnd),
  };
}

/* ---------- run ---------- */

const GC = loadCatalog();

function main() {
  /* The catalogue is populated by boot(), which resolves off the event loop
     (localStorage seed, or Supabase when it is configured), so the pages have
     to wait for it rather than reading an empty array. */
  return GC.init().then(build);
}

function build() {
  const products = (GC.products || []).slice();
  if (!products.length) {
    console.error("[product-pages] catalogue is empty - nothing generated");
    process.exitCode = 1;
    return;
  }

  const shell = loadShell();
  const cats = (GC.settings || {}).categories || [];
  const written = [];
  const seenNames = new Set();

  for (const p of products) {
    /* A page needs a photo and a price to say anything of value. */
    if (!p.image || !(parseFloat(p.price) > 0)) continue;
    const nameKey = String(p.name || "").trim().toLowerCase();
    if (seenNames.has(nameKey)) continue; /* two photos of one design: one page */
    seenNames.add(nameKey);

    const catIdx = parseInt(String(p.category || "").replace("gr", ""), 10) - 1;
    const catLabel = (catIdx >= 0 && cats[catIdx]) || p.category || "";
    const subLabel = GC.subcategoryLabelOf(p.category, p.subcategory) || "";

    const { page, slug } = renderPage(p, catLabel, subLabel, shell);
    const file = path.join(OUT_DIR, slug + ".html");
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (old !== page) {
      fs.writeFileSync(file, page);
      written.push(slug);
    }
  }

  /* A renamed or deleted product must not leave a page behind for a product
     that no longer exists. */
  const keep = new Set(written);
  let removed = 0;
  if (fs.existsSync(OUT_DIR)) {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (!f.endsWith(".html")) continue;
      if (!keep.has(f.replace(/\.html$/, ""))) {
        fs.unlinkSync(path.join(OUT_DIR, f));
        removed++;
      }
    }
  }

  const total = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".html")).length;
  console.log(
    `[product-pages] ${total} product page(s) in product/ (${written.length} written, ${removed} removed)`
  );
  return written;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[product-pages]", err.message.trim());
    process.exitCode = 1;
  });
}

module.exports = { main, loadCatalog, priceText, buildTitle, buildDescription };