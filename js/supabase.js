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
  var LOCAL_PRODUCTS = "gulnish-products-v54";
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

  /* products.subcategory and products.price_max both arrived after the rest of
     the products table, so a database that has not run the latest supabase
     SQL rejects the entire upsert with PGRST204. Rather than lose the edit,
     we detect that once, drop the column from the row and flag it so the
     admin panel can say so out loud. */
  var subcategoryColumnMissing = false;
  var priceMaxColumnMissing = false;
  function isMissingColumn(err, column) {
    if (!err) return false;
    var text = [err.code, err.message, err.details, err.hint]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.indexOf(column) !== -1 &&
      (text.indexOf("could not find") !== -1 ||
        text.indexOf("pgrst204") !== -1 ||
        text.indexOf("does not exist") !== -1);
  }
  function isMissingSubcategoryColumn(err) {
    return isMissingColumn(err, "subcategory");
  }
  function isMissingPriceMaxColumn(err) {
    return isMissingColumn(err, "price_max");
  }

  /* ---------- default settings (mirrors original) ---------- */

  /* Categories are positional: the key for the category at index i is
     "gr" + (i + 1), and every product stores that key verbatim. Re-ordering,
     merging or removing a category therefore re-points every product whose
     key moves, so TAXONOMY_VERSION below is how a layout change tells saved
     settings (localStorage or the settings table) to adopt the new shape
     instead of keeping names that now sit on the wrong products. */
  var DEFAULT_COUNT = 4;
  var DEFAULT_NAMES = ["Purses/Bags", "Wedding Gift", "Small Gifts", "School Items"];

  /* Subcategories are positional inside their parent, so the key is "sg" +
     (index + 1) and is only ever read alongside the product's own category.
     A blank entry list means "no subcategories". */
  var EXTRA_SUBCATEGORY_NAMES = {
    1: ["Purses", "Bags"],
    2: ["Gajrays", "Jewellery", "Bouquet"],
    3: ["Keychains", "Headband"],
    4: ["Geometry", "Pencil", "Pencil Box"]
  };

  /* Bump whenever the category list, their order, or their subcategories
     change. Saved settings stamped with an older value keep their WhatsApp
     number, bank details and delivery times, but take the new taxonomy. */
  var TAXONOMY_VERSION = 9;

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
    gr1: ["images/purses/purse-1.webp", "images/purses/purse-2.webp", "images/purses/purse-23.webp", "images/bags/bag-1.webp", "images/purses/purse-24.webp"],
    /* Wedding Gift borrows the bridal bouquet shots: they are the most
       wedding-specific photos in the catalog and they are not hidden. */
    gr2: ["images/bouquets/bouquet-1.webp", "images/bouquets/bouquet-4.webp", "images/bouquets/bouquet-5.webp", "images/jewellery/jewellery-1.webp", "images/jewellery/jewellery-4.webp"],
    /* Small Gifts: the keychain shots, then the headband shots. */
    gr3: ["images/keychains/keychain-1.webp", "images/keychains/keychain-2.webp", "images/headbands/headband-1.webp", "images/headbands/headband-2.webp"],
    /* School Items: the geometry shots lead, then the pencils, so the home
       card no longer shows the photo-pending slot. */
    gr4: ["images/geometry/geometry-1.webp", "images/geometry/geometry-2.webp", "images/geometry/geometry-5.webp", "images/pencil/pencil-1.webp", "images/pencil/pencil-5.webp"]
  };

  /* Keys may be a whole group (gajrays) or a single product id. A product with
     no image still lists and still orders - the grid, category card and
     product page all fall back to photoPendingHTML(), which shows
     "The picture will be uploaded soon. However, you can customize your
     design directly on WhatsApp." */
  var HIDE_PRODUCT_IMAGES = {
    gajrays: true,
    "seed_purses_6": true,
    "seed_purses_7": true
  };

  /* ---------- placeholder product catalog ---------- */
  /* Groups are named after what the photos are, not after where they end up in
     the shop, so SEED_PLACEMENT below can file them under a category and a
     subcategory independently. */
  var RAW_IMAGES = {
    purses: ["images/purses/purse-1.webp", "images/purses/purse-2.webp", "images/purses/purse-3.webp", "images/purses/purse-4.webp", "images/purses/purse-5.webp", "images/purses/purse-6.webp", "images/purses/purse-7.webp", "images/purses/purse-8.webp", "images/purses/purse-9.webp", "images/purses/purse-10.webp", "images/purses/purse-11.webp", "images/purses/purse-12.webp", "images/purses/purse-13.webp", "images/purses/purse-14.webp", "images/purses/purse-15.webp", "images/purses/purse-16.webp", "images/purses/purse-17.webp", "images/purses/purse-18.webp", "images/purses/purse-19.webp", "images/purses/purse-20.webp", "images/purses/purse-21.webp", "images/purses/purse-22.webp", "images/purses/purse-23.webp", "images/purses/purse-24.webp", "images/purses/purse-25.webp", "images/purses/purse-26.webp", "images/purses/purse-27.webp", "images/purses/purse-28.webp", "images/purses/purse-29.webp", "images/purses/purse-30.webp", "images/purses/purse-31.webp", "images/purses/purse-32.webp", "images/purses/purse-33.webp"],
    bags: ["images/bags/bag-1.webp", "images/bags/bag-2.webp", "images/bags/bag-3.webp", "images/bags/bag-4.webp"],
    gajrays: ["images/gajrays/gajray-1.webp", "images/gajrays/gajray-9.webp", "images/gajrays/gajray-4.webp", "images/gajrays/gajray-5.webp", "images/gajrays/gajray-6.webp", "images/gajrays/gajray-8.webp", "images/gajrays/gajray-10.webp", "images/gajrays/gajray-11.webp", "images/gajrays/gajray-12.webp", "images/gajrays/gajray-13.webp", "images/gajrays/gajray-14.webp", "images/gajrays/gajray-15.webp", "images/gajrays/gajray-16.webp", "images/gajrays/gajray-17.webp"],
    jewellery: ["images/jewellery/jewellery-1.webp", "images/jewellery/jewellery-2.webp", "images/jewellery/jewellery-3.webp", "images/jewellery/jewellery-4.webp", "images/jewellery/jewellery-5.webp", "images/jewellery/jewellery-6.webp", "images/jewellery/jewellery-7.webp", "images/jewellery/jewellery-8.webp", "images/jewellery/jewellery-9.webp"],
    headbands: ["images/headbands/headband-1.webp", "images/headbands/headband-2.webp", "images/headbands/headband-3.webp"],
    bouquets: ["images/bouquets/bouquet-1.webp", "images/bouquets/bouquet-2.webp", "images/bouquets/bouquet-3.webp", "images/bouquets/bouquet-4.webp", "images/bouquets/bouquet-5.webp", "images/bouquets/bouquet-6.webp", "images/bouquets/bouquet-7.webp"],
    keychains: ["images/keychains/keychain-1.webp", "images/keychains/keychain-2.webp", "images/keychains/keychain-3.webp", "images/keychains/keychain-4.webp", "images/keychains/keychain-5.webp", "images/keychains/keychain-6.webp", "images/keychains/keychain-7.webp", "images/keychains/keychain-8.webp", "images/keychains/keychain-9.webp", "images/keychains/keychain-10.webp", "images/keychains/keychain-11.webp", "images/keychains/keychain-12.webp", "images/keychains/keychain-13.webp", "images/keychains/keychain-14.webp", "images/keychains/keychain-15.webp", "images/keychains/keychain-16.webp", "images/keychains/keychain-17.webp", "images/keychains/keychain-18.webp", "images/keychains/keychain-19.webp", "images/keychains/keychain-20.webp"],
    geometry: ["images/geometry/geometry-1.webp", "images/geometry/geometry-2.webp", "images/geometry/geometry-3.webp", "images/geometry/geometry-4.webp", "images/geometry/geometry-5.webp", "images/geometry/geometry-6.webp", "images/geometry/geometry-7.webp", "images/geometry/geometry-8.webp"],
    pencil: ["images/pencil/pencil-1.webp", "images/pencil/pencil-2.webp", "images/pencil/pencil-3.webp", "images/pencil/pencil-4.webp", "images/pencil/pencil-5.webp", "images/pencil/pencil-6.webp", "images/pencil/pencil-7.webp", "images/pencil/pencil-8.webp", "images/pencil/pencil-9.webp", "images/pencil/pencil-10.webp", "images/pencil/pencil-11.webp", "images/pencil/pencil-12.webp", "images/pencil/pencil-13.webp"],
    /* Listed before their photos are. PLACEHOLDER_COUNTS below says how many
       products each one should produce; drop real paths into RAW_IMAGES later
       and the same entries become ordinary photo-backed products. */
    pencilbox: []
  };

  /* How many products to generate for a group that has no photos yet. */
  var PLACEHOLDER_COUNTS = { pencilbox: 3 };

  /* Which category (and subcategory) each photo group is filed under. Gajrays,
     Jewellery and Bouquet are separate top-level categories no longer; they
     are the three branches of Wedding Gift. The four bags used to be their own
     category too, and are now the second branch of Purse/Bags. */
  var SEED_PLACEMENT = {
    purses: { category: "gr1", subcategory: "sg1" },
    bags: { category: "gr1", subcategory: "sg2" },
    gajrays: { category: "gr2", subcategory: "sg1" },
    jewellery: { category: "gr2", subcategory: "sg2" },
    bouquets: { category: "gr2", subcategory: "sg3" },
    headbands: { category: "gr3", subcategory: "sg2" },
    keychains: { category: "gr3", subcategory: "sg1" },
    geometry: { category: "gr4", subcategory: "sg1" },
    pencil: { category: "gr4", subcategory: "sg2" },
    pencilbox: { category: "gr4", subcategory: "sg3" }
  };

  var ITEM_NAME  = { purses: "Purse", bags: "Bag", gajrays: "Gajray", jewellery: "Jewellery", headbands: "Headband", bouquets: "Bouquet", keychains: "Keychain", geometry: "Geometry", pencil: "Pencil", pencilbox: "Pencil Box" };
  var BASE_PRICE = { purses: 850, bags: 1500, gajrays: 400, jewellery: 550, headbands: 450, bouquets: 1999, keychains: 350 };

  /* Every entry carries the two ends of what the item costs. "price" is the
     published figure and the number the cart adds up to; "priceMax" is the
     upper end of the quote, shown as a range ("Rs. 3,000 - Rs. 6,500") so a
     shopper sees the spread before asking for the exact figure. The real price
     depends on the size and detail work asked for, so it is confirmed on
     WhatsApp - the low end is only the published base. A product with no
     priceMax is a single fixed price and is printed on its own. */
  var REAL_PRODUCTS = {
    /* The four bags were their own category until they were merged into
       Purse/Bags, so they now sit at the end of gr1's list. Their names and
       prices are carried over unchanged. */
    "seed_bags_1": { name: "Bag 1", price: 5999 },
    "seed_bags_2": { name: "Bag 2", price: 5999 },
    "seed_bags_3": { name: "Bag 3", price: 1500 },
    "seed_bags_4": { name: "Bag 4", price: 1550 },
    "seed_bouquets_1": { name: "Crochet Bridal Bouquet", price: 5500 },
    "seed_bouquets_2": { name: "Handmade Crochet Rose Flower Gift Bouquet", price: 3999 },
    "seed_bouquets_3": { name: "Handmade Crochet Flower Bouquet with Heart Accent", price: 3999 },
    "seed_bouquets_4": { name: "Handmade Crochet Wedding Bridal Bouquet", price: 3999 },
    "seed_bouquets_5": { name: "Handmade Crochet Jasmine Wedding Bridal Bouquet", price: 4999 },
    "seed_purses_1": { name: "Handmade 3D Crochet Rose Handbag", price: 3000, priceMax: 6500 },
    "seed_purses_2": { name: "Handmade 3D Crochet Rose Handbag", price: 3000, priceMax: 6500 },
    "seed_purses_3": { name: "Handmade Crochet 3D Rose Crescent Shoulder Bag", price: 3000, priceMax: 6500 },
    "seed_purses_4": { name: "3D Rose Granny Square Tote Bag", price: 4500, priceMax: 5500 },
    "seed_purses_5": { name: "Monochromatic 3D Rose Blossom Crochet Hobo Purse", price: 5000 },
    "seed_purses_8": { name: "Handmade Crochet 3D Butterfly Crossbody Purse", price: 3800, priceMax: 5000 },
    "seed_purses_9": { name: "Handmade Crochet Sunflower Granny Square Shoulder Bag", price: 4500, priceMax: 6000 },
    "seed_purses_10": { name: "Handmade 3D Rose Clutch Bag with Round Metal Handle", price: 5500, priceMax: 8500 },
    "seed_purses_11": { name: "Handmade 3D Rose Flower Sling Bag with Leaves", price: 4200, priceMax: 5500 },
    "seed_purses_12": { name: "Handmade 3D Crochet Rose Round Cantaloupe Bag", price: 5000, priceMax: 6800 },
    "seed_purses_13": { name: "Handmade Crochet Sunflower Flap Clutch", price: 3800, priceMax: 5000 },
    "seed_purses_14": { name: "Handmade Square 3D Rose Crochet Handbag", price: 5000, priceMax: 6500 },
    "seed_purses_15": { name: "Handmade 3D Tricolor Rose Circle Handbag", price: 6000, priceMax: 8500 },
    "seed_purses_16": { name: "Handmade 3D Crochet Rose Circle Clutch with Pearl Strap", price: 5500, priceMax: 7500 },
    "seed_purses_17": { name: "Handmade Metallic Crochet Rose Clutch with Gold Ring Handle", price: 6500, priceMax: 9500 },
    "seed_purses_18": { name: "Handmade Multi-Color Granny Square Crossbody Bag", price: 4500, priceMax: 6000 },
    "seed_purses_19": { name: "Handmade 3D Crochet Rose Handbag with Pearl Arched Handle", price: 5500, priceMax: 7800 },
    "seed_purses_20": { name: "Handmade 3D Crochet Rose Clutch with D-Ring Metal Handle", price: 5500, priceMax: 7500 },
    "seed_purses_21": { name: "Handmade Crochet Coquette Bow Shoulder Bag", price: 3800, priceMax: 5500 },
    "seed_purses_22": { name: "Handmade Crochet 3D Daisy Flower Tote Bag with Pearl Strap", price: 5500, priceMax: 7500 },
    "seed_purses_23": { name: "Handmade Ribbed Crochet Tassel Bag with Leather Handle", price: 6500, priceMax: 9500 },
    "seed_purses_24": { name: "Handmade Crochet Crescent Shoulder Bag with Flower Charm", price: 4500, priceMax: 6000 },
  };
  var PRODUCT_PRICES = {
    "seed_purses_6": 5500,
    "seed_purses_7": 4500,
    "seed_purses_14": 4500,
    "seed_purses_16": 5799,
    "seed_purses_17": 5799,
    "seed_purses_18": 5500,
    "seed_purses_21": 2500,
    "seed_purses_22": 5500,
    "seed_purses_23": 5500,
    "seed_purses_24": 2500,
    "seed_purses_25": 2500,
    "seed_purses_26": 5500,
    "seed_purses_27": 4500,
    "seed_purses_28": 2500,
    "seed_purses_29": 5500,
    "seed_purses_30": 4500,
    "seed_purses_31": 5500,
    "seed_purses_32": 4500,
    "seed_purses_33": 5500,
    "seed_gajrays_1": 1199,
    "seed_gajrays_2": 3999,
    "seed_gajrays_3": 2499,
    "seed_gajrays_4": 2499,
    "seed_gajrays_5": 3999,
    "seed_gajrays_6": 2499,
    "seed_gajrays_7": 2499,
    "seed_gajrays_8": 2499,
    "seed_gajrays_9": 2499,
    "seed_gajrays_10": 3999,
    "seed_gajrays_11": 2499,
    "seed_gajrays_12": 2499,
    "seed_gajrays_13": 2499,
    "seed_gajrays_14": 2499,
    "seed_jewellery_1": 1499,
    "seed_jewellery_2": 1499,
    "seed_jewellery_3": 1499,
    "seed_jewellery_4": 1499,
    "seed_jewellery_5": 1599,
    "seed_jewellery_6": 1499,
    "seed_jewellery_7": 1599,
    "seed_jewellery_8": 1499,
    "seed_jewellery_9": 1499,
    "seed_headbands_1": 1299,
    "seed_headbands_2": 1299,
    "seed_headbands_3": 1299,
    "seed_keychains_1": 450,
    "seed_keychains_2": 450,
    "seed_keychains_3": 450,
    "seed_keychains_4": 450,
    "seed_keychains_5": 450,
    "seed_keychains_6": 450,
    "seed_keychains_7": 450,
    "seed_keychains_8": 450,
    "seed_keychains_9": 450,
    "seed_keychains_10": 450,
    "seed_keychains_11": 450,
    "seed_keychains_12": 450,
    "seed_keychains_13": 450,
    "seed_keychains_14": 450,
    "seed_keychains_15": 450,
    "seed_keychains_16": 450,
    "seed_keychains_17": 450,
    "seed_keychains_18": 450,
    "seed_keychains_19": 450,
    "seed_keychains_20": 450,
    "seed_pencil_1": 799,
    "seed_pencil_2": 799,
    "seed_pencil_3": 799,
    "seed_pencil_4": 799,
    "seed_pencil_5": 799,
    "seed_pencil_6": 799,
    "seed_pencil_7": 799,
    "seed_pencil_8": 799,
    "seed_pencil_9": 799,
    "seed_pencil_10": 799,
    "seed_pencil_11": 799,
    "seed_pencil_12": 799,
    "seed_pencil_13": 799,
    "seed_geometry_1": 2499,
    "seed_geometry_2": 2499,
    "seed_geometry_3": 2499,
    "seed_geometry_4": 2499,
    "seed_geometry_5": 2499,
    "seed_geometry_6": 2499,
    "seed_geometry_7": 2499,
    "seed_geometry_8": 2499
  };
  var PRODUCT_KEYWORDS = {
    "seed_purses_1": ["handmade 3d crochet rose handbag", "3d rose handbag", "rose handbag", "rose purse", "3d rose"],
    "seed_purses_2": ["handmade 3d crochet rose handbag", "3d rose handbag", "rose handbag", "rose purse", "3d rose"],
    "seed_purses_3": ["3d rose crescent shoulder bag", "crescent shoulder bag", "3d rose purse", "rose purse", "3d rose", "rose handbag", "crochet rose"],
    "seed_purses_4": ["3d rose granny square tote bag", "granny square tote", "tote bag", "3d rose", "rose tote"],
    "seed_purses_8": ["3d butterfly crossbody purse", "butterfly crossbody", "butterfly purse", "crossbody purse"],
    "seed_purses_9": ["sunflower granny square shoulder bag", "sunflower shoulder bag", "granny square shoulder bag", "sunflower"],
    "seed_purses_10": ["3d rose clutch bag", "round metal handle", "metal handle clutch", "clutch bag"],
    "seed_purses_11": ["3d rose flower sling bag", "rose sling bag", "sling bag", "shoulder sling", "with leaves"],
    "seed_purses_12": ["3d rose round cantaloupe bag", "cantaloupe bag", "round crochet bag", "rose round bag"],
    "seed_purses_13": ["sunflower flap clutch", "flap clutch", "sunflower clutch", "clutch"]
  };
  /* Search terms per category, plus a per-group list for the subcategories of
     Wedding Gift so "gajray" or "bouquet" still finds the right product even
     though none of them is a category of its own any more. */
  var CATEGORY_KEYWORDS = {
    gr1: ["handbag", "purse", "crochet bag", "tote", "shopper bag", "handmade", "gift", "woolen"],
    gr2: ["wedding gift", "wedding", "shaadi", "doli", "mehndi", "haldi", "bridal", "bride", "party", "gift"],
    gr3: ["small gift", "keychain", "keyring", "headband", "hairband", "hair accessory", "cute", "handmade", "gift", "wholesale"],
    gr4: ["school", "school supplies", "stationery", "back to school", "student", "pencil", "pencil box", "geometry box", "maths", "handmade"]
  };
  var GROUP_KEYWORDS = {
    purses: ["purse", "handbag", "clutch", "hobo", "shoulder bag"],
    bags: ["bag", "tote", "shopper", "carry bag", "travelling"],
    gajrays: ["gajray", "gajra", "hair", "eid", "flowers", "party"],
    jewellery: ["jewellery", "jewelry", "necklace", "earrings", "accessory"],
    bouquets: ["bouquet", "flowers", "rose", "bride"],
    keychains: ["keychain", "keyring", "key holder", "wholesale"],
    headbands: ["headband", "head band", "hairband", "hair band", "hair accessory", "girl"],
    geometry: ["geometry", "geometry box", "maths box", "maths kit", "drafter"],
    pencil: ["pencil", "pencils", "colour pencil", "color pencil", "writing"],
    pencilbox: ["pencil box", "pencil case", "pen holder", "pouch"]
  };

  /* Three older layouts have to be recognised, and they disagree about what
     the same gr key means, so the map is chosen by which stored version the rows
     came from rather than by the key alone.  A subcategory of null means "keep
     whatever the product already had", which is what the two layouts that
     already had subcategories need. */
  var LEGACY_CATEGORY_MAP = {
    /* v46-v48: Headband was a top-level gr3 and Gifts was gr4. The
       two are now one Small Gifts at gr3, so gr4 has to land there too. */
    gr1: { category: "gr1", subcategory: "", guess: guessPurseOrBag },  /* Purse/Bags  */
    gr2: { category: "gr2", subcategory: null },          /* Wedding Gift (sg keys same) */
    gr3: { category: "gr3", subcategory: "sg2" },         /* Headband    -> Headband     */
    gr4: { category: "gr3", subcategory: null },          /* Gifts       -> Small Gifts  */
    gr5: { category: "gr4", subcategory: null }           /* School Items-> School Items */
  };
  var LEGACY_CATEGORY_MAP_SIX = {
    /* v45: six categories, keychains already under Gifts. */
    gr1: { category: "gr1", subcategory: "", guess: guessPurseOrBag },  /* Purse/Bags  */
    gr2: { category: "gr2", subcategory: "sg1" },        /* Gajrays    -> Wedding Gift */
    gr3: { category: "gr2", subcategory: "sg2" },        /* Jewellery  -> Wedding Gift */
    gr4: { category: "gr3", subcategory: "sg2" },        /* Headband   -> Small Gifts  */
    gr5: { category: "gr2", subcategory: "sg3" },        /* Bouquet    -> Wedding Gift */
    gr6: { category: "gr3", subcategory: null }          /* Gifts      -> Small Gifts  */
  };
  var LEGACY_CATEGORY_MAP_ORIGINAL = {
    /* v44 and older: the original eight separate categories, before
       subcategories existed, so nothing here keeps an old sg key. */
    gr1: { category: "gr1", subcategory: "sg1" },        /* Purses    -> Purse/Bags    */
    gr2: { category: "gr2", subcategory: "sg1" },        /* Gajrays   -> Wedding Gift  */
    gr3: { category: "gr3", subcategory: "sg1" },        /* Keychains -> Small Gifts   */
    gr4: { category: "gr1", subcategory: "sg2" },        /* Bags      -> Purse/Bags    */
    gr5: { category: "gr2", subcategory: "sg2" },        /* Jewellery -> Wedding Gift  */
    gr6: { category: "gr3", subcategory: "sg2" },        /* Headband  -> Small Gifts   */
    gr7: { category: "gr2", subcategory: "sg3" },        /* Bouquet   -> Wedding Gift  */
    gr8: { category: "gr3", subcategory: "" }            /* Gifts     -> Small Gifts   */
  };

  /* Used only by the migrations above: a flat Purse/Bags row is filed under
     whichever branch its name points at. "bag" wins over "purse" only when the
     name says bag and never purse, so "Purse Bag" stays a purse. */
  function guessPurseOrBag(p) {
    var n = String(p.name || "").toLowerCase();
    return /bag/.test(n) && !/purse/.test(n) ? "sg2" : "sg1";
  }

  /* Pull owner-created products out of any older gulnish-products-v* store and
     re-file them on the current categories. Seed rows (ids like seed_purses_1) are
     skipped because the current seed is generated fresh. */
  function migrateCustomProducts() {
    var carried = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key === LOCAL_PRODUCTS) continue;
        if (!/^gulnish-products-v\d+$/.test(key)) continue;

        var old = lsGet(key, []);
        if (!Array.isArray(old)) continue;
        /* Rows saved under v46 and v47 used the layout where Headband and Gifts
           were separate top-level categories, v45 the six category one, and
           anything older the original eight - where the same gr key meant
           something completely different. */
        var version = parseInt(String(key).replace(/^gulnish-products-v/, ""), 10);
        var map = version >= 46
          ? LEGACY_CATEGORY_MAP
          : (version === 45 ? LEGACY_CATEGORY_MAP_SIX : LEGACY_CATEGORY_MAP_ORIGINAL);
        old.forEach(function (raw) {
          if (!raw || typeof raw !== "object") return;
          if (String(raw.id || "").indexOf("seed_") === 0) return;

          var target = map[raw.category];
          var p = normalizeProduct(raw);
          if (target) {
            p.category = target.category;
            if (target.subcategory != null) p.subcategory = target.subcategory;
            /* Purse/Bags used to be one flat list, so the old row cannot say
               which branch it belonged to. Fall back to the product's own
               name: anything calling itself a bag goes to Bags, and the rest
               to Purses, which is the far larger of the two. */
            if (target.guess) p.subcategory = target.guess(p);
          }
          if (carried.some(function (c) { return c.id === p.id; })) return;
          carried.push(p);
        });
      }
    } catch (e) { /* ignore */ }
    return carried;
  }

  function defaultProducts() {
    var settings = defaultSettings();
    var cats = settings.categories;
    var subs = settings.subcategories;
    var out = [];
    Object.keys(RAW_IMAGES).forEach(function (key) {
      var place = SEED_PLACEMENT[key];
      if (!place) return;
      var catIdx = parseInt(place.category.replace("gr", ""), 10) - 1;
      var label = cats[catIdx] || ITEM_NAME[key] || "Item";
      var name = ITEM_NAME[key] || label;
      /* Keywords come from the category the product lands in, so a search for
         "wedding gift" finds all three Wedding Gift branches, plus the terms
         unique to this group of photos. */
      var kw = (CATEGORY_KEYWORDS[place.category] || [label.toLowerCase()]).slice();
      if (GROUP_KEYWORDS[key]) kw = kw.concat(GROUP_KEYWORDS[key]);

      /* A group with no photos yet still gets PLACEHOLDER_COUNTS products, so
         a brand new section is not empty. Those products carry no price: there
         is nothing to quote until the real item and its cost are entered. */
      var photos = RAW_IMAGES[key];
      var count = photos.length || (PLACEHOLDER_COUNTS[key] || 0);
      for (var i = 0; i < count; i += 1) {
        var id = "seed_" + key + "_" + (i + 1);
        var real = REAL_PRODUCTS[id];
        if (PRODUCT_KEYWORDS[id]) kw = kw.concat(PRODUCT_KEYWORDS[id]);
        var price = photos.length
          ? (PRODUCT_PRICES[id] || (real ? real.price : (BASE_PRICE[key] || 500) + (i % 4) * 50))
          : 0;
        out.push({
          id: id,
          name: real ? real.name : name + " " + (i + 1),
          price: price,
          /* Only meaningful alongside a real published price, and only when it
             sits above it - a max at or under the base would print a
             back-to-front range. */
          priceMax: price > 0 && real && real.priceMax > price ? real.priceMax : 0,
          category: place.category,
          subcategory: place.subcategory,
          image: photos.length && !(HIDE_PRODUCT_IMAGES[key] || HIDE_PRODUCT_IMAGES[id]) ? photos[i] : "",
          keywords: kw,
          colors: [],
          status: "in stock",
          stock: null,
          gallery: []
        });
      }
    });
    return out;
  }

  function normalizeProduct(p) {
    var s = String((p && p.status) || "").trim().toLowerCase();
    var status = "in stock";
    if (s === "sold out" || s === "sold-out") status = "sold out";
    else if (s === "made to order" || s === "made-to-order") status = "made to order";
    var st = p && p.stock != null && p.stock !== "" ? Math.max(0, parseInt(p.stock, 10) || 0) : null;
    /* priceMax is the top of the published range, so it only counts when there is
       a published price for it to sit above: anything else (blank from a
       form, a stale row, a max below or level with the base, a max on a
       product that has no price at all) is dropped to 0, which every surface
       reads as "single fixed price". */
    var base = parseFloat(p && p.price) || 0;
    var top = parseFloat(p && p.priceMax) || 0;
    if (!(base > 0) || !(top > base)) top = 0;
    var gal = Array.isArray(p && p.gallery)
      ? p.gallery.filter(function (x) { return typeof x === "string" && x.trim(); })
      : [];
    /* subcategory is the positional "sgN" key inside the product's own
       category, so an empty string simply means "this product is filed
       straight under its category". */
    var sub = p && typeof p.subcategory === "string" ? p.subcategory.trim() : "";
    if (sub && subIndexOf(sub) < 0) sub = "";
    return Object.assign({}, p, { status: status, stock: st, priceMax: top, gallery: gal, subcategory: sub });
  }

  /* ---------- v<19>.sql also mirrors this catalog ---------- */

  function defaultSettings() {
    var cats = [];
    for (var i = 0; i < DEFAULT_COUNT; i += 1) {
      cats.push(DEFAULT_NAMES[i] || "Category " + (i + 1));
    }
    return {
      categories: cats,
      subcategories: defaultSubcategories(),
      taxonomyVersion: TAXONOMY_VERSION,
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
      /* Gulnish Crochet does not offer free delivery: the courier charge
         always applies and the exact figure is agreed on WhatsApp. A
         numeric shippingFee (set in the admin panel) publishes the amount
         up front instead. `freeDeliveryMin` is only kept so older saved
         settings still load cleanly - nothing reads it any more. */
      deliveryNote: "",
      freeDeliveryMin: 0,
      version: 4
    };
  }

  function normalizeSettings(raw) {
    var base = raw && typeof raw === "object" ? raw : {};
    var s = defaultSettings();

    /* Saved settings written against an older taxonomy keep their category
       names only while the layout is unchanged. Once the categories are
       merged, re-ordered or removed, the saved names describe keys that no
       longer mean what they used to, so the new structure wins - but the
       WhatsApp number, bank details and delivery times below are still kept,
       which is the part the owner actually typed. */
    var sameTaxonomy = base.taxonomyVersion === TAXONOMY_VERSION;

    var cats = sameTaxonomy && Array.isArray(base.categories) ? base.categories : null;
    if (cats && cats.length) {
      /* A save made before a category existed holds fewer names than
         DEFAULT_COUNT. Keep those names and pad the rest with the defaults,
         otherwise raising DEFAULT_COUNT would throw the saved names away. */
      var saved = cats
        .map(function (c) { return typeof c === "string" ? c.trim() : ""; })
        .slice(0, DEFAULT_COUNT);
      s.categories = s.categories.map(function (fallback, i) { return saved[i] || fallback; });
    }
    if (sameTaxonomy && base.subcategories && typeof base.subcategories === "object") {
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
    /* Category images are keyed by grN too, so they are only reusable while
       the layout is unchanged - otherwise a saved keychain photo would end up
       on whatever now sits at gr3. A re-laid-out shop falls back to the
       bundled defaults and the owner re-uploads from the admin panel. */
    if (sameTaxonomy && base.categoryImages && typeof base.categoryImages === "object") {
      var ci = {};
      s.categories.forEach(function (_, i) {
        var k = "gr" + (i + 1);
        ci[k] = Array.isArray(base.categoryImages[k]) && base.categoryImages[k].length
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
    if (base.deliveryNote != null && base.deliveryNote !== "") s.deliveryNote = String(base.deliveryNote);
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
      if (!localStorage.getItem(LOCAL_PRODUCTS)) {
        /* First visit on this seed version. Keep anything the owner added by
           hand in the admin panel, moved onto the current categories, so
           bumping the key re-seeds the catalogue without eating their work.
           Only non-seed rows are carried over: the seed list is rebuilt from
           RAW_IMAGES below, and a stale copy would fight it. */
        migrateCustomProducts().forEach(function (p) { products.push(p); });
        lsSet(LOCAL_PRODUCTS, products);
      }
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
    /* True once a save has proved the products table has no subcategory
       or price_max column, so the admin panel can show the migration notice. */
    get subcategoryColumnMissing() { return subcategoryColumnMissing; },
    get priceMaxColumnMissing() { return priceMaxColumnMissing; },

    /* ---- categories & subcategories ---- */
    categoryKey: function (index) { return "gr" + (index + 1); },
    subcategoryKey: subKey,
    /* Labels a category's subcategories; [] for a flat category. */
    subcategoriesOf: function (catKey) {
      var map = (GC.settings || {}).subcategories || {};
      var list = map[catKey];
      return Array.isArray(list) ? list.slice() : [];
    },
    /* "Keychains" for ("gr4", "sg1"); "" when the pair is not set. */
    subcategoryLabelOf: function (catKey, subKeyVal) {
      var list = GC.subcategoriesOf(catKey);
      var i = subIndexOf(subKeyVal);
      return i >= 0 && list[i] ? list[i] : "";
    },
    /* First non-empty subcategory key of a category, or "". */
    firstSubcategoryKeyOf: function (catKey) {
      return GC.subcategoriesOf(catKey).length ? subKey(0) : "";
    },

    /* ---- boot ---- */
    init: function () {
      return bootPromise;
    },

    /* Direct table access for features outside the catalogue model. Kept off
       the catalogue methods on purpose: those are all about
       products/settings/orders. */
    table: function (name) {
      return sb && configured ? sb.from(name) : null;
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
      /* Normalise before anything else: this runs before the admin form's own
         guard on a direct call, and a priceMax that is blank, junk or below
         the base would otherwise be written to memory, localStorage and the
         database and only quietly dropped on the next load. */
      product = normalizeProduct(product);
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
      if (!priceMaxColumnMissing) row.price_max = product.priceMax || 0;
      var res = await sb.from("products").upsert(row, { onConflict: "id" });
      /* An un-migrated database rejects the whole row over a new column.
         Drop it, remember that, and keep saving everything else rather than
         losing the product edit. GC.subcategoryColumnMissing /
         GC.priceMaxColumnMissing turn the admin panel warnings on. */
      if (res.error && isMissingSubcategoryColumn(res.error)) {
        subcategoryColumnMissing = true;
        delete row.subcategory;
        res = await sb.from("products").upsert(row, { onConflict: "id" });
      }
      if (res.error && isMissingPriceMaxColumn(res.error)) {
        priceMaxColumnMissing = true;
        delete row.price_max;
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
          method: typeof order.payment === "string" ? order.payment : GC.paymentDefault,
          status: "Pending"
        };
      }
      if (!order.payment.method) order.payment.method = GC.paymentDefault;
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
      if (!o.payment) o.payment = { method: GC.paymentDefault, status: "Pending" };
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

    /* ---- delivery wording ----
       Single source of truth for what the site says about delivery.
       Delivery is NOT free here, so nothing may promise otherwise: the
       wording either names the published courier charge or says plainly
       that the charge is confirmed on WhatsApp. `deliveryNote` lets the
       owner override the sentence entirely. */
    /* ---- payment wording ----
       Cash on delivery is NOT offered. Every order is paid for in advance
       before stitching starts, so no default or fallback here may ever
       reintroduce "pay when it arrives". Historic orders saved with a
       COD method string still display that string, so old records are not
       rewritten, but nothing new can default to it. */
    paymentDefault: "Bank transfer",

    /* Methods that mean the money is already in hand. Anything else
       (e.g. the "Decide on WhatsApp" option) still needs a transfer. */
    paymentPrepaid: function (method) {
      var m = String(method || "").trim().toLowerCase();
      return m === "bank transfer" || m === "jazzcash / easypaisa" || m === "paid";
    },

    deliveryFee: function () {
      var raw = GC.settings.shippingFee;
      if (raw == null || raw === "") return null;
      var n = parseFloat(raw);
      return isFinite(n) && n > 0 ? n : null;
    },

    deliveryLabel: function () {
      var custom = String(GC.settings.deliveryNote || "").trim();
      if (custom) return custom;
      var fee = GC.deliveryFee();
      return fee
        ? "Flat delivery of Rs. " + fee + " across Pakistan"
        : "Delivery charge confirmed on WhatsApp";
    },

    /* Short form for tight spots (mega-menu footer, trust chips). */
    deliveryShort: function () {
      var fee = GC.deliveryFee();
      return fee ? "Rs. " + fee + " delivery" : "Delivery charge applies";
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
    var method = typeof o.payment === "string" ? o.payment : (pay.method || GC.paymentDefault);
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
    var method = r.payment_method || r.payment || GC.paymentDefault;
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
