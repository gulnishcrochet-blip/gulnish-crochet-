const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEBOUNCE_MS = 1500;

/* Every push to main is a fresh Vercel deployment, and every deployment keeps a
   copy of the site, so the free tier's deployment storage is really
   "number of pushes x size of the site". Saving files one at a time therefore
   burns through the quota even though nothing visible changed. After a push,
   hold every further trigger until this window has passed and send the lot as
   one deployment: the site still updates within COALESCE_MS, but a burst of
   saves costs one deployment instead of one per save. Override with
   COALESCE_MS=0 to deploy on every change. */
const COALESCE_MS = Number(process.env.COALESCE_MS || 5 * 60 * 1000);
let quietUntil = 0;

/* api/ holds the Vercel serverless functions. It has to be watched too:
   without it a change to a function sits uncommitted in the working tree and
   the deployed endpoint keeps serving the old code with no warning. */
const WATCH_DIRS = [
  ROOT,
  path.join(ROOT, "api"),
  path.join(ROOT, "css"),
  path.join(ROOT, "js"),
  path.join(ROOT, "images")
];

let timer = null;
let pending = false;
let verifying = false;
let retries = 0;
const MAX_RETRIES = 4;

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/* A git process that was interrupted (or a crash) can leave index.lock behind.
   While it is fresh another git may genuinely be running, so only clear it once
   it is old enough to be stale. */
function clearStaleLock() {
  const lock = path.join(ROOT, ".git", "index.lock");
  try {
    if (!fs.existsSync(lock)) return false;
    const ageMs = Date.now() - fs.statSync(lock).mtimeMs;
    if (ageMs < 10000) {
      console.log(`[auto-deploy] index.lock is ${Math.round(ageMs / 1000)}s old, leaving it`);
      return false;
    }
    fs.unlinkSync(lock);
    console.log("[auto-deploy] removed stale index.lock");
    return true;
  } catch (err) {
    console.error("[auto-deploy] could not clear index.lock:", err.message.trim());
    return false;
  }
}

function aheadCount() {
  try {
    return parseInt(run("git rev-list --count origin/main..HEAD"), 10) || 0;
  } catch (err) {
    return 0;
  }
}

/* vercel.json serves /css and /js as `max-age=300, stale-while-revalidate=600`,
   so the asset URL's ?v= query is what makes a new build reach an
   already-visited browser - Bump it whenever a css/js file changed,
   otherwise a style fix could sit invisible in browsers for a year.
   Rewriting the HTML re-triggers the watcher, but the second pass sees no
   css/js change and stops, so this cannot loop. */
function bumpAssetVersion() {
  let changed;
  try {
    changed = run("git diff --name-only HEAD -- css js");
  } catch (err) {
    return 0;
  }
  if (!changed.trim()) return 0;

  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"));
  let bumped = 0;
  for (const file of files) {
    const p = path.join(ROOT, file);
    const src = fs.readFileSync(p, "utf8");
    /* Matches every ?v=<n> on css/ and js/ URLs only - a version query on a
       third-party embed (YouTube, etc.) must not be touched. */
    const next = src.replace(
      /((?:css|js)\/[^"']*\?v=)(\d+)/g,
      (m, prefix, n) => prefix + (parseInt(n, 10) + 1)
    );
    if (next !== src) {
      fs.writeFileSync(p, next);
      bumped++;
    }
  }
  if (bumped) console.log(`[auto-deploy] css/js changed - bumped ?v= in ${bumped} page(s)`);
  return bumped;
}

/* Every product has its own page under product/, generated from the catalogue
   in js/supabase.js. It has to be regenerated before the commit, or a price or
   name edit would go out with stale pages describing the old product. Only
   changed files are written, so this cannot loop on its own output. */
function generateProductPages() {
  try {
    execSync("node scripts/generate-product-pages.js", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    })
      .split("\n")
      .filter(Boolean)
      .forEach((line) => console.log("[auto-deploy] " + line.trim()));
  } catch (err) {
    /* A generator failure must not stop the site deploying: the pages on disk
       are still valid, they are just one edit behind. */
    console.error("[auto-deploy] product pages not regenerated:", (err.stderr || err.message).trim());
  }
}

/* The sitemap is committed too, so it has to be rebuilt from the same
   catalogue in the same pass, or a new product would ship without being
   listed. */
function generateProductSitemap() {
  try {
    execSync("node scripts/sitemap-products.js", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    })
      .split("\n")
      .filter(Boolean)
      .forEach((line) => console.log("[auto-deploy] " + line.trim()));
  } catch (err) {
    console.error("[auto-deploy] sitemap not updated:", (err.stderr || err.message).trim());
  }
}

/* A push can be rejected as non-fast-forward (e.g. a manual push raced this
   watcher). Rebase onto the remote and try once more so the change is not
   stranded on the local branch. */
function pushWithRecovery() {
  try {
    run("git push origin main");
    return true;
  } catch (err) {
    const text = (err.stderr || err.message || "").toString();
    if (!/non-fast-forward|rejected|cannot lock ref|fetch first/i.test(text)) {
      console.error("[auto-deploy] push failed:", text.trim());
      return false;
    }
    console.log("[auto-deploy] push rejected, rebasing onto origin/main and retrying");
    try {
      run("git pull --rebase origin main");
      run("git push origin main");
      console.log("[auto-deploy] rebase + push succeeded");
      return true;
    } catch (err2) {
      console.error("[auto-deploy] rebase/retry failed:", (err2.stderr || err2.message).trim());
      return false;
    }
  }
}

function autopush() {
  if (pending) return;
  pending = true;

  try {
    clearStaleLock();
    generateProductPages();
    generateProductSitemap();
    bumpAssetVersion();
    const status = run("git status --porcelain");
    let didCommit = false;

    if (status) {
      run("git add -A");
      run(`git commit -m "Auto-deploy: ${new Date().toISOString()}"`);
      didCommit = true;
    }

    /* A clean tree does not mean there is nothing to deploy: a previous push
       may have failed, leaving commits stranded locally. Always flush them. */
    const ahead = aheadCount();
    if (!didCommit && ahead === 0) {
      retries = 0;
      console.log("[auto-deploy] nothing to commit");
      return;
    }

    const pushed = pushWithRecovery();
    if (pushed) {
      retries = 0;
      quietUntil = Date.now() + COALESCE_MS;
      console.log(
        didCommit
          ? "[auto-deploy] committed & pushed to main -> Vercel deploying"
          : `[auto-deploy] pushed ${ahead} stranded commit(s) -> Vercel deploying`
      );
      verifyDeploy();
    }
  } catch (err) {
    console.error("[auto-deploy] error:", (err.stderr || err.message).trim());
    /* A git failure (most often index.lock held by another git process) means
       this cycle changed nothing. Nothing would re-trigger the watcher, so the
       edit would sit uncommitted until the next unrelated save - retry. */
    if (retries < MAX_RETRIES) {
      retries += 1;
      console.log(`[auto-deploy] retrying in 3s (attempt ${retries}/${MAX_RETRIES})`);
      setTimeout(autopush, 3000);
    } else {
      console.error("[auto-deploy] giving up after repeated failures - run: git add -A && git commit && git push");
    }
  } finally {
    pending = false;
  }
}

/* A successful `git push` only means GitHub has the code. Vercel builds and
   serves it separately, and that side can fail or stall with no signal here.
   Confirm the site actually serves the version we just pushed, so a stale
   deploy is reported instead of silently assumed to be fine. */
/* Where the site claims to live, read out of index.html's canonical link.
   Hard-coding it here would mean every account move or domain change had to
   edit this file as well as the pages, and a miss would silently verify one
   host while another is what visitors actually get. scripts/set-origin.js
   keeps both in step. */
function liveOrigin() {
  try {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const m = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)/);
    return m ? m[1] : null;
  } catch (err) {
    return null;
  }
}

function verifyDeploy() {
  const live = process.env.LIVE_URL || liveOrigin();
  if (!live) {
    console.error("[auto-deploy] no canonical origin in index.html - skipping deploy check");
    return;
  }
  let expected = null;
  try {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const m = html.match(/js\/script\.js\?v=(\d+)/);
    if (m) expected = m[1];
  } catch (err) {
    return;
  }
  if (!expected) return;

  const deadline = Date.now() + Number(process.env.VERIFY_TIMEOUT_MS || 180000);
  const interval = Number(process.env.VERIFY_INTERVAL_MS || 15000);
  const poll = async () => {
    if (verifying) return;
    verifying = true;
    let served = null;
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
        served = null;
        try {
          const res = await fetch(live, { cache: "no-store" });
          const html = await res.text();
          const m = html.match(/js\/script\.js\?v=(\d+)/);
          served = m ? m[1] : null;
        } catch (err) {
          console.error("[auto-deploy] live check failed:", err.message.trim());
          continue;
        }
        if (served === expected) {
          console.log(`[auto-deploy] live is serving v=${expected} - deploy confirmed`);
          return;
        }
      }
      console.error(
        `[auto-deploy] WARNING: pushed v=${expected} but the live site is still serving ` +
          `v=${served}. The Vercel deploy is stale or failed - redeploy from the Vercel dashboard.`
      );
    } finally {
      verifying = false;
    }
  };
  poll().catch((err) => console.error("[auto-deploy] verifyDeploy:", err.message.trim()));
}

function schedule() {
  if (timer) clearTimeout(timer);
  /* Inside the coalescing window the push waits for the window to end instead
     of firing DEBOUNCE_MS later, so a run of saves becomes a single deploy. */
  const now = Date.now();
  const wait = Math.max(DEBOUNCE_MS, quietUntil - now) + (quietUntil > now ? DEBOUNCE_MS : 0);
  timer = setTimeout(autopush, wait);
}

function onChange(eventType, filename) {
  if (!filename) return;
  const f = filename.toString();
  if (f.includes(".git") || f.includes("node_modules") || f.includes("auto-deploy.js")) return;
  schedule();
}

console.log("[auto-deploy] watching", WATCH_DIRS.join(", "));
for (const dir of WATCH_DIRS) {
  if (fs.existsSync(dir)) {
    fs.watch(dir, { persistent: true }, onChange);
  }
}

process.on("SIGINT", () => {
  clearTimeout(timer);
  autopush();
  process.exit(0);
});
