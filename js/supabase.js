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
  var LOCAL_PRODUCTS = "gulnish-products-v67";
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
  /* Same story for the two orders columns added with the keychain delivery
     charge: an unmigrated database rejects the whole order upsert. */
  var orderDeliveryColumnMissing = false;
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
  function isMissingOrderDeliveryColumns(err) {
    return isMissingColumn(err, "delivery_charge") || isMissingColumn(err, "grand_total");
  }

  /* ---------- default settings (mirrors original) ---------- */

  /* Categories are positional: the key for the category at index i is
     "gr" + (i + 1), and every product stores that key verbatim. Re-ordering,
     merging or removing a category therefore re-points every product whose
     key moves, so TAXONOMY_VERSION below is how a layout change tells saved
     settings (localStorage or the settings table) to adopt the new shape
     instead of keeping names that now sit on the wrong products. */
  var DEFAULT_COUNT = 4;
  var DEFAULT_NAMES = ["Purses", "Wedding Gift", "Small Gifts", "School Items"];

  /* Subcategories are positional inside their parent, so the key is "sg" +
     (index + 1) and is only ever read alongside the product's own category.
     A blank entry list means "no subcategories". */
  var EXTRA_SUBCATEGORY_NAMES = {
    1: ["Purses"],
    2: ["Jewellery", "Bouquet", "Gajrays"],
    3: ["Keychains", "Headband"],
    4: ["Bags", "Pencil Case", "Pencil"]
  };

  /* Bump whenever the category list, their order, or their subcategories
     change. Saved settings stamped with an older value keep their WhatsApp
     number, bank details and delivery times, but take the new taxonomy. */
  var TAXONOMY_VERSION = 13;

  /* Bump when the bundled category photos change. Saved photos stay while
     this matches; raising it hands every browser the new bundled sets once,
     without touching names, subcategories or the shop details below. */
  var CATEGORY_IMAGES_VERSION = 2;

  function subKey(i) { return "sg" + (i + 1); }
  function subIndexOf(key) { return parseInt(String(key || "").replace("sg", ""), 10) - 1; }
  function defaultSubcategories() {
    var out = {};
    for (var i = 0; i < DEFAULT_COUNT; i += 1) {
      out["gr" + (i + 1)] = (EXTRA_SUBCATEGORY_NAMES[i + 1] || []).slice();
    }
    return out;
  }

  /* One photo per category card, chosen by hand: the shop-by strip
     is a look at each branch, not a slideshow. A single entry also stops
     startCategorySlideshows from adding its cross-fade layer. */
  var CATEGORY_IMAGE_SETS = {
    gr1: ["images/purses/purse-15.webp"],
    gr2: ["images/bouquets/bouquet-7.webp"],
    gr3: ["images/keychains/keychain-3.webp"],
    /* School Items: a backpack leads, then the geometry shots and the pencils,
       so the home card no longer shows the photo-pending slot. */
    gr4: ["images/bags/bag-1.webp", "images/geometry/geometry-1.webp", "images/geometry/geometry-2.webp", "images/geometry/geometry-5.webp", "images/pencil/pencil-1.webp"]
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
    pencil: ["images/pencil/pencil-1.webp", "images/pencil/pencil-2.webp", "images/pencil/pencil-3.webp", "images/pencil/pencil-4.webp", "images/pencil/pencil-5.webp", "images/pencil/pencil-6.webp", "images/pencil/pencil-7.webp", "images/pencil/pencil-8.webp", "images/pencil/pencil-9.webp", "images/pencil/pencil-10.webp", "images/pencil/pencil-11.webp", "images/pencil/pencil-12.webp", "images/pencil/pencil-13.webp"]
  };

  /* How many products to generate for a group that has no photos yet. Nothing
     sits on this now: every group in RAW_IMAGES above is photo-backed. */
  var PLACEHOLDER_COUNTS = {};

/* Which category (and subcategory) each photo group is filed under. Gajrays,
   Jewellery and Bouquet are separate top-level categories no longer; they are
   the three branches of Wedding Gift. The four bags used to be their own
   category, then the second branch of Purse/Bags, and are now the first branch
   of School Items - they are all backpacks. */
var SEED_PLACEMENT = {
    purses: { category: "gr1", subcategory: "sg1" },
    bags: { category: "gr4", subcategory: "sg1" },
    jewellery: { category: "gr2", subcategory: "sg1" },
    bouquets: { category: "gr2", subcategory: "sg2" },
    gajrays: { category: "gr2", subcategory: "sg3" },
    headbands: { category: "gr3", subcategory: "sg2" },
    keychains: { category: "gr3", subcategory: "sg1" },
    geometry: { category: "gr4", subcategory: "sg2" },
    pencil: { category: "gr4", subcategory: "sg3" }
  };

  var ITEM_NAME  = { purses: "Purse", bags: "Bag", gajrays: "Gajray", jewellery: "Jewellery", headbands: "Headband", bouquets: "Bouquet", keychains: "Keychain", geometry: "Pencil Case", pencil: "Pencil" };
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
       Purse/Bags; they now lead the School Items list. They are all backpacks,
       filed under that branch's Bags subcategory rather than under Purses. */
    "seed_bags_1": { name: "Handmade Chunky Crochet Bunny Backpack", price: 6500, priceMax: 9500 },
    "seed_bags_2": { name: "Handmade Minimalist Crochet Backpack with Tassel", price: 6500, priceMax: 9500 },
    "seed_bags_3": { name: "Handmade Floral Granny Square Crochet Backpack", price: 7000, priceMax: 11500 },
    "seed_bags_4": { name: "Handmade Sunflower Granny Square Crochet Backpack", price: 6800, priceMax: 10500 },
    "seed_bouquets_1": { name: "Handmade Crochet Bridal Rose Bouquet", price: 9450, priceMax: 12000 },
    "seed_bouquets_2": { name: "Handmade Crochet Long-Stem Rose Bouquet", price: 7500, priceMax: 10500 },
    "seed_bouquets_3": { name: "Handmade Crochet Rose and Heart Gift Bouquet", price: 7500, priceMax: 10500 },
    "seed_bouquets_4": { name: "Handmade Crochet Rose and Daisy Bridal Bouquet", price: 8950, priceMax: 11500 },
    "seed_bouquets_5": { name: "Handmade Crochet Jasmine Bridal Bouquet", price: 11500, priceMax: 13500 },
    "seed_bouquets_6": { name: "Handmade Crochet Rose and Gypsophila Gift Bouquet", price: 7950, priceMax: 9500 },
    "seed_bouquets_7": { name: "Handmade Crochet Lily and Rosebud Mixed Bouquet", price: 6500, priceMax: 8500 },
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
    "seed_purses_25": { name: "Handmade Crochet Ruffle Shoulder Bag with Cherry Charm", price: 4200, priceMax: 5500 },
    "seed_purses_26": { name: "Handmade Chunky T-Shirt Yarn Baguette Bag", price: 5000, priceMax: 7000 },
    "seed_purses_27": { name: "Handmade Crochet Daisy Drawstring Bucket Bag", price: 5500, priceMax: 7500 },
    "seed_purses_28": { name: "Handmade Crochet Amigurumi Chick Crossbody Purse", price: 3500, priceMax: 4800 },
    "seed_purses_29": { name: "Handmade Beaded Crochet Hobo Bag with Crystal Fringe", price: 7500, priceMax: 11500 },
    "seed_purses_30": { name: "Handmade Crochet Sunflower Drawstring Bucket Bag", price: 5500, priceMax: 7500 },
    "seed_purses_31": { name: "Handmade Crochet 3D Bow Knot Underarm Bag", price: 5000, priceMax: 6800 },
    "seed_purses_32": { name: "Handmade Crochet Rose Drawstring Bucket Bag", price: 5500, priceMax: 7500 },
    "seed_purses_33": { name: "Handmade Crochet 3D Butterfly Handbag with Pearl Strap", price: 5500, priceMax: 7800 },
    /* Jewellery, filed under Wedding Gift's Jewellery branch. */
    "seed_jewellery_1": { name: "Handmade Micro-Crochet Rose Jewelry Set", price: 1500, priceMax: 2200 },
    "seed_jewellery_2": { name: "Handmade Micro-Crochet Camellia Jewelry Set", price: 1800, priceMax: 2500 },
    "seed_jewellery_3": { name: "Handmade Micro-Crochet Sunflower Jewelry Set", price: 1200, priceMax: 1800 },
    "seed_jewellery_4": { name: "Handmade Crochet Heart Jewelry Set", price: 1000, priceMax: 1500 },
    "seed_jewellery_5": { name: "Handmade Micro-Crochet 4-Piece Floral Pearl Jewelry Set", price: 2800, priceMax: 3800 },
    "seed_jewellery_6": { name: "Handmade Micro-Crochet Hibiscus Earring and Headband Set", price: 1800, priceMax: 2500 },
    "seed_jewellery_7": { name: "Handmade Crochet Mehndi Jewelry Set", price: 3500, priceMax: 4500 },
    "seed_jewellery_8": { name: "Handmade Micro-Crochet Sunflower Granny Square Jewelry Set", price: 2200, priceMax: 3000 },
    "seed_jewellery_9": { name: "Handmade Micro-Crochet Mimosa Jewelry Collection", price: 1200, priceMax: 1800 },
    /* Keychains. Delivery is a separate Rs. 250 on top of these figures, so it
       is quoted on WhatsApp rather than folded into the range. */
    "seed_keychains_1": { name: "Handmade Crochet Acorn Keychain", price: 450, priceMax: 750 },
    "seed_keychains_2": { name: "Handmade Crochet Coffee Cup Keychain", price: 450, priceMax: 750 },
    "seed_keychains_3": { name: "Handmade Crochet Headphone Keychain", price: 350, priceMax: 650 },
    "seed_keychains_4": { name: "Handmade Crochet Toilet Paper Roll Keychain", price: 300, priceMax: 500 },
    "seed_keychains_5": { name: "Handmade Crochet Slipper Keychain", price: 300, priceMax: 500 },
    "seed_keychains_6": { name: "Handmade Crochet Rose Keychain with Pearl Accents", price: 400, priceMax: 650 },
    "seed_keychains_7": { name: "Handmade Mini Crochet Handbag Keychain", price: 500, priceMax: 800 },
    "seed_keychains_8": { name: "Handmade Crochet Amigurumi Fruit Keychain Set", price: 350, priceMax: 600 },
    "seed_keychains_9": { name: "Handmade Crochet Amigurumi Jellyfish Keychain", price: 300, priceMax: 500 },
    "seed_keychains_10": { name: "Handmade Crochet Summer Botanical Keychain Set", price: 350, priceMax: 600 },
    "seed_keychains_11": { name: "Handmade Crochet Plush Heart Keychain with Wooden Beads", price: 350, priceMax: 550 },
    "seed_keychains_12": { name: "Handmade 3D Crochet Rose Bag Charm with Pearl Strap", price: 500, priceMax: 750 },
    "seed_keychains_13": { name: "Handmade Crochet Hugging Hearts Keychain", price: 450, priceMax: 700 },
    "seed_keychains_14": { name: "Handmade Crochet Mini Bouquet Keychain", price: 450, priceMax: 700 },
    "seed_keychains_15": { name: "Handmade Crochet Lily of the Valley Keychain", price: 300, priceMax: 450 },
    "seed_keychains_16": { name: "Handmade Crochet Sunflower Keychain with Leaf", price: 300, priceMax: 450 },
    "seed_keychains_17": { name: "Handmade Crochet Amigurumi Bunny with Strawberry Hat Keychain", price: 500, priceMax: 750 },
    "seed_keychains_18": { name: "Handmade Beaded Crochet Jellyfish Keychain", price: 450, priceMax: 650 },
    "seed_keychains_19": { name: "Handmade Crochet Puff Flower Keychain", price: 250, priceMax: 400 },
    "seed_keychains_20": { name: "Handmade Crochet Lily of the Valley Pearl Wristlet Keychain", price: 450, priceMax: 650 },
    /* School Items, filed under the Pencil Case branch. The two "per single
       pouch" pieces are priced per pouch, so the set size is settled on
       WhatsApp rather than folded into the published range. */
    "seed_geometry_1": { name: "Handmade Crochet Panda Pencil Case", price: 2500, priceMax: 3800 },
    "seed_geometry_2": { name: "Handmade Crochet Vegetable Pencil Case Set (Per Single Pouch)", price: 2300, priceMax: 3500 },
    "seed_geometry_3": { name: "Handmade Crochet Orange Face Pencil Case", price: 2500, priceMax: 3800 },
    "seed_geometry_4": { name: "Handmade Crochet Pastel Cloud and Star Pencil Case", price: 2500, priceMax: 3800 },
    "seed_geometry_5": { name: "Handmade Crochet Gingham Strawberry Pencil Case", price: 2800, priceMax: 4000 },
    "seed_geometry_6": { name: "Handmade Crochet Striped Pastel Pencil Case", price: 2400, priceMax: 3500 },
    "seed_geometry_7": { name: "Handmade Crochet Amigurumi Animal Pencil Case Set (Per Single Pouch)", price: 2800, priceMax: 4000 },
    "seed_geometry_8": { name: "Handmade Crochet Coquette Heart Pencil Case", price: 2400, priceMax: 3800 },
    /* School Items, filed under the Pencil branch. Each range is the price of
       one pen, so a bulk order is costed on WhatsApp rather than guessed at
       here - the titles that are sold per piece say so. */
    "seed_pencil_1": { name: "Handmade Crochet Rose Pen (Per Single Piece)", price: 450, priceMax: 850 },
    "seed_pencil_2": { name: "Premium Full-Wrapped Crochet Rose Pen", price: 550, priceMax: 1000 },
    "seed_pencil_3": { name: "Handmade Crochet Leafy Rose Pen (Per Single Piece)", price: 600, priceMax: 1200 },
    "seed_pencil_4": { name: "Handmade Crochet Pastel Rose Pen (Per Single Piece)", price: 550, priceMax: 1100 },
    "seed_pencil_5": { name: "Handmade Crochet Star Pencil Topper (Per Single Piece)", price: 300, priceMax: 650 },
    "seed_pencil_6": { name: "Handmade Crochet Half-Wrapped Rose Pen (Per Single Piece)", price: 500, priceMax: 1000 },
    "seed_pencil_7": { name: "Handmade Full-Wrapped Crochet Sunflower Pen", price: 550, priceMax: 1100 },
    "seed_pencil_8": { name: "Handmade Full-Wrapped Crochet Sunflower Pen (Per Single Piece)", price: 550, priceMax: 1100 },
    "seed_pencil_9": { name: "Handmade Crochet Button Flower Pencil Topper (Per Single Piece)", price: 250, priceMax: 600 },
    "seed_pencil_10": { name: "Handmade Full-Wrapped Minimalist Crochet Rose Pen (Per Single Piece)", price: 500, priceMax: 1100 },
    "seed_pencil_11": { name: "Handmade Crochet Rose Pencil Topper Set (Per Single Piece)", price: 450, priceMax: 900 },
    "seed_pencil_12": { name: "Handmade Full-Wrapped Crochet Tulip Pen (Per Single Piece)", price: 550, priceMax: 1100 },
    "seed_pencil_13": { name: "Handmade Full-Wrapped Crochet Daisy Pen", price: 550, priceMax: 1100 },
  };
  var PRODUCT_PRICES = {
    "seed_purses_6": 5500,
    "seed_purses_7": 4500,
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
    "seed_headbands_1": 1299,
    "seed_headbands_2": 1299,
    "seed_headbands_3": 1299,

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
    "seed_purses_13": ["sunflower flap clutch", "flap clutch", "sunflower clutch", "clutch"],
    "seed_purses_14": ["square 3d rose handbag", "square rose handbag", "3d rose handbag", "rose handbag"],
    "seed_purses_15": ["tricolor rose handbag", "tricolour rose handbag", "circle handbag", "3d circle bag", "rose handbag"],
    "seed_purses_16": ["rose circle clutch", "circle clutch", "pearl strap clutch", "3d rose clutch"],
    "seed_purses_17": ["metallic rose clutch", "gold ring handle clutch", "metallic clutch", "rose clutch"],
    "seed_purses_18": ["multi color granny square crossbody", "granny square crossbody", "crossbody bag", "multicolour crossbody"],
    "seed_purses_19": ["rose handbag pearl arched handle", "pearl arched handle", "arched handle handbag", "3d rose handbag"],
    "seed_purses_20": ["rose clutch d-ring", "d-ring metal handle", "d ring clutch", "3d rose clutch"],
    "seed_purses_21": ["coquette bow shoulder bag", "bow shoulder bag", "coquette bag", "bow bag"],
    "seed_purses_22": ["daisy flower tote bag", "3d daisy tote", "daisy tote", "pearl strap tote"],
    "seed_purses_23": ["ribbed crochet tassel bag", "tassel bag", "leather handle bag", "ribbed bag"],
    "seed_purses_24": ["crescent shoulder bag flower charm", "crescent bag", "flower charm bag", "shoulder bag"],
    "seed_purses_25": ["ruffle shoulder bag", "cherry charm bag", "ruffle bag", "shoulder bag"],
    "seed_purses_26": ["chunky t-shirt yarn bag", "t-shirt yarn bag", "baguette bag", "chunky yarn"],
    "seed_purses_27": ["daisy drawstring bucket bag", "drawstring bucket bag", "bucket bag", "daisy bag"],
    "seed_purses_28": ["amigurumi chick crossbody", "chick crossbody purse", "amigurumi purse", "chick purse", "cute crossbody"],
    "seed_purses_29": ["beaded crochet hobo bag", "crystal fringe bag", "hobo bag", "beaded hobo", "fringe bag"],
    "seed_purses_30": ["sunflower drawstring bucket bag", "sunflower bucket bag", "drawstring bucket bag", "sunflower"],
    "seed_purses_31": ["3d bow knot underarm bag", "bow knot bag", "underarm bag", "bow bag"],
    "seed_purses_32": ["rose drawstring bucket bag", "rose bucket bag", "drawstring bucket bag", "rose"],
    "seed_purses_33": ["3d butterfly handbag", "butterfly handbag pearl strap", "butterfly handbag", "pearl strap handbag"],
    "seed_bags_1": ["chunky crochet bunny backpack", "bunny backpack", "crochet backpack", "rabbit backpack"],
    "seed_bags_2": ["minimalist crochet backpack", "backpack with tassel", "tassel backpack", "minimal backpack"],
    "seed_bags_3": ["floral granny square backpack", "granny square backpack", "floral backpack"],
    "seed_bags_4": ["sunflower granny square backpack", "sunflower backpack", "granny square backpack"],
    "seed_jewellery_1": ["micro crochet rose jewelry set", "rose jewelry set", "micro-crochet rose", "rose set"],
    "seed_jewellery_2": ["micro crochet camellia jewelry set", "camellia jewelry set", "camellia set", "camellia"],
    "seed_jewellery_3": ["micro crochet sunflower jewelry set", "sunflower jewelry set", "sunflower set"],
    "seed_jewellery_4": ["crochet heart jewelry set", "heart jewelry set", "heart set"],
    "seed_jewellery_5": ["4-piece floral pearl jewelry set", "floral pearl jewelry set", "pearl set", "4-piece set"],
    "seed_jewellery_6": ["hibiscus earring and headband set", "hibiscus set", "earring headband set"],
    "seed_jewellery_7": ["crochet mehndi jewelry set", "mehndi jewelry set", "mehndi set"],
    "seed_jewellery_8": ["sunflower granny square jewelry set", "sunflower granny square jewelry", "granny square jewelry set"],
    "seed_jewellery_9": ["micro crochet mimosa jewelry collection", "mimosa jewelry", "mimosa collection", "mimosa"],
    "seed_keychains_1": ["crochet acorn keychain", "acorn keychain", "acorn"],
    "seed_keychains_2": ["crochet coffee cup keychain", "coffee cup keychain", "coffee cup"],
    "seed_keychains_3": ["crochet headphone keychain", "headphone keychain", "headphone charm", "earphone keychain"],
    "seed_keychains_4": ["crochet toilet paper roll keychain", "toilet paper roll keychain", "toilet roll keychain", "tissue roll keychain"],
    "seed_keychains_5": ["crochet slipper keychain", "slipper keychain", "slipper", "shoe charm keychain"],
    "seed_keychains_6": ["crochet rose keychain with pearl accents", "rose keychain", "pearl keychain"],
    "seed_keychains_7": ["mini crochet handbag keychain", "handbag keychain", "mini handbag charm", "purse charm keychain"],
    "seed_keychains_8": ["amigurumi fruit keychain set", "fruit keychain", "amigurumi fruit", "fruit charm keychain"],
    "seed_keychains_9": ["amigurumi jellyfish keychain", "jellyfish keychain", "jellyfish"],
    "seed_keychains_10": ["summer botanical keychain set", "botanical keychain", "summer keychain set", "botanical"],
    "seed_keychains_11": ["plush heart keychain", "heart keychain wooden beads", "plush heart", "wooden beads"],
    "seed_keychains_12": ["3d crochet rose bag charm", "rose bag charm", "bag charm pearl strap", "rose charm keychain"],
    "seed_keychains_13": ["hugging hearts keychain", "hugging hearts", "heart hug keychain", "hugging heart"],
    "seed_keychains_14": ["mini bouquet keychain", "crochet bouquet keychain", "mini bouquet", "bouquet charm"],
    "seed_keychains_15": ["lily of the valley keychain", "lily of the valley", "lily keychain"],
    "seed_keychains_16": ["sunflower keychain with leaf", "sunflower keychain", "sunflower charm"],
    "seed_keychains_17": ["amigurumi bunny strawberry hat keychain", "bunny keychain", "strawberry hat bunny", "amigurumi bunny"],
    "seed_keychains_18": ["beaded crochet jellyfish keychain", "beaded jellyfish keychain", "beaded jellyfish", "jellyfish"],
    "seed_keychains_19": ["puff flower keychain", "puff flower", "crochet puff flower"],
    "seed_keychains_20": ["lily of the valley pearl wristlet keychain", "pearl wristlet keychain", "lily of the valley wristlet", "pearl wristlet"],
    "seed_geometry_1": ["crochet panda pencil case", "panda pencil case", "panda pouch", "animal pencil case"],
    "seed_geometry_2": ["vegetable pencil case set", "vegetable pencil case", "carrot pencil case", "pencil case set"],
    "seed_geometry_3": ["orange face pencil case", "orange pencil case", "fruit pencil case", "tangerine pencil case"],
    "seed_geometry_4": ["pastel cloud and star pencil case", "cloud and star pencil case", "star pencil case", "pastel pencil case"],
    "seed_geometry_5": ["gingham strawberry pencil case", "strawberry pencil case", "gingham pencil case"],
    "seed_geometry_6": ["striped pastel pencil case", "striped pencil case", "pastel stripes pencil case"],
    "seed_geometry_7": ["amigurumi animal pencil case set", "animal pencil case set", "amigurumi pencil case", "animal pouch"],
    "seed_geometry_8": ["coquette heart pencil case", "heart pencil case", "coquette pencil case", "bow pencil case"],
    "seed_pencil_1": ["crochet rose pen", "rose pen", "rose pen cover", "handmade pen"],
    "seed_pencil_2": ["premium full wrapped crochet rose pen", "full wrapped rose pen", "premium rose pen", "wrapped pen"],
    "seed_pencil_3": ["crochet leafy rose pen", "leafy rose pen", "rose pen with leaves", "leaf pen"],
    "seed_pencil_4": ["pastel rose pen", "crochet pastel pen", "pastel pen", "pastel rose"],
    "seed_pencil_5": ["crochet star pencil topper", "star pencil topper", "star topper", "pencil topper"],
    "seed_pencil_6": ["half wrapped rose pen", "crochet half wrapped pen", "half wrapped pen"],
    "seed_pencil_7": ["full wrapped crochet sunflower pen", "sunflower pen", "crochet sunflower pen", "sunflower pen cover"],
    "seed_pencil_8": ["full wrapped crochet sunflower pen", "sunflower pen", "crochet sunflower pen", "sunflower pencil"],
    "seed_pencil_9": ["button flower pencil topper", "crochet button flower topper", "button topper", "flower topper"],
    "seed_pencil_10": ["full wrapped minimalist crochet rose pen", "minimalist rose pen", "minimalist pen"],
    "seed_pencil_11": ["crochet rose pencil topper set", "rose pencil topper set", "rose topper set", "topper set"],
    "seed_pencil_12": ["full wrapped crochet tulip pen", "tulip pen", "crochet tulip pen", "tulip pen cover"],
    "seed_pencil_13": ["full wrapped crochet daisy pen", "daisy pen", "crochet daisy pen", "daisy pen cover"],
    "seed_bouquets_1": ["bridal rose bouquet", "rose bridal bouquet", "bridal bouquet", "wedding bouquet"],
    "seed_bouquets_2": ["long stem rose bouquet", "long-stem roses", "rose gift bouquet"],
    "seed_bouquets_3": ["rose and heart gift bouquet", "heart accent bouquet", "rose heart bouquet"],
    "seed_bouquets_4": ["rose and daisy bridal bouquet", "daisy bridal bouquet", "rose daisy wedding"],
    "seed_bouquets_5": ["jasmine bridal bouquet", "jasmine wedding bouquet", "jasmine"],
    "seed_bouquets_6": ["rose and gypsophila gift bouquet", "gypsophila bouquet", "gypsophila", "baby's breath bouquet"],
    "seed_bouquets_7": ["lily and rosebud mixed bouquet", "lily rosebud bouquet", "mixed bouquet"]
  };
  /* Search terms per category, plus a per-group list for the subcategories of
     Wedding Gift so "gajray" or "bouquet" still finds the right product even
     though none of them is a category of its own any more. */
  var CATEGORY_KEYWORDS = {
    gr1: ["handbag", "purse", "crochet bag", "tote", "shopper bag", "handmade", "gift", "woolen"],
    gr2: ["wedding gift", "wedding", "shaadi", "doli", "mehndi", "haldi", "bridal", "bride", "party", "gift"],
    gr3: ["small gift", "keychain", "keyring", "headband", "hairband", "hair accessory", "cute", "handmade", "gift", "wholesale"],
    gr4: ["school", "school supplies", "stationery", "back to school", "student", "school bag", "backpack", "pencil case", "pencil box", "pencil", "geometry box", "maths", "handmade"]
  };
  var GROUP_KEYWORDS = {
    purses: ["purse", "handbag", "clutch", "hobo", "shoulder bag"],
    bags: ["backpack", "school bag", "rucksack", "book bag", "bag"],
    gajrays: ["gajray", "gajra", "hair", "eid", "flowers", "party"],
    jewellery: ["jewellery", "jewelry", "necklace", "earrings", "accessory"],
    bouquets: ["bouquet", "flowers", "rose", "bride"],
    keychains: ["keychain", "keyring", "key holder", "wholesale"],
    headbands: ["headband", "head band", "hairband", "hair band", "hair accessory", "girl"],
    geometry: ["pencil case", "pencil pouch", "pencil case pouch", "pouch", "case"],
    pencil: ["pen", "pen cover", "crochet pen", "pencil", "pencils", "colour pencil", "color pencil", "writing"],
  };

  /* Three older layouts have to be recognised, and they disagree about what
     the same gr key means, so the map is chosen by which stored version the rows
     came from rather than by the key alone.  A subcategory of null means "keep
     whatever the product already had", which is what the two layouts that
     already had subcategories need.  "subs" re-points those kept keys when the
     branch has grown a subcategory since: Bags was added at the front of
     School Items, so every later key there moved down one place.  Every map is
     written in the numbering of its own era; shiftWeddingBranches below then
     moves a Wedding Gift row onto today's keys. */
var SCHOOL_SUB_SHIFT = { sg1: "sg2", sg2: "sg3", sg3: "sg4" };
  /* Gajrays used to lead Wedding Gift and now closes it, so each of its three
     branches moved: Jewellery up one, Bouquet up one, Gajrays to the end. */
  var WEDDING_SUB_SHIFT = { sg1: "sg3", sg2: "sg1", sg3: "sg2" };
  var LEGACY_CATEGORY_MAP = {
    /* v46-v48: Headband was a top-level gr3 and Gifts was gr4. The
       two are now one Small Gifts at gr3, so gr4 has to land there too. */
    gr1: { category: "gr1", subcategory: "", guess: guessPurseOrBag },  /* Purse/Bags  */
    gr2: { category: "gr2", subcategory: null },          /* Wedding Gift (sg keys same) */
    gr3: { category: "gr3", subcategory: "sg2" },         /* Headband    -> Headband     */
    gr4: { category: "gr3", subcategory: null },          /* Gifts       -> Small Gifts  */
    gr5: { category: "gr4", subcategory: null, subs: SCHOOL_SUB_SHIFT } /* School Items, keys shifted */
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
    gr1: { category: "gr1", subcategory: "sg1" },        /* Purses    -> Purses        */
    gr2: { category: "gr2", subcategory: "sg1" },        /* Gajrays   -> Wedding Gift  */
    gr3: { category: "gr3", subcategory: "sg1" },        /* Keychains -> Small Gifts   */
    gr4: { category: "gr4", subcategory: "sg1" },        /* Bags      -> School Items  */
    gr5: { category: "gr2", subcategory: "sg2" },        /* Jewellery -> Wedding Gift  */
    gr6: { category: "gr3", subcategory: "sg2" },        /* Headband  -> Small Gifts   */
    gr7: { category: "gr2", subcategory: "sg3" },        /* Bouquet   -> Wedding Gift  */
    gr8: { category: "gr3", subcategory: "" }            /* Gifts     -> Small Gifts   */
  };

  /* Used only by the migrations above: a flat Purse/Bags row is filed under
     whichever branch its name points at. "bag" wins over "purse" only when the
     name says bag and never purse, so "Purse Bag" stays a purse. A bag is a
     backpack now, so it lands in School Items rather than beside the purses. */
  function guessPurseOrBag(p) {
    var n = String(p.name || "").toLowerCase();
    return /bag/.test(n) && !/purse/.test(n)
      ? { category: "gr4", subcategory: "sg1" }
      : { category: "gr1", subcategory: "sg1" };
  }

  /* The seed version that first shipped the bags under School Items. Rows saved
     at or after it are already on today's category and subcategory keys, so
     they are carried across untouched; anything older still has to be read
     through the map built for its own layout. Without this the v46-v48 map
     would be applied to recent rows too, and a hand-added School Items product
     would land in Small Gifts. */
  var BAGS_JOINED_SCHOOL_V = 63;

  /* The seed version that first shipped Wedding Gift as Jewellery, Bouquet,
     Gajrays. Rows saved at or after it are already on those keys. */
  var GAJRAYS_LAST_V = 67;

  /* Moves a Wedding Gift row off the old branch order and onto today's. Safe to
     run on any older row: a key that is not one of the three is left alone. */
  function shiftWeddingBranches(p) {
    if (p.category !== "gr2") return;
    var moved = WEDDING_SUB_SHIFT[p.subcategory];
    if (!moved) return;
    var branches = defaultSubcategories().gr2 || [];
    p.subcategory = subIndexOf(moved) < branches.length ? moved : "";
  }

  /* v49 to v62 already had today's four categories, but the bags still sat
     under Purse/Bags and School Items began at Geometry. Both moves are undone
     here, which is also what pushed the School Items keys down one place. */
  function reFileBagsMove(p) {
    if (p.category === "gr1" && p.subcategory === "sg2") {
      p.category = "gr4";
      p.subcategory = "sg1";
      return;
    }
    if (p.category !== "gr4") return;
    var moved = SCHOOL_SUB_SHIFT[p.subcategory];
    if (!moved) return;
    /* A branch that has been removed since - the pencil boxes - has nowhere to
       shift to, so the row falls back to sitting straight under the category
       rather than on a key that names nothing. */
    var branches = defaultSubcategories().gr4 || [];
    p.subcategory = subIndexOf(moved) < branches.length ? moved : "";
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
        /* Rows saved under v46-v48 used the layout where Headband and Gifts
           were separate top-level categories, v45 the six category one, v49 to
           v62 today's categories but with the bags still under Purse/Bags, v63
           onwards the bags under School Items, and v67 onwards the Wedding Gift
           branches in their current order. */
        var version = parseInt(String(key).replace(/^gulnish-products-v/, ""), 10);
        var map = version >= 46
          ? LEGACY_CATEGORY_MAP
          : (version === 45 ? LEGACY_CATEGORY_MAP_SIX : LEGACY_CATEGORY_MAP_ORIGINAL);
        old.forEach(function (raw) {
          if (!raw || typeof raw !== "object") return;
          if (String(raw.id || "").indexOf("seed_") === 0) return;

          var p = normalizeProduct(raw);
          if (version < BAGS_JOINED_SCHOOL_V) {
            if (version >= 49) reFileBagsMove(p);
            else if (map[raw.category]) {
              var target = map[raw.category];
              p.category = target.category;
              if (target.subcategory != null) p.subcategory = target.subcategory;
              /* Purse/Bags used to be one flat list, so the old row cannot say
                 which branch it belonged to. Fall back to the product's own
                 name: anything calling itself a bag is a backpack and goes to
                 School Items, the rest to Purses, which is the far larger of
                 the two. */
              if (target.guess) {
                var guess = target.guess(p);
                p.category = guess.category;
                if (guess.subcategory != null) p.subcategory = guess.subcategory;
              }
              if (target.subs && target.subs[p.subcategory]) {
                p.subcategory = target.subs[p.subcategory];
              }
            }
          }
          /* Every map above is written in its own era's numbering, and so is a
             row carried from v49 onwards, so the Wedding Gift reorder is the
             one move every older row still needs. */
          if (version < GAJRAYS_LAST_V) shiftWeddingBranches(p);
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
      var baseKw = (CATEGORY_KEYWORDS[place.category] || [label.toLowerCase()]).slice();
      if (GROUP_KEYWORDS[key]) baseKw = baseKw.concat(GROUP_KEYWORDS[key]);

      /* A group with no photos yet still gets PLACEHOLDER_COUNTS products, so
         a brand new section is not empty. Those products carry no price: there
         is nothing to quote until the real item and its cost are entered. */
      var photos = RAW_IMAGES[key];
      var count = photos.length || (PLACEHOLDER_COUNTS[key] || 0);
      for (var i = 0; i < count; i += 1) {
        var id = "seed_" + key + "_" + (i + 1);
        var real = REAL_PRODUCTS[id];
        /* Built per product, not accumulated across the group: a shared
           accumulator would hand every product the terms of the ones before
           it, so a search for "tassel" would match 20 unrelated purses. */
        var kw = baseKw.slice();
        if (PRODUCT_KEYWORDS[id]) kw = kw.concat(PRODUCT_KEYWORDS[id]);
        var price = photos.length
          ? (PRODUCT_PRICES[id] || (real ? real.price : (BASE_PRICE[key] || 500) + (i % 4) * 50))
          : 0;
        out.push({
          id: id,
          /* A real entry may carry a price but no name yet (jewellery 9 was
             sent that way), so fall back to the generated label rather than
             printing "undefined". */
          name: real && real.name ? real.name : name + " " + (i + 1),
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
      categoryImagesVersion: CATEGORY_IMAGES_VERSION,
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
    /* Category photos are keyed by grN, so a re-laid-out shop must not
       keep them - a saved keychain photo would end up on whatever now sits
       at gr3. CATEGORY_IMAGES_VERSION covers the gentler case: the layout
       is unchanged but the bundled photos are not, so the new sets win once
       and any photo the owner uploads afterwards is kept from then on. */
    var sameCategoryImages = base.categoryImagesVersion === CATEGORY_IMAGES_VERSION;
    if (sameCategoryImages && base.categoryImages && typeof base.categoryImages === "object") {
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

    /* ---- product URLs ----
       Each product needs a URL of its own to be findable and linkable, and
       that URL has to survive a rename: a name is copy the shop owner edits,
       while the photo file is what the product is. So the slug is taken from
       the image ("images/purses/purse-15.webp" -> "purse-15"), and only falls
       back to the row id ("seed_purses_15" -> "purses-15") when a product has
       no photo of its own to name it after. */
    productSlug: function (p) {
      if (!p) return "";
      var img = String(p.image || "").split("?")[0];
      var stem = img.slice(img.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, "");
      if (stem) return stem.toLowerCase();
      var id = String(p.id || "");
      var m = id.match(/^seed_(.+?)_(\d+)$/);
      return m ? (m[1] + "-" + m[2]).toLowerCase() : id.toLowerCase();
    },

    /* The product a /product/<slug> URL is asking for, or null. */
    productBySlug: function (slug) {
      var want = String(slug || "").trim().toLowerCase();
      if (!want) return null;
      var list = GC.products || [];
      for (var i = 0; i < list.length; i++) {
        if (GC.productSlug(list[i]) === want) return list[i];
      }
      return null;
    },

    /* Two photos of one design (the same piece shot twice) must not become two
       pages competing under one name: the first product with a given name owns
       the address, and the rest point at it. Keeps a duplicate title out of the
       index and gives both photos one place to be found. */
    canonicalProductSlug: function (p) {
      var name = String((p && p.name) || "").trim().toLowerCase();
      if (!name) return GC.productSlug(p);
      var list = GC.products || [];
      for (var i = 0; i < list.length; i++) {
        if (String((list[i] && list[i].name) || "").trim().toLowerCase() === name) {
          return GC.productSlug(list[i]);
        }
      }
      return GC.productSlug(p);
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
      /* First rejection means the columns are not there yet: drop them and try
         once more so the order itself is never lost over a delivery field. */
      if (res.error && isMissingOrderDeliveryColumns(res.error)) {
        orderDeliveryColumnMissing = true;
        var retry = orderToRow(order);
        res = await sb.from("orders").upsert(retry, { onConflict: "id" });
      }
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
        /* JSON.stringify drops the undefined delivery fields, so an unmigrated
           orders table never sees a column it does not have. */
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

    /* Keychains ship at a flat Rs. 250 whatever is in the basket, so the
       charge is added once per order rather than per item. It is kept out of
       every product's price range on purpose: folding it in would repeat the
       250 for each keychain and misstate what the piece itself costs. Every
       other category is still quoted on WhatsApp, as before. */
    KEYCHAIN_DELIVERY: 250,

    /* True for a cart line that is one of the keychains. Seeded keychains are
       the Small Gifts -> Keychains branch; the live catalog is consulted
       rather than the cart copy so an owner-added keychain is recognised too. */
    isKeychainItem: function (item) {
      if (!item) return false;
      var found = (GC.products || []).find(function (x) { return x.id === item.id; });
      var p = found || item;
      if (found) return p.category === "gr3" && p.subcategory === "sg1";
      /* No catalog row: fall back to the id, which is how every seeded
         keychain is named. */
      return /^seed_keychains_/.test(String(item.id || ""));
    },

    /* The delivery charge owed by a cart, so the cart page, the drawer, the
       checkout and the order email all quote the same figure. */
    deliveryCharge: function (items) {
      var list = Array.isArray(items) ? items : [];
      if (!list.some(function (i) { return GC.isKeychainItem(i); })) return 0;
      return GC.KEYCHAIN_DELIVERY;
    },

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
      /* Only sent when there is a charge, so an orders table that has not been
         migrated yet never receives an unknown column for orders that never
         carried one. The REST upsert would reject the whole row otherwise. */
      delivery_charge: orderDeliveryColumnMissing ? undefined : (o.deliveryCharge || 0),
      grand_total: orderDeliveryColumnMissing
        ? undefined
        : (o.grandTotal != null ? o.grandTotal : null),
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
