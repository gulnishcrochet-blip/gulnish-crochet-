/* Builds the "Before you order" FAQ once, on its own URL, /faq.

   The answers used to sit on the home page, which put a nine-question block
   between the shopper and the shop. Nothing links to /faq - no menu, no
   footer, no card - so a customer never meets it by browsing, while
   sitemap.xml hands the address to Google together with the FAQPage data
   that lets the answers show up in the results.

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

/* The page that now holds it, built from the products.html shell. */
const FAQ_PAGE = "faq.html";
const FAQ_TITLE = "Frequently Asked Questions | Gulnish Crochet";
const FAQ_DESC =
  "Answers about crochet timing, delivery across Pakistan, payment by bank, JazzCash or EasyPaisa, custom colours and sizes, bulk orders, tracking and refunds.";
const ORIGIN = "https://gulnishcrochet.vercel.app";

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
      q: "What is crochet, exactly?",
      a: "Crochet is fabric built loop by loop with a single hooked needle — each stitch is closed before the next one starts, so only one loop is ever live, and no machine can reproduce that motion. Our [[complete guide to crochet in Pakistan|/crochet]] covers how the stitch works, how it differs from knitting, and why it is called Qureshia here.",
    },
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

/* [[text|href]] inside an answer becomes a real anchor in the markup, and the
   same words with the markup stripped go into the schema - Google only shows
   FAQ rich results when the structured answer matches what the page says. */
function withLinks(a) {
  return a.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a href="$2">$1</a>');
}

function plainText(a) {
  return a.replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, "$1");
}

/* The section itself, with an h1: /faq is a page of its own now, and the
   questions it leads with are the reason the page exists. */
function sectionHtml(faqs) {
  const items = faqs
    .map(
      (f) =>
        `          <details class="faq__item">\n` +
        `            <summary class="faq__q"><span>${esc(f.q)}</span></summary>\n` +
        `            <div class="faq__a"><p>${withLinks(esc(f.a))}</p></div>\n` +
        `          </details>`
    )
    .join("\n");

  return [
    `    <section class="section section--soft faq" aria-labelledby="faqTitle">`,
    `      <div class="container faq__inner">`,
    `        <div class="section-head">`,
    `          <span class="section-eyebrow">Before you order</span>`,
    `          <h1 class="section-title" id="faqTitle">Questions, <em>answered</em></h1>`,
    `          <p class="section-lead">The things people ask us most, in plain words. If yours is not here, message us on WhatsApp \u2014 we answer every one.</p>`,
    `        </div>`,
    `        <div class="faq__list">`,
    items,
    `        </div>`,
    `        <p class="faq__foot">Still unsure? <a href="https://wa.me/${esc(
      (GC.shopWhatsApp && GC.shopWhatsApp()) || "923075729901"
    )}" target="_blank" rel="noopener">Ask us on WhatsApp</a> \u2014 we reply personally.</p>`,
    `      </div>`,
    `    </section>`,
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
      acceptedAnswer: { "@type": "Answer", text: plainText(f.a) },
    })),
  };
  return `<script type="application/ld+json" id="${LD_ID}">${JSON.stringify(data, null, 2)}</script>`;
}

/* Drops the FAQ section and its structured data from a page that used to
   print them, leaving nothing behind - no empty heading, no orphan schema. */
function stripFaq(src) {
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  src = src.replace(
    new RegExp(`[ \\t]*${escRe(START)}[\\s\\S]*?${escRe(END)}[ \\t]*\\n?`),
    ""
  );
  src = src.replace(
    new RegExp(
      `[ \\t]*<script type="application/ld\\+json" id="${LD_ID}">[\\s\\S]*?</script>\\n?`
    ),
    ""
  );
  return src;
}

function breadcrumbLd() {
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
        { "@type": "ListItem", position: 2, name: "FAQ", item: `${ORIGIN}/faq` },
      ],
      "@id": `${ORIGIN}/faq#breadcrumb`,
    },
  ];
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
  return `<script type="application/ld+json" id="seoBreadcrumbLd">${json}</script>`;
}

/* A whole document built from the products.html shell: same header, footer,
   styles and scripts, a rewritten head and a main that holds the answers. */
function buildFaqPage(faqs) {
  const src = fs.readFileSync(path.join(ROOT, "products.html"), "utf8");
  const mainStart = src.indexOf("<main>");
  const mainEnd = src.indexOf("</main>") + "</main>".length;
  const rootRelative = (chunk) =>
    chunk.replace(
      /\b(src|href)="(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/g,
      (m, attr, value) => `${attr}="/${value}"`
    );

  let head = rootRelative(src.slice(0, mainStart));
  head = head.replace(
    / *<script type="application\/ld\+json" id="shopLd">[\s\S]*?<\/script>\n?/,
    ""
  );
  const set = (re, value) => {
    head = head.replace(re, () => value);
  };
  set(/<title>[\s\S]*?<\/title>/, `<title>${esc(FAQ_TITLE)}</title>`);
  set(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${esc(FAQ_DESC)}">`
  );
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${ORIGIN}/faq">`);
  set(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${esc(FAQ_TITLE)}">`
  );
  set(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${esc(FAQ_DESC)}">`
  );
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${ORIGIN}/faq">`);
  set(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${esc(FAQ_TITLE)}">`
  );
  set(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${esc(FAQ_DESC)}">`
  );
  head = head.replace(
    /<script type="application\/ld\+json" id="seoBreadcrumbLd">[\s\S]*?<\/script>/,
    () => breadcrumbLd()
  );
  head = head.replace("</head>", `  ${buildLd(faqs)}\n</head>`);

  const tail = rootRelative(src.slice(mainEnd));
  return head + `<main>\n${sectionHtml(faqs)}\n</main>` + tail;
}

function main() {
  return GC.init().then(() => {
    const faqs = buildFaqs();

    const idx = path.join(ROOT, "index.html");
    const before = fs.readFileSync(idx, "utf8");
    const after = stripFaq(before);
    if (after !== before) fs.writeFileSync(idx, after);

    fs.writeFileSync(path.join(ROOT, FAQ_PAGE), buildFaqPage(faqs));

    console.log(
      `[faq] ${faqs.length} question(s) written to /faq and removed from the home page`
    );
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[faq]", (err && err.stack) || err);
    process.exitCode = 1;
  });
}

module.exports = { main, buildFaqs };
