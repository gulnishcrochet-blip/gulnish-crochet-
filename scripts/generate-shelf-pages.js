/* Writes the shelf landing pages: /purses, /wedding-gifts, /small-gifts,
   /school-items and the eight subcategory shelves under them.

   Until now every category and subcategory lived only inside the filter view
   of /products, which is one document that JavaScript rewrites at runtime. A
   crawler that has not executed the script sees 11 identical pages - same
   title, same description, same canonical - so the shop's best search terms
   ("crochet bouquet Pakistan", "crochet school bag") had no page of their own
   to rank with. These files fix that: real HTML in the site root, one per
   shelf, with its own title, description, canonical, breadcrumb trail,
   ItemList of the pieces on it and FAQ answers.

   The addresses come from GC.SHELF_URLS in js/supabase.js - the same table
   js/script.js and js/theme.js read - so a link, a canonical and a breadcrumb
   always agree. The page body is data the catalogue already holds: how many
   pieces, which names, what prices, and the craft/delivery days from Admin.

   Run: node scripts/generate-shelf-pages.js
*/
const fs = require("fs");
const path = require("path");
const {
  loadCatalog,
  priceText,
  stockStatus,
  imageSize,
  smallTwin,
  escapeHtml,
  escapeAttr,
} = require(path.join(__dirname, "generate-product-pages.js"));

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://gulnishcrochet.vercel.app";
/* Marks every file this script owns, so a shelf that is taken out of
   SHELF_URLS later is deleted instead of being left behind as a page nobody
   maintains. */
const MARKER = "<!-- GENERATED SHELF PAGE: scripts/generate-shelf-pages.js -->";

const GC = loadCatalog();

/* ---------- prices ---------- */

function money(value) {
  const n = parseFloat(value) || 0;
  const str = String(Math.round(n * 100) / 100);
  const parts = str.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "Rs. " + parts.join(".");
}

function priceRangeLabel(items) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of items) {
    const a = parseFloat(p.price) || 0;
    if (!a) continue;
    const b = parseFloat(p.priceMax) || a;
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  if (lo === Infinity) return "";
  return lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`;
}

/* ---------- catalogue slices ---------- */

function catLabelOf(catKey) {
  const cats = (GC.settings || {}).categories || [];
  const i = parseInt(String(catKey || "").replace("gr", ""), 10) - 1;
  return (i >= 0 && cats[i]) || catKey || "";
}

/* The same conditions a product page is generated under - a photo and a
   price - because a card linking to a page that does not exist would be a
   dead end for a crawler. Duplicate names collapse to one card, exactly as
   they collapse to one page. */
function shelfProducts(catKey, subKey) {
  const out = [];
  const seen = new Set();
  for (const p of GC.products || []) {
    if (p.category !== catKey) continue;
    if (subKey && (p.subcategory || "") !== subKey) continue;
    if (!p.image || !(parseFloat(p.price) > 0)) continue;
    const name = String(p.name || "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(p);
  }
  return out;
}

/* Every shelf in the table, in the order the table lists them: a category
   before the shelves under it. Two keys can name the same page - a category
   with a single subcategory of the same name shares one page - so the URL
   decides, not the key. */
function shelfPages() {
  const map = GC.SHELF_URLS || {};
  const pages = [];
  const seen = new Set();
  for (const key of Object.keys(map)) {
    const url = map[key];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const [cat, sub = ""] = key.split("|");
    pages.push({ cat, sub, url });
  }
  return pages;
}

function subShelvesOf(catKey) {
  const map = GC.SHELF_URLS || {};
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(map)) {
    if (!key.startsWith(catKey + "|")) continue;
    const url = map[key];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sub = key.split("|")[1] || "";
    out.push({ sub, url, label: GC.subcategoryLabelOf(catKey, sub) || "" });
  }
  return out;
}

/* ---------- text ---------- */

function joinList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildTitle(page, label) {
  return page.sub
    ? `${label} \u2013 Crochet ${catLabelOf(page.cat)} | Gulnish Crochet`
    : `Handmade Crochet ${label} in Pakistan | Gulnish Crochet`;
}

function buildDescription(page, label, count) {
  return page.sub
    ? `${count} handmade crochet ${label.toLowerCase()} from our ${catLabelOf(page.cat)} collection, stitched to order in Pakistan. Custom colours and delivery confirmed on WhatsApp.`
    : `${count} handmade crochet ${label.toLowerCase()} by Gulnish Crochet, stitched to order in Wazirabad. Custom colours and sizes, delivery confirmed on WhatsApp.`;
}

/* Answers are built from the same settings the homepage FAQ uses, so the
   two can never disagree about how long a piece takes. */
function buildFaqs(label) {
  const s = GC.settings || {};
  const craft = parseInt(s.craftDays, 10) || 5;
  const days = parseInt(s.deliveryDays, 10) || 3;
  return [
    {
      q: "How long will my order take?",
      a: `Each ${label.toLowerCase()} piece is stitched by hand after you order, which takes about ${craft} days. Delivery across Pakistan then takes about ${days} days, so most orders arrive in around ${craft + days} days in total. We send you a confirmed date on WhatsApp before stitching begins.`,
    },
    {
      q: "Can I get it in another colour or size?",
      a: `Yes \u2014 every ${label.toLowerCase()} piece can be made in the colours and size you want. Send us a photo or a description on WhatsApp and we will quote it before you commit.`,
    },
    {
      q: "Do you deliver across Pakistan?",
      a: "Yes \u2014 we deliver to every city in Pakistan. The delivery charge is confirmed on WhatsApp before you pay anything.",
    },
  ];
}

/* ---------- cards ---------- */

/* The card mirrors the markup js/script.js builds for the shop grid, class
   for class, so the same stylesheet and the same delegated cart handler
   work here. Two deliberate differences: the photo carries a real src rather
   than a parked data-src, because a shelf page must show its products to a
   crawler that runs no JavaScript, and the card has no quick-view or
   in-page view hooks, which only exist for /products - here the link simply
   goes to the product page. */
function cardHtml(p) {
  const slug = GC.canonicalProductSlug(p);
  const size = imageSize(p.image) || { w: 800, h: 800 };
  const twin = smallTwin(p.image);
  const src = "/" + String(p.image).replace(/^\/+/, "");
  const srcset = twin
    ? `srcset="/${String(twin).replace(/^\/+/, "")} 480w, ${escapeAttr(src)} ${size.w}w" `
    : "";
  const status = stockStatus(p);
  const soldOut =
    status === "sold out"
      ? `<div class="work-card__soldout"><span>Sold Out</span></div>`
      : "";
  const media =
    `<div class="work-card__media">` +
    `<a class="work-card__link" href="/product/${escapeAttr(slug)}" aria-label="${escapeAttr(p.name)}">` +
    `<img class="work-card__main" src="${escapeAttr(src)}" ${srcset}` +
    `sizes="(max-width: 760px) 44vw, 300px" width="${size.w}" height="${size.h}" ` +
    `alt="${escapeAttr(p.name)}" loading="lazy" decoding="async">` +
    `</a>${soldOut}</div>`;

  const badge =
    status === "made to order"
      ? `<div class="work-card__badge work-card__badge--made">Made to order &middot; ~${
          parseInt((GC.settings || {}).craftDays, 10) || 5
        } days</div>`
      : "";

  const craft = parseInt((GC.settings || {}).craftDays, 10) || 5;
  const addBtn =
    status === "sold out"
      ? `<button class="add-btn add-btn--sold is-disabled" disabled aria-disabled="true" type="button" data-id="${escapeAttr(
          p.id
        )}" data-name="${escapeAttr(p.name)}" data-price="${parseFloat(p.price) || 0}">Sold Out</button>`
      : `<button class="add-btn" type="button" data-id="${escapeAttr(p.id)}" data-name="${escapeAttr(
          p.name
        )}" data-price="${parseFloat(p.price) || 0}" data-image="${escapeAttr(p.image)}">` +
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>` +
        `<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>` +
        `</svg>Add to Cart</button>`;

  const num = GC.shopWhatsApp ? GC.shopWhatsApp() : "";
  const waBtn =
    !num || status === "sold out"
      ? ""
      : (() => {
          const msg =
            `Hi Gulnish Crochet, I'd like to order:\n\n*${p.name}* \u2022 ${priceText(p)}` +
            `\n\nPhoto: ${ORIGIN}/${String(p.image).replace(/^\/+/, "")}` +
            `\n\nIs it available?`;
          return (
            `<a class="btn btn--wa btn--wa-sm work-card__wa js-card-wa" data-id="${escapeAttr(p.id)}" ` +
            `href="https://wa.me/${encodeURIComponent(num)}?text=${encodeURIComponent(msg)}" ` +
            `target="_blank" rel="noopener" aria-label="Order ${escapeAttr(p.name)} on WhatsApp">` +
            `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.5 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.4.7-.4h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.5-.3.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.4.1.6-.1l.9-1c.2-.2.4-.2.6-.1l2 1c.3.1.4.2.5.3 0 .1 0 .6-.2 1.2z"/></svg>` +
            `Buy on WhatsApp</a>`
          );
        })();

  return (
    `<article class="work-card" data-category="${escapeAttr(p.category)}"` +
    (p.subcategory ? ` data-subcategory="${escapeAttr(p.subcategory)}"` : "") +
    `>${media}<div class="work-card__body">` +
    `<h3 class="work-card__name"><a href="/product/${escapeAttr(slug)}">${escapeHtml(p.name)}</a></h3>` +
    `<div class="work-card__price">${escapeHtml(priceText(p))}</div>` +
    `${badge}${addBtn}${waBtn}</div></article>`
  );
}

/* ---------- markup ---------- */

function crumbsHtml(page, label) {
  const catName = catLabelOf(page.cat);
  const catUrl = GC.shelfUrl(page.cat) || "/products";
  /* A shelf that shares its category's name ("Purses > Purses") reads as a
     mistake, so the trail shows one hop and points it at this page. */
  const twoHops = !!page.sub && label !== catName;
  let html =
    `<nav class="product-page__crumbs" aria-label="Breadcrumb">` +
    `<a href="/">Home</a> <span aria-hidden="true">/</span> ` +
    `<a href="/products">Products</a>` +
    ` <span aria-hidden="true">/</span> ` +
    (twoHops
      ? `<a href="${escapeAttr(catUrl)}">${escapeHtml(catName)}</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(label)}</span>`
      : `<span aria-current="page">${escapeHtml(label)}</span>`) +
    `</nav>`;
  return html;
}

function chipsHtml(page) {
  let chips = [];
  if (page.sub) {
    const parent = GC.shelfUrl(page.cat);
    if (parent) chips.push({ href: parent, label: catLabelOf(page.cat) });
    for (const s of subShelvesOf(page.cat)) {
      chips.push({ href: s.url, label: s.label });
    }
  } else {
    chips = subShelvesOf(page.cat).map((s) => ({ href: s.url, label: s.label }));
  }
  /* The shelf a chip points at is already on screen, and a category with one
     shelf shares its page with it, so neither belongs in the row. */
  chips = chips.filter((c) => c.href && c.href !== page.url && c.label);
  if (!chips.length) return "";
  return (
    `<div class="shelf-chips">` +
    chips
      .map(
        (c) =>
          `<a class="shelf-chip" href="${escapeAttr(c.href)}">${escapeHtml(c.label)}</a>`
      )
      .join("") +
    `</div>`
  );
}

function faqHtml(faqs, label) {
  return (
    `<section class="section section--soft faq" aria-labelledby="shelfFaqTitle">` +
    `<div class="container faq__inner">` +
    `<div class="section-head">` +
    `<span class="section-eyebrow">Before you order</span>` +
    `<h2 class="section-title" id="shelfFaqTitle">Questions about <em>${escapeHtml(label)}</em></h2>` +
    `</div>` +
    `<div class="faq__list">` +
    faqs
      .map(
        (f) =>
          `<details class="faq__item">` +
          `<summary class="faq__q"><span>${escapeHtml(f.q)}</span></summary>` +
          `<div class="faq__a"><p>${escapeHtml(f.a)}</p></div>` +
          `</details>`
      )
      .join("") +
    `</div></div></section>`
  );
}

function ctaHtml(label) {
  const text = encodeURIComponent(
    `Hello Gulnish Crochet, I would like a crochet ${label} in my own colours.`
  );
  return (
    `<div class="shelf-cta">` +
    `<p>Want it in your own colours? <a href="https://wa.me/923075729901?text=${text}" target="_blank" rel="noopener">Message us on WhatsApp</a> and we will quote it before you commit.</p>` +
    `<p class="shelf-cta__links"><a href="/products">Browse every piece in the shop</a>` +
    `<a href="/crochet">New to crochet? Read the guide</a></p>` +
    `</div>`
  );
}

/* ---------- schema ---------- */

function jsonLd(page, label, title, description, items, faqs) {
  const url = ORIGIN + page.url;
  const catName = catLabelOf(page.cat);
  const crumbs = [
    { name: "Home", url: `${ORIGIN}/` },
    { name: "Products", url: `${ORIGIN}/products` },
  ];
  if (page.sub && label !== catName) {
    crumbs.push({ name: catName, url: ORIGIN + (GC.shelfUrl(page.cat) || "/products") });
    crumbs.push({ name: label, url });
  } else {
    crumbs.push({ name: label, url });
  }

  const graph = [
    {
      "@type": "Organization",
      "@id": `${ORIGIN}/#org`,
      name: "Gulnish Crochet",
      url: `${ORIGIN}/`,
      logo: `${ORIGIN}/images/logo/logo-badge.png`,
      email: "gulnishcrochet@gmail.com",
      sameAs: [
        "https://wa.me/923075729901",
        "https://www.instagram.com/gulnishcrochet/",
        "https://www.facebook.com/profile.php?id=61594481514536",
      ],
    },
    {
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: title,
      description,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      inLanguage: "en",
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: items.length,
        itemListElement: items.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${ORIGIN}/product/${GC.canonicalProductSlug(p)}`,
          name: p.name,
        })),
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        item: c.url,
      })),
    },
    {
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return `<script type="application/ld+json" id="shelfLd">${JSON.stringify(
    { "@context": "https://schema.org", "@graph": graph },
    null,
    2
  )}</script>`;
}

/* ---------- shell ---------- */

/* Same trick as generate-product-pages.js: products.html minus its <main> is
   the header, footer and scripts every page of the site shares, with every
   relative asset path anchored to the root so a page one directory down
   still finds its stylesheet. */
function loadShell() {
  const src = fs
    .readFileSync(path.join(ROOT, "products.html"), "utf8")
    /* The shop's ItemList belongs on /products alone; the shell is copied
       wholesale, so it has to be stripped here or every generated page would
       claim to be the whole collection. */
    .replace(/ *<script type="application\/ld\+json" id="shopLd">[\s\S]*?<\/script>\n?/, "");
  const mainStart = src.indexOf("<main>");
  const mainEnd = src.indexOf("</main>") + "</main>".length;
  const rootRelative = (chunk) =>
    chunk
      .replace(
        /\b(src|href)="(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/g,
        (m, attr, value) => `${attr}="/${value}"`
      )
      .replace(
        /\bsrcset="(?!https?:|\/\/|\/|#|data:)([^"]+)"/g,
        (m, list) =>
          `srcset="${list
            .split(",")
            .map((c) => {
              const parts = c.trim().split(/\s+/);
              return `/${parts[0]}${parts[1] ? " " + parts.slice(1).join(" ") : ""}`;
            })
            .join(", ")}"`
      );
  const head = rootRelative(src.slice(0, mainStart)).replace(
    "</head>",
    `${PAGE_STYLE}\n</head>`
  );
  return { head, tail: rootRelative(src.slice(mainEnd)) };
}

const PAGE_STYLE = `<style>
/* Shelf pages carry their own small block: these pieces exist nowhere else,
   and a global rule for them would have to be kept alive for pages that
   never use it. */
.shelf-chips{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center;margin:0 0 2.2rem}
.shelf-chip{display:inline-flex;align-items:center;padding:.5rem 1.05rem;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);color:var(--muted);font-size:.92rem;font-weight:600;transition:color .2s var(--ease),border-color .2s var(--ease),background .2s var(--ease)}
.shelf-chip:hover{color:var(--primary-deep);border-color:var(--primary);background:rgba(188,106,69,.06)}
.shelf-note{max-width:760px;margin:0 auto 2.4rem;text-align:center;color:var(--muted)}
.shelf-note p + p{margin-top:.9rem}
.shelf-note a{color:var(--primary-deep);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.shelf-empty{max-width:560px;margin:0 auto;padding:2.4rem 1.5rem;border:1px dashed var(--line-strong);border-radius:var(--radius);text-align:center;color:var(--muted)}
.shelf-cta{margin-top:3rem;padding:1.9rem 1.5rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);text-align:center}
.shelf-cta p + p{margin-top:.7rem}
.shelf-cta a{color:var(--primary-deep);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.shelf-cta__links a + a{margin-left:1.2rem}
</style>`;

/* ---------- page ---------- */

function buildPage(page) {
  const catLabel = catLabelOf(page.cat);
  const subLabel = page.sub ? GC.subcategoryLabelOf(page.cat, page.sub) || "" : "";
  const label = subLabel || catLabel;
  const items = shelfProducts(page.cat, page.sub);
  const url = ORIGIN + page.url;
  const title = buildTitle(page, label);
  const description = buildDescription(page, label, items.length);
  const faqs = buildFaqs(label);
  const craft = parseInt((GC.settings || {}).craftDays, 10) || 5;
  const days = parseInt((GC.settings || {}).deliveryDays, 10) || 3;

  const names = items.slice(0, 3);
  const namesHtml = joinList(
    names.map(
      (p) =>
        `<a href="/product/${escapeAttr(GC.canonicalProductSlug(p))}">${escapeHtml(p.name)}</a>`
    )
  );
  const range = priceRangeLabel(items);

  const p1 = page.sub
    ? `This shelf holds the ${items.length} crochet ${label.toLowerCase()} pieces in the ${catLabel} collection, every one stitched to order in Wazirabad${
        range ? ` and priced from ${range}` : ""
      }. Popular right now: ${namesHtml}.`
    : `The ${catLabel} shelf lists ${items.length} handmade crochet pieces, every one stitched to order in Wazirabad${
        range ? ` and priced from ${range}` : ""
      }. Popular right now: ${namesHtml}.`;

  const p2 = `Nothing is mass produced. Each piece is crocheted by hand in the colours you choose, which takes about ${craft} days, and the courier then adds about ${days} days. We confirm the exact date on WhatsApp before the first stitch.`;

  const grid = items.length
    ? `<div class="image-grid">${items.map(cardHtml).join("")}</div>`
    : `<p class="shelf-empty">This shelf is being restocked. Message us on WhatsApp and we will send the pieces that are on their way.</p>`;

  const body =
    `${crumbsHtml(page, label)}
<main>
${MARKER}
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="section-eyebrow">${escapeHtml(
          page.sub ? `${catLabel} collection` : "Gulnish Crochet shop"
        )}</span>
        <h1 class="section-title">Handmade crochet <em>${escapeHtml(label)}</em></h1>
        <p class="section-lead">Stitched by hand in Wazirabad, in the colours you choose, with delivery confirmed before you pay.</p>
      </div>
      <div class="shelf-note"><p>${p1}</p><p>${p2}</p></div>
      ${chipsHtml(page)}
      ${grid}
      ${ctaHtml(label)}
    </div>
  </section>
  ${faqHtml(faqs, label)}
</main>`;

  let head = buildHead(page, title, description);
  head = head.replace(
    /<script type="application\/ld\+json" id="seoBreadcrumbLd">[\s\S]*?<\/script>/,
    () => jsonLd(page, label, title, description, items, faqs)
  );

  return head + body + shell.tail;
}

function buildHead(page, title, description) {
  const url = ORIGIN + page.url;
  /* The share card keeps the site's own 1200x630 cover rather than the first
     product photo: the width and height tags below describe that cover, and a
     square photo under them would be cropped wrongly by every network. */
  const cover = `${ORIGIN}/images/og-cover-v2.webp`;
  let head = shell.head;
  /* Replacement passed as a function: a name or price containing "$" would
     otherwise be read as a replacement pattern and mangled. */
  const set = (re, value) => {
    head = head.replace(re, () => value);
  };
  set(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  set(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeAttr(description)}">`
  );
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(url)}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`);
  set(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${escapeAttr(description)}">`
  );
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(url)}">`);
  set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(cover)}">`);
  set(
    /<meta property="og:image:alt" content="[^"]*">/,
    `<meta property="og:image:alt" content="${escapeAttr(title)}">`
  );
  set(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`);
  set(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`
  );
  set(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escapeAttr(cover)}">`);
  set(
    /<meta name="twitter:image:alt" content="[^"]*">/,
    `<meta name="twitter:image:alt" content="${escapeAttr(title)}">`
  );
  return head;
}

/* ---------- run ---------- */

let shell = null;

function main() {
  return GC.init().then(build);
}

function build() {
  if (!(GC.products || []).length) {
    console.error("[shelf-pages] catalogue is empty - nothing generated");
    process.exitCode = 1;
    return;
  }
  shell = loadShell();

  const pages = shelfPages();
  const expected = new Set();
  const written = [];

  for (const page of pages) {
    const file = page.url.replace(/^\//, "") + ".html";
    expected.add(file);
    const full = path.join(ROOT, file);
    const html = buildPage(page);
    const old = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
    if (old !== html) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, html);
      written.push(file);
    }
  }

  const removed = cleanup(expected);
  const total = expected.size;
  console.log(
    `[shelf-pages] ${total} shelf page(s) (${written.length} written, ${removed} removed)`
  );
  return written;
}

/* A shelf dropped from SHELF_URLS must not leave its page behind: any HTML
   file carrying the generator's marker and not in this run's list is deleted.
   Files that were never generated here do not carry the marker, so nothing
   else can be caught by this. */
function cleanup(expected) {
  let removed = 0;
  const roots = [ROOT];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(path.join(ROOT, entry.name));
  }
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const full = path.join(dir, f);
      const rel = path.relative(ROOT, full).replace(/\\/g, "/");
      if (expected.has(rel)) continue;
      let src = "";
      try {
        src = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (!src.includes(MARKER)) continue;
      fs.unlinkSync(full);
      removed++;
    }
  }
  return removed;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[shelf-pages]", (err && err.stack) || err);
    process.exitCode = 1;
  });
}

module.exports = { main, shelfPages };
