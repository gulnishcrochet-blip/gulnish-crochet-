/* Writes a real, static list of product links into products.html and
   index.html.

   The shop grid is built by js/script.js at runtime, so the markup a crawler
   downloads contains no /product/ link at all - the empty-state copy is
   present but carries [hidden], so it is invisible rather than misleading.
   Google does render JavaScript, but for a site with no backlinks the
   second-wave render is slow and not guaranteed, which left 94 generated
   pages reachable only through sitemap.xml - one hop, no internal weight.

   This writes the links into the markup itself. The block sits between the
   same marker comments on every run, so re-running is idempotent and a manual
   edit inside the block is replaced rather than duplicated.

   Run: node scripts/static-product-links.js
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { loadCatalog } = require(path.join(ROOT, "scripts", "generate-product-pages.js"));

const START = "<!-- PRODUCT LINK INDEX START -->";
const END = "<!-- PRODUCT LINK INDEX END -->";
const PAGES = ["products.html", "index.html"];

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
    groups.get(group).push({ slug, name });
  }

  if (!groups.size) return null;

  const sections = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => {
      const links = items
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (it) =>
            `            <li><a href="/product/${esc(it.slug)}">${esc(it.name)}</a></li>`
        )
        .join("\n");
      return (
        `        <div class="link-index__group">\n` +
        `          <h3 class="link-index__title">${esc(label)}</h3>\n` +
        `          <ul class="link-index__list">\n${links}\n          </ul>\n` +
        `        </div>`
      );
    })
    .join("\n");

  const total = [...groups.values()].reduce((n, l) => n + l.length, 0);

  return [
    START,
    `    <section class="section link-index" aria-labelledby="linkIndexTitle">`,
    `      <div class="container">`,
    /* Deliberately not .reveal: html.js .reveal starts at opacity 0 and only
       becomes visible once the observer runs, so a block whose whole job is to
       be readable without JavaScript must never carry it. */
    `        <div class="section-head">`,
    `          <span class="section-eyebrow">Browse</span>`,
    `          <h2 class="section-title" id="linkIndexTitle">Every <em>piece in the shop</em></h2>`,
    `          <p class="section-lead">All ${total} handmade crochet pieces, listed by shelf &mdash; purses, bags, jewellery, keychains, bouquets, headbands and school items.</p>`,
    `        </div>`,
    `        <div class="link-index__grid">`,
    sections,
    `        </div>`,
    `      </div>`,
    `    </section>`,
    `  ${END}`,
  ].join("\n");
}

function apply(file, block) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    console.error(`[link-index] ${file} not found - skipped`);
    return false;
  }
  let src = fs.readFileSync(p, "utf8");

  if (src.includes(START) && src.includes(END)) {
    const re = new RegExp(
      START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    src = src.replace(re, block);
  } else {
    /* Placed just before </main>: inside the main landmark, after the
       JS-built grids, so it never sits in the footer where a crawler weights
       it least. */
    const at = src.lastIndexOf("</main>");
    if (at < 0) {
      console.error(`[link-index] ${file} has no </main> - skipped`);
      return false;
    }
    src = src.slice(0, at) + block + "\n  " + src.slice(at);
  }

  if (src === fs.readFileSync(p, "utf8")) return false;
  fs.writeFileSync(p, src);
  return true;
}

function main() {
  return GC.init().then(() => {
    const products = GC.products || [];
    const cats = (GC.settings || {}).categories || [];
    const block = buildBlock(products, cats);
    if (!block) {
      console.error("[link-index] catalogue is empty - nothing written");
      process.exitCode = 1;
      return;
    }
    let changed = 0;
    for (const f of PAGES) if (apply(f, block)) changed++;
    const total = (block.match(/href="\/product\//g) || []).length;
    console.log(`[link-index] ${total} product link(s) written to ${changed} page(s)`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[link-index]", (err && err.stack) || err);
    process.exitCode = 1;
  });
}

module.exports = { main };
