/* =========================================================
   Gulnish Crochet — shared data layer (Supabase)
   =========================================================
   One place all pages use to read and write products, settings
   and orders to a shared Supabase Postgres database, so every
   visitor sees the same up-to-date shop.

   If no Supabase keys are configured (GC_CONFIG empty), the
   site falls back to per-browser localStorage so it keeps
   working before you set up Supabase.

   Exposes a single global:  window.GC
   ========================================================= */

(function () {
  "use strict";

  /* Bump LOCAL_PRODUCTS version whenever the seed catalog changes so
     returning visitors' browsers re-sync products (offline/localStorage mode). */
  var LOCAL_PRODUCTS = "gulnish-products-v43";
  var LOCAL_SETTINGS = "gulnish-settings-v2";
  var LOCAL_ORDERS = "gulnish-orders";
  var LOCAL_ADMIN_SESSION = "gulnish-admin-session";
  var LOCAL_CUSTOMER = "gulnish-customer";
  var SETTINGS_ID = "app";

  var cfg = window.GC_CONFIG || {};
  var SUPABASE_CDN =
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/dist/umd/supabase.min.js";

  /* The SDK is only needed when keys are actually configured. Loading it from
     a <script> tag on every page cost ~120 KB (dead weight in localStorage
     mode) and, because the tag was deferred while this file was not, it had
     not even executed yet when this file ran - so the Supabase path could
     never start. It is now fetched on demand, off the critical path, and only
     when js/config.js has keys. */
  var wantsClient = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  var sb = null;
  var configured = false;
  var sdkPromise = null;

  function loadSdk() {
    if (!wantsClient || typeof window.supabase !== "undefined") {
      return Promise.resolve();
    }
    if (!sdkPromise) {
      sdkPromise = new Promise(function (resolve) {
        var el = document.createElement("script");
        el.src = SUPABASE_CDN;
        el.async = true;
        el.onload = resolve;
        el.onerror = function () {
          console.warn("Supabase SDK failed to load - using localStorage.");
          resolve();
        };
        document.head.appendChild(el);
      });
    }
    return sdkPromise;
  }

  function connect() {
    if (configured || !wantsClient) return;
    if (typeof window.supabase === "undefined") return;
    try {
      sb = window.supabase.createClient(
        cfg.supabaseUrl,
        cfg.supabaseAnonKey
      );
      configured = true;
    } catch (e) {
      console.error("Supabase init failed, using localStorage:", e);
      sb = null;
    }
  }

  /* ---------- in-memory stores ---------- */
  var products = [];
  var settings = null;
  var orders = [];
  var _orderSubscriptions = [];
  var _onOrdersChanged = null;

  /* products.subcategory arrived after the rest of the products table, so a
     database that has not run supabase-v20.sql rejects the entire upsert with
     PGRST204. Rather than lose the edit, we detect that once, drop the column
     from the row and flag it so the admin panel can say so out loud. */
  var subcategoryColumnMissing = false;
  function isMissingSubcategoryColumn(err) {
    if (!err) return false;
    var text = [err.code, err.message, err.details, err.hint]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.indexOf("subcategory") !== -1 &&
      (text.indexOf("could not find") !== -1 ||
        text.indexOf("pgrst204") !== -1 ||
        text.indexOf("does not exist") !== -1);
  }

  /* ---------- default settings (mirrors original) ---------- */

  /* Categories are positional: the key for the category at index i is
     "gr" + (i + 1), and every product stores that key verbatim. New categories
     are therefore always APPENDED - inserting one would silently re-point
     every existing product at the wrong category. */
  var DEFAULT_COUNT = 8;
  var DEFAULT_NAMES = ["Purses", "Gajrays", "Keychains"];
  var EXTRA_CATEGORY_NAMES = { 4: "Bags", 5: "Jewellery", 6: "Headband", 7: "Bouquet", 8: "Gifts" };

  /* Subcategories are positional inside their parent, so the key is "sg" +
     (index + 1) and is only ever read alongside the product's own category.
     A blank entry list means "no subcategories" - most categories are flat. */
  var EXTRA_SUBCATEGORY_NAMES = { 8: ["Shirt Keychain"] };

  function subKey(i) { return "sg" + (i + 1); }
  function subIndexOf(key) { return parseInt(String(key || "").replace("sg", ""), 10) - 1; }
  function defaultSubcategories() {
    var out = {};
    for (var i = 0; i < DEFAULT_COUNT; i += 1) {
      out["gr" + (i + 1)] = (EXTRA_SUBCATEGORY_NAMES[i + 1] || []).slice();
    }
    return out;
  }

  var CATEGORY_IMAGE_SETS = {
    gr1: ["images/purses/purse-1.webp", "images/purses/purse-2.webp", "images/purses/purse-23.webp", "images/purses/purse-24.webp"],
    gr2: [],
    gr3: ["images/keychains/keychain-1.webp", "images/keychains/keychain-2.webp"],
    gr4: ["images/bags/bag-1.webp", "images/bags/bag-2.webp"],
    gr5: ["images/jewellery/jewellery-1.webp", "images/jewellery/jewellery-2.webp", "images/jewellery/jewellery-3.webp", "images/jewellery/jewellery-4.webp", "images/jewellery/jewellery-5.webp", "images/jewellery/jewellery-6.webp", "images/jewellery/jewellery-7.webp", "images/jewellery/jewellery-8.webp", "images/jewellery/jewellery-9.webp"],
    gr6: ["images/headbands/headband-1.webp", "images/headbands/headband-2.webp"],
    gr7: ["images/bouquets/bouquet-1.webp", "images/bouquets/bouquet-2.webp", "images/bouquets/bouquet-3.webp", "images/bouquets/bouquet-4.webp", "images/bouquets/bouquet-5.webp", "images/bouquets/bouquet-6.webp", "images/bouquets/bouquet-7.webp"],
    gr8: []
  };

  /* Keys may be a whole category (gr2) or a single product id. A product with
     no image still lists and still orders - the grid, category card and
     product page all fall back to photoPendingHTML(), which shows
     "The picture will be uploaded soon. However, you can customize your
     design directly on WhatsApp." */
  var HIDE_PRODUCT_IMAGES = {
    gr2: true,
    "seed_gr1_6": true,
    "seed_gr1_7": true,
    "seed_gr8_1": true
  };

  /* ---------- placeholder product catalog ---------- */
  var RAW_IMAGES = {
    gr1: ["images/purses/purse-1.webp", "images/purses/purse-2.webp", "images/purses/purse-3.webp", "images/purses/purse-4.webp", "images/purses/purse-5.webp", "images/purses/purse-6.webp", "images/purses/purse-7.webp", "images/purses/purse-8.webp", "images/purses/purse-9.webp", "images/purses/purse-10.webp", "images/purses/purse-11.webp", "images/purses/purse-12.webp", "images/purses/purse-13.webp", "images/purses/purse-14.webp", "images/purses/purse-15.webp", "images/purses/purse-16.webp", "images/purses/purse-17.webp", "images/purses/purse-18.webp", "images/purses/purse-19.webp", "images/purses/purse-20.webp", "images/purses/purse-21.webp", "images/purses/purse-22.webp", "images/purses/purse-23.webp", "images/purses/purse-24.webp", "images/purses/purse-25.webp", "images/purses/purse-26.webp", "images/purses/purse-27.webp", "images/purses/purse-28.webp", "images/purses/purse-29.webp", "images/purses/purse-30.webp", "images/purses/purse-31.webp", "images/purses/purse-32.webp", "images/purses/purse-33.webp"],
    gr2: ["images/gajrays/gajray-1.webp", "images/gajrays/gajray-9.webp", "images/gajrays/gajray-4.webp", "images/gajrays/gajray-5.webp", "images/gajrays/gajray-6.webp", "images/gajrays/gajray-8.webp", "images/gajrays/gajray-10.webp", "images/gajrays/gajray-11.webp", "images/gajrays/gajray-12.webp", "images/gajrays/gajray-13.webp", "images/gajrays/gajray-14.webp", "images/gajrays/gajray-15.webp", "images/gajrays/gajray-16.webp", "images/gajrays/gajray-17.webp"],
    gr3: ["images/keychains/keychain-1.webp", "images/keychains/keychain-2.webp", "images/keychains/keychain-3.webp", "images/keychains/keychain-4.webp", "images/keychains/keychain-5.webp", "images/keychains/keychain-6.webp", "images/keychains/keychain-7.webp", "images/keychains/keychain-8.webp", "images/keychains/keychain-9.webp", "images/keychains/keychain-10.webp", "images/keychains/keychain-11.webp", "images/keychains/keychain-12.webp", "images/keychains/keychain-13.webp", "images/keychains/keychain-14.webp", "images/keychains/keychain-15.webp", "images/keychains/keychain-16.webp", "images/keychains/keychain-17.webp", "images/keychains/keychain-18.webp", "images/keychains/keychain-19.webp", "images/keychains/keychain-20.webp"],
    gr4: ["images/bags/bag-1.webp", "images/bags/bag-2.webp", "images/bags/bag-3.webp", "images/bags/bag-4.webp"],
    gr5: ["images/jewellery/jewellery-1.webp", "images/jewellery/jewellery-2.webp", "images/jewellery/jewellery-3.webp", "images/jewellery/jewellery-4.webp", "images/jewellery/jewellery-5.webp", "images/jewellery/jewellery-6.webp", "images/jewellery/jewellery-7.webp", "images/jewellery/jewellery-8.webp", "images/jewellery/jewellery-9.webp"],
    gr6: ["images/headbands/headband-1.webp", "images/headbands/headband-2.webp", "images/headbands/headband-3.webp"],
    gr7: ["images/bouquets/bouquet-1.webp", "images/bouquets/bouquet-2.webp", "images/bouquets/bouquet-3.webp", "images/bouquets/bouquet-4.webp", "images/bouquets/bouquet-5.webp", "images/bouquets/bouquet-6.webp", "images/bouquets/bouquet-7.webp"],
    /* Gifts holds subcategories, and the shirt keychains are not photographed
       yet, so the seed entry is deliberately image-less: the card falls back to
       the "picture will be uploaded soon" slot and its price stays unquoted. */
    gr8: ["images/gifts/shirt-keychain-1.webp"]
  };

  var ITEM_NAME  = { gr1: "Purse",    gr2: "Gajray",    gr3: "Keychain", gr4: "Bag",      gr5: "Jewellery", gr6: "Headband", gr7: "Bouquet", gr8: "Shirt Keychain" };
  var BASE_PRICE = { gr1: 850, gr2: 400, gr3: 350, gr4: 1400, gr5: 550, gr6: 450, gr7: 1999, gr8: 450 };

  var REAL_PRODUCTS = {
    "seed_gr4_1": { name: "Bag 1", price: 1599 },
    "seed_gr7_1": { name: "Crochet Bridal Bouquet", price: 5500 },
    "seed_gr7_2": { name: "Handmade Crochet Rose Flower Gift Bouquet", price: 3999 },
    "seed_gr7_3": { name: "Handmade Crochet Flower Bouquet with Heart Accent", price: 3999 },
    "seed_gr7_4": { name: "Handmade Crochet Wedding Bridal Bouquet", price: 3999 },
    "seed_gr7_5": { name: "Handmade Crochet Jasmine Wedding Bridal Bouquet", price: 4999 },
    "seed_gr1_1": { name: "Crochet Rose Purse", price: 4999 },
    "seed_gr1_2": { name: "Crochet Rose Purse", price: 4999 },
    "seed_gr1_3": { name: "3D Rose Purse", price: 4999 },
    "seed_gr1_5": { name: "Monochromatic 3D Rose Blossom Crochet Hobo Purse", price: 5000 },
    "seed_gr1_10": { name: "Purse 10", price: 5799 },
    "seed_gr1_11": { name: "Purse 11", price: 5799 },
    "seed_gr1_12": { name: "Purse 12", price: 5799 },
    "seed_gr1_15": { name: "Purse 15", price: 5799 },
    "seed_gr1_16": { name: "Purse 16", price: 5799 },
    "seed_gr1_19": { name: "Purse 19", price: 5799 },
    "seed_gr1_20": { name: "Purse 20", price: 5799 },
  };
  var PRODUCT_PRICES = {
    "seed_gr1_4": 4500,
    "seed_gr1_6": 5500,
    "seed_gr1_7": 4500,
    "seed_gr1_8": 5500,
    "seed_gr1_9": 5500,
    "seed_gr1_13": 4500,
    "seed_gr1_14": 4500,
    "seed_gr1_16": 5799,
    "seed_gr1_17": 5799,
    "seed_gr1_18": 5500,
    "seed_gr1_21": 2500,
    "seed_gr1_22": 5500,
    "seed_gr1_23": 5500,
    "seed_gr1_24": 2500,
    "seed_gr1_25": 2500,
    "seed_gr1_26": 5500,
    "seed_gr1_27": 4500,
    "seed_gr1_28": 2500,
    "seed_gr1_29": 5500,
    "seed_gr1_30": 4500,
    "seed_gr1_31": 5500,
    "seed_gr1_32": 4500,
    "seed_gr1_33": 5500,
    "seed_gr2_1": 1199,
    "seed_gr2_2": 3999,
    "seed_gr2_3": 2499,
    "seed_gr2_4": 2499,
    "seed_gr2_5": 3999,
    "seed_gr2_6": 2499,
    "seed_gr2_7": 2499,
    "seed_gr2_8": 2499,
    "seed_gr2_9": 2499,
    "seed_gr2_10": 3999,
    "seed_gr2_11": 2499,
    "seed_gr2_12": 2499,
    "seed_gr2_13": 2499,
    "seed_gr2_14": 2499,
    "seed_gr3_1": 450,
    "seed_gr3_2": 450,
    "seed_gr3_3": 450,
    "seed_gr3_4": 450,
    "seed_gr3_5": 450,
    "seed_gr3_6": 450,
    "seed_gr3_7": 450,
    "seed_gr3_8": 450,
    "seed_gr3_9": 450,
    "seed_gr3_10": 450,
    "seed_gr3_11": 450,
    "seed_gr3_12": 450,
    "seed_gr3_13": 450,
    "seed_gr3_14": 450,
    "seed_gr3_15": 450,
    "seed_gr3_16": 450,
    "seed_gr3_17": 450,
    "seed_gr3_18": 450,
    "seed_gr3_19": 450,
    "seed_gr3_20": 450,
    "seed_gr4_1": 5999,
    "seed_gr4_2": 5999,
    "seed_gr5_1": 1499,
    "seed_gr5_2": 1499,
    "seed_gr5_3": 1499,
    "seed_gr5_4": 1499,
    "seed_gr5_5": 1599,
    "seed_gr5_6": 1499,
    "seed_gr5_7": 1599,
    "seed_gr5_8": 1499,
    "seed_gr5_9": 1499,
    "seed_gr6_1": 1299,
    "seed_gr6_2": 1299,
    "seed_gr6_3": 1299
  };
  var PRODUCT_KEYWORDS = {
    "seed_gr1_3": ["3d rose purse", "rose purse", "3d rose", "rose handbag", "crochet rose"]
  };
  var CATEGORY_KEYWORDS = {
    gr1: ["handbag", "purse", "crochet bag", "handmade", "gift", "woolen"],
    gr2: ["wedding", "eid", "hair", "flowers", "party", "gift"],
    gr3: ["keyring", "small gift", "cute", "handmade", "gift", "wholesale"],
    gr4: ["handbag", "tote", "shopper bag", "handmade", "gift"],
    gr5: ["necklace", "earrings", "bridal", "wedding", "gift", "accessory"],
    gr6: ["hairband", "hair accessory", "girl", "handmade", "gift"],
    gr7: ["bouquet", "flowers", "rose", "bride", "gift", "handmade"],
    gr8: ["gift", "shirt", "shirt keychain", "keychain", "keyring", "handmade", "small gift"]
  };

  /* Seed products whose subcategory is fixed rather than positional. Anything
     not listed falls back to the first subcategory of its category. */
  var PRODUCT_SUBCATEGORY = {
    "seed_gr8_1": "sg1"
  };

  function defaultProducts() {
    var settings = defaultSettings();
    var cats = settings.categories;
    var subs = settings.subcategories;
    var out = [];
    Object.keys(RAW_IMAGES).forEach(function (key) {
      var catIdx = parseInt(key.replace("gr", ""), 10) - 1;
      var label = cats[catIdx] || ITEM_NAME[key] || "Item";
      var name = ITEM_NAME[key] || label;
      var parentSubs = subs[key] || [];
      RAW_IMAGES[key].forEach(function (img, i) {
        var id = "seed_" + key + "_" + (i + 1);
        var real = REAL_PRODUCTS[id];
        var kw = (CATEGORY_KEYWORDS[key] || [label.toLowerCase()]).slice();
        if (PRODUCT_KEYWORDS[id]) kw = kw.concat(PRODUCT_KEYWORDS[id]);
        out.push({
          id: id,
          name: real ? real.name : name + " " + (i + 1),
          price: PRODUCT_PRICES[id] || (real ? real.price : (BASE_PRICE[key] || 500) + (i % 4) * 50),
          category: key,
          subcategory: PRODUCT_SUBCATEGORY[id] || (parentSubs.length ? subKey(0) : ""),
          image: HIDE_PRODUCT_IMAGES[key] || HIDE_PRODUCT_IMAGES[id] ? "" : img,
          keywords: kw,
          colors: [],
          status: "in stock",
          stock: null,
          gallery: []
        });
      });
    });
    return out;
  }

  function normalizeProduct(p) {
    var s = String((p && p.status) || "").trim().toLowerCase();
    var status = "in stock";
    if (s === "sold out" || s === "sold-out") status = "sold out";
    else if (s === "made to order" || s === "made-to-order") status = "made to order";
    var st = p && p.stock != null && p.stock !== "" ? Math.max(0, parseInt(p.stock, 10) || 0) : null;
    var gal = Array.isArray(p && p.gallery)
      ? p.gallery.filter(function (x) { return typeof x === "string" && x.trim(); })
      : [];
    /* subcategory is the positional "sgN" key inside the product's own
       category, so an empty string simply means "this product is filed
       straight under its category". */
    var sub = p && typeof p.subcategory === "string" ? p.subcategory.trim() : "";
    if (sub && subIndexOf(sub) < 0) sub = "";
    return Object.assign({}, p, { status: status, stock: st, gallery: gal, subcategory: sub });
  }

  /* ---------- v<19>.sql also mirrors this catalog ---------- */

  function defaultSettings() {
    var cats = [];
    for (var i = 0; i < DEFAULT_COUNT; i += 1) {
      cats.push(DEFAULT_NAMES[i] || EXTRA_CATEGORY_NAMES[i + 1] || "Category " + (i + 1));
    }
    return {
      categories: cats,
      subcategories: defaultSubcategories(),
      categoryImages: CATEGORY_IMAGE_SETS,
      whatsapp: "03075729901",
      whatsappCountry: "92",
      craftDays: 5,
      deliveryDays: 3,
      bankAccountTitle: "",
      bankAccountNo: "",
      bankIBAN: "",
      jazzcashNumber: "",
      easypaisaNumber: "",
      shippingFee: "",
      freeDeliveryMin: 2500,
      version: 4
    };
  }

  function normalizeSettings(raw) {
    var base = raw && typeof raw === "object" ? raw : {};
    var s = defaultSettings();

    var cats = Array.isArray(base.categories) ? base.categories : null;
    if (cats && cats.length) {
      /* A save made before a category existed holds fewer names than
         DEFAULT_COUNT. Keep those names and pad the rest with the defaults,
         otherwise raising DEFAULT_COUNT would throw the saved names away. */
      var saved = cats
        .map(function (c) { return typeof c === "string" ? c.trim() : ""; })
        .slice(0, DEFAULT_COUNT);
      s.categories = s.categories.map(function (fallback, i) { return saved[i] || fallback; });
    }
    if (base.subcategories && typeof base.subcategories === "object") {
      var sb2 = {};
      s.categories.forEach(function (_, i) {
        var k = "gr" + (i + 1);
        var list = base.subcategories[k];
        sb2[k] = Array.isArray(list)
          ? list.map(function (n) { return typeof n === "string" ? n.trim() : ""; }).filter(Boolean)
          : (s.subcategories[k] || []).slice();
      });
      s.subcategories = sb2;
    }
    if (base.categoryImages && typeof base.categoryImages === "object") {
      var ci = {};
      s.categories.forEach(function (_, i) {
        var k = "gr" + (i + 1);
        ci[k] = Array.isArray(base.categoryImages[k])
          ? base.categoryImages[k].slice(0, 5)
          : CATEGORY_IMAGE_SETS[k] || [];
      });
      s.categoryImages = ci;
    }
    if (base.whatsapp) s.whatsapp = base.whatsapp;
    if (base.whatsappCountry) s.whatsappCountry = base.whatsappCountry;
    if (base.adminPasswordHash) s.adminPasswordHash = base.adminPasswordHash;
    if (base.craftDays) s.craftDays = parseInt(base.craftDays, 10) || 5;
    if (base.deliveryDays) s.deliveryDays = parseInt(base.deliveryDays, 10) || 3;
    if (base.bankAccountTitle) s.bankAccountTitle = base.bankAccountTitle;
    if (base.bankAccountNo) s.bankAccountNo = base.bankAccountNo;
    if (base.bankIBAN) s.bankIBAN = base.bankIBAN;
    if (base.jazzcashNumber) s.jazzcashNumber = base.jazzcashNumber;
    if (base.easypaisaNumber) s.easypaisaNumber = base.easypaisaNumber;
    if (base.shippingFee != null && base.shippingFee !== "") s.shippingFee = parseFloat(base.shippingFee);
    if (base.freeDeliveryMin != null && base.freeDeliveryMin !== "") s.freeDeliveryMin = parseFloat(base.freeDeliveryMin);
    return s;
  }

  /* ---------- localStorage helpers (fallback) ---------- */
  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* ignore */ }
  }

  /* =============================================================
     PUBLIC API
     ============================================================= */

  function boot() {
    try {
      if (configured) {
        var sessionPromise = sb.auth.getSession().then(function (s) {
          return !!(s.data && s.data.session);
        }).catch(function () {
          return false;
        });

        return Promise.all([
          sb.from("products").select("*").order("created_at", { ascending: true }),
          sb.from("settings").select("data").eq("id", SETTINGS_ID).maybeSingle(),
          sessionPromise
        ]).then(function (results) {
          var prodRes = results[0];
          var setRes = results[1];
          var isAdminUser = results[2];
          if (prodRes.error) throw prodRes.error;
          if (setRes.error) throw setRes.error;

          products.length = 0;
          (prodRes.data || []).forEach(function (p) { products.push(normalizeProduct(p)); });

          settings = setRes.data && setRes.data.data
            ? normalizeSettings(setRes.data.data)
            : defaultSettings();

          GC.isAdmin = isAdminUser;

          // Only signed-in admins load order data. Anonymous visitors never
          // receive the order list (RLS + this gate), so no customer data
          // leaves the database through the pages.
          if (!isAdminUser) {
            orders.length = 0;
            return Promise.resolve();
          }
          return sb.from("orders").select("*").order("created_at", { ascending: false })
            .then(function (ordRes) {
              if (ordRes.error) throw ordRes.error;
              orders.length = 0;
              (ordRes.data || []).forEach(function (o) {
                orders.push(orderFromRow(o));
              });
              _setupRealtimeSubscriptions();
            })
            .catch(function (e) {
              console.warn("Could not load orders:", e);
              orders.length = 0;
            });
        }).catch(function (e) {
          console.warn("Could not load shared data:", e);
        });
      }

      products.length = 0;
      var fallbackProducts = lsGet(LOCAL_PRODUCTS, defaultProducts());
      (fallbackProducts || []).forEach(function (p) { products.push(normalizeProduct(p)); });
      if (!localStorage.getItem(LOCAL_PRODUCTS)) lsSet(LOCAL_PRODUCTS, products);
      settings = normalizeSettings(lsGet(LOCAL_SETTINGS, null));
      orders.length = 0;
      (lsGet(LOCAL_ORDERS, []) || []).forEach(function (o) { orders.push(o); });
      try {
        GC.isAdmin = localStorage.getItem(LOCAL_ADMIN_SESSION) === "1";
      } catch (e) { GC.isAdmin = false; }
      return Promise.resolve();
    } catch (e) {
      console.warn("Could not load shared data:", e);
      return Promise.resolve();
    }
  }

  /* ---------- Realtime subscriptions ---------- */
  function _setupRealtimeSubscriptions() {
    if (!configured || !sb) return;

    try {
      var channel = sb
        .channel("orders-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, function (payload) {
          _handleOrderChange(payload);
        })
        .subscribe();
      _orderSubscriptions.push(channel);
    } catch (e) {
      console.warn("Realtime subscription failed:", e);
    }
  }

  function _handleOrderChange(payload) {
    var eventType = payload.eventType;
    var row = payload.new || payload.old;

    if (eventType === "INSERT" && row) {
      var existing = orders.find(function (o) { return o.id === row.id; });
      if (!existing) {
        orders.unshift(orderFromRow(row));
      }
    } else if (eventType === "UPDATE" && row) {
      var idx = orders.findIndex(function (o) { return o.id === row.id; });
      var updated = orderFromRow(row);
      if (idx !== -1) {
        orders[idx] = updated;
      } else {
        orders.unshift(updated);
      }
    } else if (eventType === "DELETE" && row) {
      orders = orders.filter(function (o) { return o.id !== row.id; });
    }

    if (_onOrdersChanged) {
      try { _onOrdersChanged(orders); } catch (e) { /* ignore */ }
    }
  }

  /* ============================================================= */

  var GC = {
    /* A live getter, not a snapshot: `configured` is only decided once the
       SDK has loaded, which is after this object is built. */
    get configured() { return configured; },
    isAdmin: false,
    get products() { return products; },
    get settings() { return settings; },
    get orders() { return orders; },

    /* ---- boot ---- */
    init: function () {
      return bootPromise;
    },

    /* ---- auth ---------- */
    signInAdmin: async function (email, password) {
      if (configured) {
        var res = await sb.auth.signInWithPassword({ email: email, password: password });
        if (res.error) return false;
        GC.isAdmin = true;
        return true;
      }
      GC.isAdmin = true;
      try { localStorage.setItem(LOCAL_ADMIN_SESSION, "1"); } catch (e) { /* ignore */ }
      return true;
    },

    signOutAdmin: async function () {
      if (configured) await sb.auth.signOut();
      GC.isAdmin = false;
      try { localStorage.removeItem(LOCAL_ADMIN_SESSION); } catch (e) { /* ignore */ }
      return true;
    },

    checkAdminSession: async function () {
      if (!configured) {
        try {
          GC.isAdmin = localStorage.getItem(LOCAL_ADMIN_SESSION) === "1";
        } catch (e) { GC.isAdmin = false; }
        return GC.isAdmin;
      }
      var res = await sb.auth.getSession();
      GC.isAdmin = !!(res.data && res.data.session);
      return GC.isAdmin;
    },

    /* ---- realtime callback ---- */
    onOrdersChanged: function (callback) {
      _onOrdersChanged = callback;
    },

    // Re-read localStorage (unconfigured mode) so shared browser tabs pick
    // up new orders. No-op when Supabase is configured (realtime handles it).
    refreshLocalData: function () {
      if (configured) return Promise.resolve();
      try {
        products.length = 0;
        (lsGet(LOCAL_PRODUCTS, defaultProducts()) || []).forEach(function (p) { products.push(normalizeProduct(p)); });
        orders.length = 0;
        (lsGet(LOCAL_ORDERS, []) || []).forEach(function (o) { orders.push(o); });
      } catch (e) { /* ignore */ }
      if (_onOrdersChanged) {
        try { _onOrdersChanged(orders); } catch (e) { /* ignore */ }
      }
      return Promise.resolve();
    },

    /* ---- customer profile (auto-fill) ---- */
    saveCustomerProfile: function (profile) {
      try { lsSet(LOCAL_CUSTOMER, profile); } catch (e) { /* ignore */ }
    },

    getCustomerProfile: function () {
      return lsGet(LOCAL_CUSTOMER, null);
    },

    /* ---- orders lookup by phone ---- */
    getOrdersByPhone: function (phone) {
      var norm = String(phone || "").replace(/[^\d]/g, "").replace(/^0+/, "");
      if (!norm) return [];
      return orders.filter(function (o) {
        return String(o.customer && o.customer.phone || "").replace(/[^\d]/g, "").replace(/^0+/, "") === norm;
      });
    },

    /* ---- customer order lookup (tracking page) ----
       Server-side when Supabase is configured: returns only the orders
       matching the given order id or phone number via an RPC function,
       so visitors can never pull the full order list. */
    lookupOrders: async function (query) {
      var value = String(query || "").trim();
      if (!value) return [];
      if (!configured) {
        var upper = value.toUpperCase();
        var phoneNorm = value.replace(/[^\d]/g, "").replace(/^0+/, "");
        var byId = orders.find(function (o) {
          return String(o.id || "").toUpperCase() === upper;
        });
        if (byId) return [byId];
        return orders.filter(function (o) {
          return String(o.customer && o.customer.phone || "").replace(/[^\d]/g, "").replace(/^0+/, "") === phoneNorm;
        });
      }
      try {
        var res = await sb.rpc("get_customer_orders", { search: value, max_results: 50 });
        if (res.error) return [];
        return (res.data || []).map(orderFromRow);
      } catch (e) {
        return [];
      }
    },

    /* ---- order search (admin) ---- */
    searchOrders: function (query, statusFilter) {
      var q = String(query || "").toLowerCase().trim();
      var sf = String(statusFilter || "").trim();
      return orders.filter(function (o) {
        if (sf && (o.status || "Pending") !== sf) return false;
        if (!q) return true;
        var cust = o.customer || {};
        var pay = o.payment || {};
        var haystack = [
          o.id || "",
          cust.name || "",
          cust.phone || "",
          cust.email || "",
          cust.city || "",
          cust.address || "",
          cust.notes || "",
          o.status || "",
          pay.method || "",
          pay.status || ""
        ].join(" ").toLowerCase();
        return haystack.indexOf(q) !== -1;
      });
    },

    /* ---- order stats (admin dashboard) ---- */
    getOrderStats: function () {
      var total = orders.length;
      var pending = 0;
      var confirmed = 0;
      var processing = 0;
      var shipped = 0;
      var delivered = 0;
      var cancelled = 0;
      var revenue = 0;
      var cancelled = 0;
      var paidCount = 0;
      var todayOrders = 0;
      var today = new Date().toDateString();

      orders.forEach(function (o) {
        var s = (o.status || "Pending").toLowerCase();
        if (s === "pending") pending++;
        else if (s === "confirmed") confirmed++;
        else if (s === "processing") processing++;
        else if (s === "shipped") shipped++;
        else if (s === "delivered") delivered++;
        else if (s === "cancelled") cancelled++;

        if ((o.payment && o.payment.status || "Pending").toLowerCase() === "paid") paidCount++;

        if (s !== "cancelled") revenue += parseFloat(o.total) || 0;

        try {
          if (new Date(o.placedAt).toDateString() === today) todayOrders++;
        } catch (e) { /* ignore */ }
      });

      return {
        total: total,
        pending: pending,
        confirmed: confirmed,
        processing: processing,
        shipped: shipped,
        delivered: delivered,
        cancelled: cancelled,
        revenue: revenue,
        todayOrders: todayOrders,
        paidCount: paidCount
      };
    },

    /* ---- bulk operations ---- */
    bulkUpdateStatus: async function (ids, status, note) {
      if (!ids.length) return { ok: true };

      var updated = [];
      ids.forEach(function (id) {
        var o = orders.find(function (x) { return x.id === id; });
        var before = (o && o.updatedAt) || (o && o.placedAt) || "";
        GC.applyStatus(o, status, note);
        if (o && (o.updatedAt || "") !== before) updated.push(o);
      });

      if (!configured) {
        lsSet(LOCAL_ORDERS, orders);
        return { ok: true };
      }

      var results = await Promise.all(
        updated.map(function (o) {
          return sb.from("orders").update({
            status: o.status,
            status_history: o.statusHistory,
            est_delivery: o.estDelivery,
            updated_at: o.updatedAt
          }).eq("id", o.id);
        })
      );

      var anyError = results.some(function (r) { return r.error; });
      return { ok: !anyError };
    },

    bulkDeleteOrders: async function (ids) {
      if (!ids.length) return { ok: true };

      orders = orders.filter(function (o) { return ids.indexOf(o.id) === -1; });

      if (!configured) {
        lsSet(LOCAL_ORDERS, orders);
        return { ok: true };
      }

      var results = await Promise.all(
        ids.map(function (id) {
          return sb.from("orders").delete().eq("id", id);
        })
      );

      var anyError = results.some(function (r) { return r.error; });
      return { ok: !anyError };
    },

    /* ---- products ---- */
    saveProduct: async function (product) {
      var idx = products.findIndex(function (p) { return p.id === product.id; });
      if (idx !== -1) products[idx] = product;
      else products.unshift(product);

      if (!configured) {
        lsSet(LOCAL_PRODUCTS, products);
        return { ok: true };
      }
      var row = {
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category,
        image: product.image || "",
        keywords: product.keywords || [],
        colors: product.colors || [],
        status: product.status || "in stock",
        stock: product.stock != null ? product.stock : null,
        gallery: product.gallery || []
      };
      if (!subcategoryColumnMissing) row.subcategory = product.subcategory || "";
      var res = await sb.from("products").upsert(row, { onConflict: "id" });
      if (res.error && isMissingSubcategoryColumn(res.error)) {
        /* An un-migrated database rejects the whole row over the new column.
           Drop it, remember that, and keep saving everything else rather than
           losing the product edit. GC.subcategoryColumnMissing turns the admin
           panel warning on. */
        subcategoryColumnMissing = true;
        delete row.subcategory;
        res = await sb.from("products").upsert(row, { onConflict: "id" });
      }
      return { ok: !res.error, error: res.error };
    },

    deleteProduct: async function (id) {
      products = products.filter(function (p) { return p.id !== id; });

      if (!configured) {
        lsSet(LOCAL_PRODUCTS, products);
        return { ok: true };
      }
      var res = await sb.from("products").delete().eq("id", id);
      return { ok: !res.error, error: res.error };
    },

    // All items are always available, so placing an order never reserves
    // or flips a product to sold out.
    reserveProducts: async function (items) {
      return { ok: true };
    },

    /* ---- settings ---- */
    saveSettings: async function (next) {
      settings = normalizeSettings(next);
      if (!configured) {
        lsSet(LOCAL_SETTINGS, settings);
        return { ok: true };
      }
      var res = await sb.from("settings").upsert(
        { id: SETTINGS_ID, data: settings },
        { onConflict: "id" }
      );
      return { ok: !res.error, error: res.error };
    },

    /* ---- orders ---- */
    saveOrder: async function (order) {
      // Normalize a full order model so callers can pass partial data.
      order.statusHistory = Array.isArray(order.statusHistory)
        ? order.statusHistory
        : [{ status: order.status || "Pending", at: order.placedAt || new Date().toISOString() }];
      if (typeof order.payment === "string" || !order.payment) {
        order.payment = {
          method: typeof order.payment === "string" ? order.payment : "Cash on delivery",
          status: "Pending"
        };
      }
      if (!order.payment.method) order.payment.method = "Cash on delivery";
      if (!order.payment.status) order.payment.status = "Pending";
      order.estDelivery = order.estDelivery || GC.deliveryEstimate(order.placedAt);
      order.updatedAt = order.placedAt || new Date().toISOString();
      orders.unshift(order);

      /* Local mirror is written synchronously, so the order is never
         lost even if the browser navigates away mid-request. */
      lsSet(LOCAL_ORDERS, orders);

      if (!configured) return { ok: true };
      var row = orderToRow(order);
      var res = await sb.from("orders").upsert(row, { onConflict: "id" });
      return { ok: !res.error, error: res.error };
    },

    /* Fire-and-forget order push that survives the page navigating away.
       Uses fetch keepalive so the request is not cancelled on unload, which
       is what lets us jump straight to WhatsApp with zero perceived delay. */
    saveOrderKeepalive: function (order) {
      try {
        /* localStorage mirror first — instant and offline-safe */
        this.saveOrder(order);
      } catch (e) { /* fall through to the network push */ }

      if (!configured || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
      try {
        var row = orderToRow(order);
        fetch(cfg.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/orders?onConflict=id", {
          method: "POST",
          keepalive: true,
          mode: "cors",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": cfg.supabaseAnonKey,
            "Authorization": "Bearer " + cfg.supabaseAnonKey,
            "Prefer": "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify(row)
        }).catch(function () {});
      } catch (e) { /* non-fatal: the local mirror already has the order */ }
    },

    updateOrderStatus: async function (id, status, note) {
      var o = orders.find(function (x) { return x.id === id; });
      GC.applyStatus(o, status, note);

      if (!configured) {
        lsSet(LOCAL_ORDERS, orders);
        return { ok: true };
      }
      var patch = {
        status: status,
        status_history: o ? o.statusHistory : [],
        est_delivery: o ? o.estDelivery : null,
        updated_at: new Date().toISOString()
      };
      var res = await sb.from("orders").update(patch).eq("id", id);
      return { ok: !res.error, error: res.error };
    },

    markOrderPaid: async function (id) {
      var o = orders.find(function (x) { return x.id === id; });
      if (!o) return { ok: true };
      if (!o.payment) o.payment = { method: "Cash on delivery", status: "Pending" };
      o.payment.status = "Paid";
      o.updatedAt = new Date().toISOString();

      if (!configured) {
        lsSet(LOCAL_ORDERS, orders);
        return { ok: true };
      }
      var res = await sb.from("orders").update({
        payment_status: "Paid",
        updated_at: o.updatedAt
      }).eq("id", id);
      return { ok: !res.error, error: res.error };
    },

    deleteOrder: async function (id) {
      orders = orders.filter(function (o) { return o.id !== id; });
      if (!configured) {
        lsSet(LOCAL_ORDERS, orders);
        return { ok: true };
      }
      var res = await sb.from("orders").delete().eq("id", id);
      return { ok: !res.error, error: res.error };
    },

    /* ---- images ---- */
    uploadImage: async function (fileOrDataUrl) {
      if (configured) {
        try {
          var ext = "webp";
          var name = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
          var res = await sb.storage
            .from(cfg.storageBucket || "shop-images")
            .upload(name, fileOrDataUrl, {
              contentType: fileOrDataUrl.type || "image/webp",
              upsert: true
            });
          if (res.error) throw res.error;
          var pub = sb.storage
            .from(cfg.storageBucket || "shop-images")
            .getPublicUrl(name);
          return { url: pub.data.publicUrl };
        } catch (e) {
          console.warn("Storage upload failed, saving as data URL:", e);
        }
      }
      return { url: fileOrDataUrl };
    },

    /* ---- shop whatsapp ---- */
    /* Returns the FULL international number (e.g. 923001234567) with no
       leading zero, which is what wa.me and api.whatsapp.com require.
       Without the country code the link silently fails to open a chat. */
    shopWhatsApp: function () {
      var raw = String(GC.settings.whatsapp || "03075729901").replace(/[^\d]/g, "");
      var cc = String(GC.settings.whatsappCountry || "92").replace(/[^\d]/g, "") || "92";
      if (!raw) return "";
      /* already stored in international form */
      if (raw.length > cc.length && raw.slice(0, cc.length) === cc) return raw;
      return cc + raw.replace(/^0+/, "");
    },

    /* Customer phone numbers are stored without the local trunk 0 (that's the
       form used to match repeat customers), so printing them with a bare "+"
       would hand out a broken number like "+3001234567". Put the country code
       back for display. Numbers already saved in international form are
       returned untouched. */
    formatPhone: function (raw) {
      var d = String(raw || "").replace(/[^\d]/g, "");
      if (!d) return "";
      var cc = String(GC.settings.whatsappCountry || "92").replace(/[^\d]/g, "") || "92";
      var bare = d.replace(/^0+/, "");
      if (!bare) return "";
      if (bare.length > cc.length && bare.slice(0, cc.length) === cc) return "+" + bare;
      return "+" + cc + bare;
    },

    /* ---- order system constants & helpers ---- */
    ORDER_STATUSES: ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"],

    makeOrderId: function () {
      var d = new Date();
      var ymd = String(d.getFullYear()) +
        String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0");
      var rand = Math.random().toString(36).toUpperCase().slice(2, 8);
      var code = (rand + "ABCD") .slice(0, 4);
      return "GC-" + ymd + "-" + code;
    },

    // Estimated delivery date as ISO string.
    // shipOnly=true counts only delivery days (used once an order is Shipped).
    deliveryEstimate: function (fromISO, shipOnly) {
      var s = GC.settings || {};
      var craft = shipOnly ? 0 : (parseInt(s.craftDays, 10) || 5);
      var delivery = parseInt(s.deliveryDays, 10) || 3;
      try {
        var d = fromISO ? new Date(fromISO) : new Date();
        d.setDate(d.getDate() + craft + delivery);
        return d.toISOString();
      } catch (e) {
        return new Date(Date.now() + (craft + delivery) * 86400000).toISOString();
      }
    },

    // Records a timestamped status change on an order (idempotent).
    applyStatus: function (order, status, note) {
      if (!order) return;
      var s = String(status || "").trim();
      if (!s) return;
      order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
      var last = order.statusHistory[order.statusHistory.length - 1];
      if (last && last.status === s && !note) return;
      order.statusHistory.push({
        status: s,
        at: new Date().toISOString(),
        note: note || ""
      });
      if (s.toLowerCase() === "cancelled") {
        order.estDelivery = null;
      } else if (s.toLowerCase() === "shipped") {
        order.estDelivery = GC.deliveryEstimate(new Date().toISOString(), true);
      }
      order.status = s;
      order.updatedAt = new Date().toISOString();
    },

    /* ---- order lookup by order number ---- */
    getOrderById: function (id) {
      var norm = String(id || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (!norm) return null;
      return orders.find(function (o) {
        return String(o.id || "").toUpperCase() === norm;
      }) || null;
    },
  };

  /* ---------- row mappers ---------- */
  function orderToRow(o) {
    var c = o.customer || {};
    var pay = o.payment || {};
    var method = typeof o.payment === "string" ? o.payment : (pay.method || "Cash on delivery");
    return {
      id: o.id,
      phone: String(c.phone || "").replace(/[^\d]/g, "").replace(/^0+/, ""),
      customer_name: c.name || "",
      email: c.email || "",
      address: c.address || "",
      city: c.city || "",
      province: c.province || "",
      landmark: c.landmark || "",
      notes: c.notes || "",
      items: o.items || [],
      total: o.total || 0,
      payment_method: method,
      payment_status: (typeof o.payment === "string" ? "Pending" : (pay.status || "Pending")),
      payment: method,
      status: o.status || "Pending",
      status_history: o.statusHistory || [],
      est_delivery: o.estDelivery || null,
      craft_days: o.craftDays || null,
      delivery_days: o.deliveryDays || null,
      placed_at: o.placedAt || new Date().toISOString(),
      updated_at: o.updatedAt || o.placedAt || new Date().toISOString()
    };
  }

  function orderFromRow(r) {
    var method = r.payment_method || r.payment || "Cash on delivery";
    var history = Array.isArray(r.status_history) && r.status_history.length
      ? r.status_history
      : [{ status: r.status || "Pending", at: r.placed_at || r.created_at || new Date().toISOString(), note: "" }];
    return {
      id: r.id,
      placedAt: r.placed_at || r.created_at,
      updatedAt: r.updated_at || r.placed_at || r.created_at,
      customer: {
        name: r.customer_name || "",
        phone: r.phone || "",
        email: r.email || "",
        address: r.address || "",
        city: r.city || "",
        province: r.province || "",
        landmark: r.landmark || "",
        notes: r.notes || ""
      },
      items: r.items || [],
      total: r.total || 0,
      payment: {
        method: method,
        status: r.payment_status || "Pending"
      },
      status: r.status || "Pending",
      statusHistory: history,
      estDelivery: r.est_delivery || null,
      craftDays: r.craft_days || null,
      deliveryDays: r.delivery_days || null
    };
  }

  window.GC = GC;

  /* The SDK (when configured) has to be in place before boot() decides
     between Supabase and localStorage, so gate the first read on it. */
  var bootPromise = loadSdk().then(function () {
    connect();
    return boot();
  });
})();
