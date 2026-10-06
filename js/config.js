/* =========================================================
   Gulnish Crochet — Supabase configuration
   =========================================================
   Paste your Supabase project URL and anon (public) key below.

   How to get these:
   1. Create a free project on https://supabase.com
   2. Go to Project Settings -> API
   3. Copy the "Project URL" and the "anon" public key.

   Leave them as "" to run the site in offline/localStorage mode
   (data stays in each visitor's own browser, like before).

   IMPORTANT: Only ever use the PUBLISHABLE "anon" key here, never
   the secret "service_role" key. It must not be exposed in the browser.
   ========================================================= */

window.GC_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",

  // Bucket name used to store uploaded product/category photos.
  // This must match the bucket you create in Supabase Storage.
  storageBucket: "shop-images"
};

// Analytics — Google Analytics 4 (G-XXXXXXX) and Meta Pixel (numeric ID).
// Leave both "" to keep the site untagged. Scripts load automatically
// from js/analytics.js once an ID is set.
window.GC_ANALYTICS = {
  /* Google Analytics 4: still empty. Paste the G-XXXXXXXX measurement ID
     here when you have one and it starts reporting with no other change. */
  ga4: "",
  /* Meta Pixel. This ID is public by design - it appears in the page source of
     every site running the pixel - so it belongs here rather than in an
     environment variable, and it is not a secret. */
  meta: "1118150207236206"
};
