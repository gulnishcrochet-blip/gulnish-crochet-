/* Point the whole site at a different host.

   The origin is baked into ~100 places - canonical and og:url tags, the
   sitemap, robots.txt, JSON-LD, and a batch of absolute links. Every Vercel
   project gets its own *.vercel.app host and the subdomain is globally unique,
   so moving the site to another account always means a new hostname, and
   missing one of these spots is what makes a migrated site look broken: search
   engines keep the old canonical, social cards point at the old domain, and
   internal links 404.

     node scripts/set-origin.js https://gulnish-crochet-abc123.vercel.app
     node scripts/set-origin.js --check

   The host being replaced is read back out of index.html rather than stored
   here, so this keeps working across repeated migrations instead of needing
   its history updated each time. Add --check to report without writing. */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/* Only the site's own origin is rewritten. Third-party absolute URLs (Google
   Analytics, Facebook, the Supabase project, CDN hosts) must survive, so this
   replaces one exact host string and never a pattern. */
function currentOrigin() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const canonical = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)/);
  if (!canonical) {
    throw new Error("no absolute canonical link found in index.html");
  }
  return canonical[1];
}

/* Every root .html page, plus the two files search engines read, plus the
   dev tools in scripts/ - fix-meta.js matches on the old host by string, so
   leaving it behind would make it quietly re-insert a stale origin. The *.html
   sweep covers the shared <head> that each page carries a copy of. */
function targetFiles() {
  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join(ROOT, f));
  for (const f of ["sitemap.xml", "robots.txt"]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  const scriptsDir = path.join(ROOT, "scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".js"))) {
      files.push(path.join(scriptsDir, f));
    }
  }
  return files;
}

function normalise(origin) {
  return origin.replace(/\/+$/, "");
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const from = currentOrigin();

  if (check) {
    const stale = targetFiles().filter((f) =>
      fs.readFileSync(f, "utf8").includes(from)
    );
    console.log(`origin: ${from}`);
    console.log(`files referencing it: ${stale.length}`);
    for (const f of stale) console.log(`  ${path.relative(ROOT, f)}`);
    return;
  }

  const to = normalise(args.find((a) => !a.startsWith("--")) || "");
  if (!to) {
    console.error("usage: node scripts/set-origin.js <new-origin> | --check");
    process.exit(1);
  }
  if (!/^https:\/\/[^\s/]+$/.test(to)) {
    console.error(`not a bare https origin (no path, no trailing slash): ${to}`);
    process.exit(1);
  }
  if (to === from) {
    console.log(`already on ${from} - nothing to do`);
    return;
  }

  let touched = 0;
  for (const file of targetFiles()) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes(from)) continue;
    const next = src.split(from).join(to);
    fs.writeFileSync(file, next);
    touched++;
    console.log(`  ${path.relative(ROOT, file)}`);
  }

  console.log(`\n${from} -> ${to} in ${touched} file(s)`);
  console.log(
    "Commit and push these together, then check the new host serves the site " +
      "before tearing down the old one."
  );
}

try {
  main();
} catch (err) {
  console.error("set-origin:", err.message);
  process.exit(1);
}
