/* Writes the "Before you order" FAQ into index.html, plus the FAQPage
   structured data that lets Google show the answers directly in the results.

   Every answer is built from shop settings (craftDays, deliveryDays,
   deliveryLabel) rather than typed out, so the FAQ cannot drift away from
   what the product pages and checkout say. Changing a number in Admin changes
   this section on the next run.

   Run: node scripts/faq-section.js
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { loadCatalog } = require(path.join(ROOT, "scripts", "generate-product-pages.js"));

const START = "<!-- FAQ SECTION START -->";
const END = "<!-- FAQ SECTION END -->";
const LD_ID = "seoFaqLd";

const PAGES = ["index.html"];

const GC = loadCatalog();

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Built from the same settings the rest of the site reads, so the timings
   quoted here match the product pages and the checkout estimate. */
function buildFaqs() {
  const s = GC.settings || {};
  const craft = parseInt(s.craftDays, 10) || 5;
  const days = parseInt(s.deliveryDays, 10) || 3;
  const total = craft + days;
  const deliveryLabel = (GC.deliveryLabel && GC.deliveryLabel()) || "Delivery charge confirmed on WhatsApp";

  return [
    {
      q: "How long will my order take?",
      a: `Each piece is stitched by hand after you order, which takes about ${craft} days. Delivery across Pakistan then takes about ${days} days, so most orders arrive in around ${total} days in total. We send you a confirmed date on WhatsApp before stitching begins.`,
    },
    {
      q: "Do you deliver across Pakistan?",
      a: `Yes — we deliver to every city in Pakistan. ${deliveryLabel}, and we confirm the amount with you on WhatsApp before you pay anything.`,
    },
    {
      q: "How do I pay?",
      a: "You can pay by bank transfer, JazzCash or EasyPaisa. Payment is made in advance, and we confirm your payment and delivery details on WhatsApp before we start stitching.",
    },
    {
      q: "Can I get a different colour or size?",
      a: "Yes — every piece can be made in the colours and size you want. Send us a photo or a description on WhatsApp and we will quote it before you commit.",
    },
    {
      q: "Do you take bulk or wedding orders?",
      a: "Yes. Wedding favours, Eid hampers, corporate gifts and party bundles are all welcome — send the quantity and colours you need on WhatsApp and we will quote it.",
    },
    {
      q: "How do I track my order?",
      a: "Once your order is with the courier we send you the tracking details on WhatsApp. You can also enter your order number on the Track Order page at any time.",
    },
    {
      q: "What if I need to cancel or get a refund?",
      a: "Because every piece is made to order, please message us as early as possible if you need to change or cancel. Our refund policy explains the full terms.",
    },
    {
      q: "Where is Gulnish Crochet based?",
      a: "We are a small hands-on studio in Wazirabad, Pakistan. Every piece is designed and stitched here by hand — no machines and no mass production.",
    },
  ];
}

function buildBlock(faqs) {
  const items = faqs
    .map(
      (f) =>
        `          <details class="faq__item">\n` +
        `            <summary class="faq__q"><span>${esc(f.q)}</span></summary>\n` +
        `            <div class="faq__a"><p>${esc(f.a)}</p></div>\n` +
        `          </details>`
    )
    .join("\n");

  return [
    `  ${START}`,
    `    <section class="section section--soft faq" aria-labelledby="faqTitle">`,
    `      <div class="container faq__inner">`,
    `        <div class="section-head">`,
    `          <span class="section-eyebrow">Before you order</span>`,
    `          <h2 class="section-title" id="faqTitle">Questions, <em>answered</em></h2>`,
    `          <p class="section-lead">The things people ask us most, in plain words. If yours is not here, message us on WhatsApp — we answer every one.</p>`,
    `        </div>`,
    `        <div class="faq__list">`,
    items,
    `        </div>`,
    `        <p class="faq__foot">Still unsure? <a href="https://wa.me/${esc(
      (GC.shopWhatsApp && GC.shopWhatsApp()) || "923075729901"
    )}" target="_blank" rel="noopener">Ask us on WhatsApp</a> — we reply personally.</p>`,
    `      </div>`,
    `    </section>`,
    `  ${END}`,
  ].join("\n");
}

/* Google only shows FAQ rich results when the schema matches the visible
   questions exactly, so this is written from the same array the markup is. */
function buildLd(faqs) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return `<script type="application/ld+json" id="${LD_ID}">${JSON.stringify(data, null, 2)}</script>`;
}

function apply(file, block, ld) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    console.error(`[faq] ${file} not found - skipped`);
    return false;
  }
  const before = fs.readFileSync(p, "utf8");
  let src = before;

  /* Visible section: replaced in place, or inserted before the product link
     index on a first run. It sits ahead of that long list so a shopper meets
     the answers first. Matching tolerates any indent so re-runs are stable. */
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(`[ \\t]*${escRe(START)}[\\s\\S]*?[ \\t]*${escRe(END)}\\n?`);
  if (blockRe.test(src)) {
    src = src.replace(blockRe, block + "\n");
  } else if (src.includes(START) || src.includes(END)) {
    console.error(`[faq] ${file} has an unmatched FAQ marker - skipped`);
    return false;
  } else {
    const at = src.indexOf("<!-- PRODUCT LINK INDEX START -->");
    const insertAt = at >= 0 ? at : src.lastIndexOf("</main>");
    if (insertAt < 0) {
      console.error(`[faq] ${file} has no insertion point - skipped`);
      return false;
    }
    /* Normalise whatever blank lines precede the insertion point so the
       result does not depend on them; block brings its own indent. */
    const head = src.slice(0, insertAt).replace(/(\r?\n)[ \t]*(\r?\n[ \t]*)*$/, "$1");
    src = head + "\n" + block + "\n\n  " + src.slice(insertAt);
  }

  /* Structured data lives in <head> next to the other blocks. */
  const ldRe = new RegExp(`<script type="application/ld\\+json" id="${LD_ID}">[\\s\\S]*?<\\/script>`);
  if (ldRe.test(src)) {
    src = src.replace(ldRe, ld);
  } else {
    const headEnd = src.indexOf("</head>");
    if (headEnd < 0) {
      console.error(`[faq] ${file} has no </head> - skipped`);
      return false;
    }
    src = src.slice(0, headEnd) + "  " + ld + "\n" + src.slice(headEnd);
  }

  if (src === before) return false;
  fs.writeFileSync(p, src);
  return true;
}

function main() {
  return GC.init().then(() => {
    const faqs = buildFaqs();
    const block = buildBlock(faqs);
    const ld = buildLd(faqs);
    let changed = 0;
    for (const f of PAGES) if (apply(f, block, ld)) changed++;
    console.log(`[faq] ${faqs.length} question(s) written to ${changed} page(s)`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[faq]", (err && err.stack) || err);
    process.exitCode = 1;
  });
}

module.exports = { main, buildFaqs };
