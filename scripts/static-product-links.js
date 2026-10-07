/* Builds the shop index - every product link, grouped by shelf - and writes
   it to its own URL, /shop-index.

   The shop grid is built by js/script.js at runtime, so the markup a crawler
   downloads on / contains no /product/ link at all. Google does render
   JavaScript, but for a site with no backlinks the second-wave render is slow
   and not guaranteed, which left 94 generated pages reachable only through
   sitemap.xml - one hop, no internal weight.

   The list therefore lives on a page of its own that no menu, footer or card
   links to: a shopper never runs into it, sitemap.xml hands the address to
   Google, and / and /products stay as short as they were before the index
   existed. products.html still carries the CollectionPage + ItemList in its
   head, so the shop page describes its collection without printing it.

   The block sits between the same marker comments on every run, so re-running
   is idempotent and a manual edit inside the block is replaced rather than
   duplicated.

   Run: node scripts/static-product-links.js
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { loadCatalog } = require(path.join(ROOT, "scripts", "generate-product-pages.js"));

const ORIGIN = "https://gulnishcrochet.vercel.app";
const START = "<!-- PRODUCT LINK INDEX START -->";
const END = "<!-- PRODUCT LINK INDEX END -->";
const INDEX_PAGE = "shop-index.html";
const INDEX_TITLE = "Every Piece in the Shop | Gulnish Crochet";
const INDEX_DESC =
  "Every handmade crochet piece from Gulnish Crochet, listed by shelf: purses, bags, backpacks, pens, pencil cases, headbands, keychains and bouquets.";

const GC = loadCatalog();

/* Escaping matches what generate-product-pages.js puts in the anchors it
   writes, so a name containing an ampersand is safe in both. */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBlock(products, cats) {
  /* Grouped by category, then subcategory, so the block reads as a small site
     index rather than an undifferentiated dump of 94 links. Products with no
     photo or no price have no page, so they are skipped - linking to them
     would hand Google a 404. */
  const groups = new Map();
  const seenNames = new Set();

  for (const p of products) {
    if (!p.image || !(parseFloat(p.price) > 0)) continue;
    const name = String(p.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const slug = GC.canonicalProductSlug(p);
    if (!slug) continue;

    const catIdx = parseInt(String(p.category || "").replace("gr", ""), 10) - 1;
    const catLabel = (catIdx >= 0 && cats[catIdx]) || "Other";
    const subLabel = GC.subcategoryLabelOf(p.category, p.subcategory) || "";
    /* The seed data often sets the subcategory to the same string as its
       category ("Purses"), which would render as a heading of
       "Purses - Purses". Fall back to the bare category when they agree. */
    const group =
      subLabel && subLabel.toLowerCase() !== catLabel.toLowerCase()
        ? `${catLabel} \u2013 ${subLabel}`
        : catLabel;

    if (!groups.has(group)) groups.set(group, []);
    /* The shelf the heading belongs to, so the title itself becomes a link
       to /purses or /wedding-gifts/bouquets instead of a dead line of text.
       A product the taxonomy cannot place keeps a plain heading rather than
       pointing a reader at somebody else's shelf. */
    groups.get(group).push({
      slug,
      name,
      shelf:
        GC.shelfUrl(p.category, p.subcategory) ||
        GC.shelfUrl(p.category) ||
        "",
    });
  }

  if (!groups.size) return null;

  const ordered = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => [
      label,
      items.sort((a, b) => a.name.localeCompare(b.name)),
    ]);

  const sections = ordered
    .map(([label, items]) => {
      const links = items
        .map(
          (it) =>
            `            <li><a href="/product/${esc(it.slug)}">${esc(it.name)}</a></li>`
        )
        .join("\n");
      const shelf = items[0] && items[0].shelf ? items[0].shelf : "";
      const title = shelf
        ? `<a href="${esc(shelf)}">${esc(label)}</a>`
        : esc(label);
      return (
        `        <div class="link-index__group">\n` +
        `          <h3 class="link-index__title">${title}</h3>\n` +
        `          <ul class="link-index__list">\n${links}\n          </ul>\n` +
        `        </div>`
      );
    })
    .join("\n");

  const total = [...groups.values()].reduce((n, l) => n + l.length, 0);

  const block = [
    START,
    `    <section class="section link-index" aria-labelledby="linkIndexTitle">`,
    `      <div class="container">`,
    /* Deliberately not .reveal: html.js .reveal starts at opacity 0 and only
       becomes visible once the observer runs, so a block whose whole job is to
       be readable without JavaScript must never carry it. */
    `        <div class="section-head">`,
    `          <span class="section-eyebrow">Browse</span>`,
    `          <h1 class="section-title" id="linkIndexTitle">Every <em>piece in the shop</em></h1>`,
    `          <p class="section-lead">All ${total} handmade crochet pieces, listed by shelf &mdash; purses, bags, jewellery, keychains, bouquets, headbands and school items.</p>`,
    `        </div>`,
    /* The grid ships closed: a shopper sees one short line, and the whole
       index stays in the markup for a crawler to read and follow. */
    `        <details class="link-index__fold">`,
    `          <summary class="link-index__fold-btn">Show all ${total} pieces by name</summary>`,
    `          <div class="link-index__grid">`,
    sections,
    `          </div>`,
    `        </details>`,
    `      </div>`,
    `    </section>`,
    `  ${END}`,
  ].join("\n");

  /* The same pieces, in the same order the page lists them, so the ItemList
     in the head describes the markup directly below it. */
  const items = ordered.flatMap(([, list]) => list);
  return { block, items };
}

/* CollectionPage + ItemList for the shop page. products.html is the page
   every internal link points at, and until now it told a crawler nothing
   about what it collects: Organization and a breadcrumb, no list. The title
   and description are read back out of the file rather than repeated here,
   so the schema can never drift from the head a search engine shows. */
function buildShopLd(src, items) {
  const title = ((src.match(/<title>([^<]*)<\/title>/) || [])[1] || "").trim();
  const description = (
    (src.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ""
  ).trim();
  const page = {
    "@type": "CollectionPage",
    "@id": `${ORIGIN}/products#page`,
    url: `${ORIGIN}/products`,
    name: title,
    description,
    inLanguage: "en",
    isPartOf: { "@id": `${ORIGIN}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${ORIGIN}/product/${it.slug}`,
        name: it.name,
      })),
    },
  };
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [page] }, null, 2);
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Drops the index block wherever it used to be written, leaving the page
   exactly as it was before the list existed. */
function stripBlock(src) {
  if (!src.includes(START)) return src;
  return src.replace(
    new RegExp("[ \\t]*" + escRe(START) + "[\\s\\S]*?" + escRe(END) + "[ \\t]*\\n?"),
    ""
  );
}

function shopIndexLd() {
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
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Shop Index", item: `${ORIGIN}/shop-index` },
      ],
      "@id": `${ORIGIN}/shop-index#breadcrumb`,
    },
  ];
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
  return `<script type="application/ld+json" id="seoBreadcrumbLd">${json}</script>`;
}

/* A whole document built from the products.html shell: same header, footer,
   styles and scripts, a rewritten head and a main that holds the index. */
function buildShopIndex(block) {
  const src = fs.readFileSync(path.join(ROOT, "products.html"), "utf8");
  const mainStart = src.indexOf("<main>");
  const mainEnd = src.indexOf("</main>") + "</main>".length;
  const rootRelative = (chunk) =>
    chunk.replace(
      /\b(src|href)="(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/g,
      (m, attr, value) => `${attr}="/${value}"`
    );

  let head = rootRelative(src.slice(0, mainStart));
  /* The ItemList stays on /products; this page carries its own breadcrumb. */
  head = head.replace(
    / *<script type="application\/ld\+json" id="shopLd">[\s\S]*?<\/script>\n?/,
    ""
  );
  const set = (re, value) => {
    head = head.replace(re, () => value);
  };
  set(/<title>[\s\S]*?<\/title>/, `<title>${esc(INDEX_TITLE)}</title>`);
  set(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${esc(INDEX_DESC)}">`
  );
  set(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${ORIGIN}/shop-index">`
  );
  set(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${esc(INDEX_TITLE)}">`
  );
  set(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${esc(INDEX_DESC)}">`
  );
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${ORIGIN}/shop-index">`);
  set(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${esc(INDEX_TITLE)}">`
  );
  set(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${esc(INDEX_DESC)}">`
  );
  head = head.replace(
    /<script type="application\/ld\+json" id="seoBreadcrumbLd">[\s\S]*?<\/script>/,
    () => shopIndexLd()
  );

  const tail = rootRelative(src.slice(mainEnd));
  return head + `<main>\n${block}\n</main>` + tail;
}

/* Keeps exactly one shop schema in the head: written on the first run,
   rewritten on every run after it, never appended twice. */
function applyLd(src, ld) {
  const script = `<script type="application/ld+json" id="shopLd">${ld}</script>`;
  if (src.includes('id="shopLd"')) {
    return src.replace(
      /<script type="application\/ld\+json" id="shopLd">[\s\S]*?<\/script>/,
      () => script
    );
  }
  const at = src.indexOf("</head>");
  if (at < 0) return src;
  return src.slice(0, at) + `  ${script}\n` + src.slice(at);
}

function main() {
  return GC.init().then(() => {
    const products = GC.products || [];
    const cats = (GC.settings || {}).categories || [];
    const built = buildBlock(products, cats);
    if (!built) {
      console.error("[link-index] catalogue is empty - nothing written");
      process.exitCode = 1;
      return;
    }
    const { block, items } = built;

    /* /products keeps the schema and loses the list. */
    const productsFile = path.join(ROOT, "products.html");
    const productsSrc = stripBlock(fs.readFileSync(productsFile, "utf8"));
    fs.writeFileSync(
      productsFile,
      applyLd(productsSrc, buildShopLd(productsSrc, items))
    );

    /* The home page loses it too - the FAQ is the only long block there. */
    for (const f of ["index.html"]) {
      const p = path.join(ROOT, f);
      const src = fs.readFileSync(p, "utf8");
      const stripped = stripBlock(src);
      if (stripped !== src) fs.writeFileSync(p, stripped);
    }

    fs.writeFileSync(path.join(ROOT, INDEX_PAGE), buildShopIndex(block));

    console.log(
      `[link-index] ${items.length} product link(s) written to /shop-index and removed from the shop pages`
    );
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[link-index]", (err && err.stack) || err);
    process.exitCode = 1;
  });
}

module.exports = { main };
