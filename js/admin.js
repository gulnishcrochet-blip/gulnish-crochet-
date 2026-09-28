/* =========================================================
   Product Manager (admin.html) logic — advanced order system
   ========================================================= */
(function () {
  "use strict";

  var GC = window.GC;

  /* ---------- UI chrome: progress, mobile nav ---------- */
  var header = document.querySelector(".site-header");
  var progressBar = document.getElementById("scrollProgress");
  var navToggle = document.getElementById("navToggle");
  var mainNav = document.getElementById("mainNav");

  if (navToggle && mainNav) {
    navToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      mainNav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", mainNav.classList.contains("open") ? "true" : "false");
      if (mainNav.classList.contains("open")) {
        var link = mainNav.querySelector("a");
        if (link) link.focus();
      }
    });
    mainNav.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { mainNav.classList.remove("open"); });
  }

  var onScroll = function () {
    if (header) header.classList.toggle("scrolled", window.scrollY > 30);
    if (progressBar) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
    }
    var backToTop = document.getElementById("backToTop");
    if (backToTop) backToTop.classList.toggle("show", window.scrollY > 560);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var backToTop = document.getElementById("backToTop");
  if (backToTop) {
    backToTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  var editingId = null;
  var imageData = "";
  var pendingImageFile = null;

  function money(value) {
    var n = parseFloat(value) || 0;
    var str = String(Math.round(n * 100) / 100);
    var parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "Rs. " + parts.join(".");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getProducts() {
    return (GC && GC.products) || [];
  }
  function stockLabel(p) {
    var s = stockStatusOf(p);
    if (s === "made to order") return "Made to order";
    return "In stock";
  }
  function getSettings() {
    return (GC && GC.settings) || {};
  }

  /* ---------- auth refs ---------- */
  var loginOverlay = document.getElementById("adminLoginOverlay");
  var loginEmail = document.getElementById("adminLoginEmail");
  var loginPassword = document.getElementById("adminLoginPassword");
  var loginBtn = document.getElementById("adminLoginBtn");
  var loginErr = document.getElementById("adminLoginErr");
  var adminWrap = document.getElementById("adminWrap");
  var adminSignOut = document.getElementById("adminSignOut");
  var adminDemoNote = document.getElementById("adminDemoNote");

  /* ---------- category select ---------- */
  var pCategory = document.getElementById("pCategory");
  var pSubCategory = document.getElementById("pSubCategory");
  function stockStatusOf(p) {
    var s = String((p && p.status) || "").trim().toLowerCase();
    if (s === "made to order" || s === "made-to-order") return "made to order";
    return "in stock";
  }
  function fillCategorySelect(settings, selected) {
    pCategory.innerHTML = "";
    (settings.categories || []).forEach(function (label, i) {
      var opt = document.createElement("option");
      opt.value = "gr" + (i + 1);
      opt.textContent = label || "Category " + (i + 1);
      pCategory.appendChild(opt);
    });
    if (selected) pCategory.value = selected;
    fillSubCategorySelect(settings, pCategory.value, "");
  }

  /* "None" is always offered and always means an empty subcategory key. */
  function fillSubCategorySelect(settings, catKey, selected) {
    if (!pSubCategory) return;
    pSubCategory.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "None (file under the category)";
    pSubCategory.appendChild(none);
    var subs = (settings && settings.subcategories && settings.subcategories[catKey]) || [];
    subs.forEach(function (label, i) {
      var opt = document.createElement("option");
      opt.value = "sg" + (i + 1);
      opt.textContent = label;
      pSubCategory.appendChild(opt);
    });
    pSubCategory.value = selected || "";
    /* A category with no subcategories cannot store one, so the control is
       disabled rather than silently dropping the value on save. */
    pSubCategory.disabled = !subs.length;
  }

  if (pCategory && pSubCategory) {
    pCategory.addEventListener("change", function () {
      fillSubCategorySelect(getSettings(), pCategory.value, "");
    });
  }

  /* ---------- color rows ---------- */
  var colorRows = document.getElementById("colorRows");
  var addColorBtn = document.getElementById("addColor");
  function addColorRow(name, hex) {
    var row = document.createElement("div");
    row.className = "color-row";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Color name";
    nameInput.value = name || "";
    nameInput.className = "color-name";

    var hexInput = document.createElement("input");
    hexInput.type = "color";
    hexInput.value = hex || "#d9a5b0";
    hexInput.className = "color-hex";

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "color-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.setAttribute("aria-label", "Remove color");
    removeBtn.addEventListener("click", function () { row.remove(); });

    row.appendChild(nameInput);
    row.appendChild(hexInput);
    row.appendChild(removeBtn);
    colorRows.appendChild(row);
  }

  function collectColors() {
    return Array.from(colorRows.querySelectorAll(".color-row")).map(function (row) {
      return {
        name: row.querySelector(".color-name").value.trim(),
        hex: row.querySelector(".color-hex").value
      };
    });
  }

  function clearColorRows() {
    colorRows.innerHTML = "";
  }

  /* ---------- form refs ---------- */
  var pName = document.getElementById("pName");
  var pPrice = document.getElementById("pPrice");
  var pStatus = document.getElementById("pStatus");
  var pStock = document.getElementById("pStock");
  var pKeywords = document.getElementById("pKeywords");
  var pImage = document.getElementById("pImage");
  var pImagePreview = document.getElementById("pImagePreview");
  var pImageClear = document.getElementById("pImageClear");
  var pGallery = document.getElementById("pGallery");
  var saveProductBtn = document.getElementById("saveProduct");
  var cancelEditBtn = document.getElementById("cancelEdit");
  var deleteProductBtn = document.getElementById("deleteProduct");
  var formTitle = document.getElementById("formTitle");
  var subcategoryWarn = document.getElementById("subcategoryWarn");

  function resetForm() {
    editingId = null;
    imageData = "";
    pendingImageFile = null;
    pName.value = "";
    pPrice.value = "";
    if (pStatus) pStatus.value = "in stock";
    if (pStock) pStock.value = "";
    if (pKeywords) pKeywords.value = "";
    if (pGallery)     pGallery.value = "";
    pImage.value = "";
    pImagePreview.hidden = true;
    pImagePreview.removeAttribute("src");
    pImageClear.hidden = true;
    fillSubCategorySelect(getSettings(), pCategory.value, "");
    clearColorRows();
    addColorRow("", "#d9a5b0");
    formTitle.textContent = "Add product";
    saveProductBtn.textContent = "Save Product";
    cancelEditBtn.hidden = true;
    deleteProductBtn.hidden = true;
  }

  /* ---------- image handling ---------- */
  pImage.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    pendingImageFile = file;
    var reader = new FileReader();
    reader.onload = function () {
      imageData = reader.result;
      pImagePreview.src = imageData;
      pImagePreview.hidden = false;
      pImageClear.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  pImageClear.addEventListener("click", function () {
    imageData = "";
    pendingImageFile = null;
    pImage.value = "";
    pImagePreview.hidden = true;
    pImagePreview.removeAttribute("src");
    pImageClear.hidden = true;
  });

  /* ---------- save / update ---------- */
  async function saveProduct() {
    var name = pName.value.trim();
    if (!name) {
      pName.focus();
      return;
    }

    var img = imageData;
    if (pendingImageFile) {
      var up = await GC.uploadImage(pendingImageFile);
      if (up && up.url) img = up.url;
      pendingImageFile = null;
    }

    var product = {
      id: editingId || "p" + Date.now().toString(36),
      name: name,
      price: parseFloat(pPrice.value) || 0,
      category: pCategory.value,
      subcategory: pSubCategory ? pSubCategory.value : "",
      status: pStatus ? pStatus.value : "in stock",
      stock: pStock && pStock.value !== "" ? Math.max(0, parseInt(pStock.value, 10) || 0) : null,
      image: img,
      keywords: pKeywords
        ? (pKeywords.value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
        : [],
      colors: collectColors().filter(function (c) { return c.name; }),
      gallery: pGallery
        ? pGallery.value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean)
        : []
    };

    if (GC.saveProduct) await GC.saveProduct(product);
    if (subcategoryWarn && GC.subcategoryColumnMissing) subcategoryWarn.hidden = false;
    resetForm();
    renderList();
  }

  saveProductBtn.addEventListener("click", saveProduct);
  cancelEditBtn.addEventListener("click", resetForm);

  deleteProductBtn.addEventListener("click", async function () {
    if (editingId && confirm("Delete this product?")) {
      if (GC.deleteProduct) await GC.deleteProduct(editingId);
      resetForm();
      renderList();
    }
  });

  addColorBtn.addEventListener("click", function () { addColorRow(); });

  /* ---------- edit ---------- */
  function editProduct(product) {
    editingId = product.id;
    imageData = product.image || "";
    pendingImageFile = null;
    pName.value = product.name || "";
    pPrice.value = product.price || "";
    if (pStatus) pStatus.value = stockStatusOf(product);
    if (pStock) pStock.value = product.stock != null ? product.stock : "";
    if (pKeywords) pKeywords.value = (product.keywords || []).join(", ");
    if (pGallery) pGallery.value = (product.gallery || []).join("\n");
    pImage.value = "";
    clearColorRows();
    (product.colors && product.colors.length
      ? product.colors
      : [{ name: "", hex: "#d9a5b0" }]
    ).forEach(function (c) { addColorRow(c.name, c.hex); });
    formTitle.textContent = "Edit product";
    saveProductBtn.textContent = "Update Product";
    cancelEditBtn.hidden = false;
    deleteProductBtn.hidden = false;
    fillCategorySelect(getSettings(), product.category);
    fillSubCategorySelect(getSettings(), pCategory.value, product.subcategory || "");
    if (imageData) {
      pImagePreview.src = imageData;
      pImagePreview.hidden = false;
      pImageClear.hidden = false;
    } else {
      pImagePreview.hidden = true;
      pImageClear.hidden = true;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- list ---------- */
  var productList = document.getElementById("productList");
  var productCount = document.getElementById("productCount");

  function renderList() {
    var products = getProducts();
    var settings = getSettings();

    productCount.textContent = products.length ? "(" + products.length + ")" : "";

    if (!products.length) {
      productList.innerHTML =
        '<p class="admin-empty">No products yet &mdash; add your first one above.</p>';
      return;
    }

    var catLabel = function (val) {
      var idx = parseInt(val.replace("gr", ""), 10) - 1;
      if (idx >= 0 && settings.categories[idx]) return settings.categories[idx];
      return val;
    };

    var subLabel = function (p) {
      if (!p.subcategory) return "";
      var list = (settings.subcategories && settings.subcategories[p.category]) || [];
      var i = parseInt(p.subcategory.replace("sg", ""), 10) - 1;
      return i >= 0 && list[i] ? list[i] : "";
    };

    productList.innerHTML = products
      .map(function (p) {
        var sub = subLabel(p);
        return (
          '<div class="admin-item">' +
          '<div class="admin-item__img">' + (p.image ? '<img src="' + p.image + '" alt="">' : "") + "</div>" +
          '<div class="admin-item__info">' +
          '<div class="admin-item__name">' + escapeHtml(p.name) + "</div>" +
          '<div class="admin-item__meta">' +
          (money(p.price) || "No price") + " &middot; " + escapeHtml(catLabel(p.category)) +
          (sub ? " &middot; " + escapeHtml(sub) : "") +
          " &middot; " + (p.colors || []).length + " color(s)" +
          '</div><div class="admin-stock stock-' + stockStatusOf(p).replace(" ", "-") + '">' + stockLabel(p) + "</div></div>" +
          '<div class="admin-item__actions">' +
          '<button type="button" data-edit="' + p.id + '">Edit</button>' +
          '<button type="button" class="delete" data-del="' + p.id + '">Delete</button>' +
          "</div></div>"
        );
      })
      .join("");
  }

  productList.addEventListener("click", async function (e) {
    var editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      var p = getProducts().find(function (x) { return x.id === editBtn.dataset.edit; });
      if (p) editProduct(p);
      return;
    }
    var delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      if (confirm("Delete this product?")) {
        if (GC.deleteProduct) await GC.deleteProduct(delBtn.dataset.del);
        if (editingId === delBtn.dataset.del) resetForm();
        renderList();
      }
    }
  });

  /* ---------- categories ---------- */
  var catRows = document.getElementById("catRows");
  var addCategoryBtn = document.getElementById("addCategory");

  function catSubRowHTML(label) {
    return '<div class="cat-sub">' +
      '<input type="text" class="cat-sub-name" value="' + escapeHtml(label) + '" placeholder="Subcategory name">' +
      '<button type="button" class="cat-sub-remove" aria-label="Remove subcategory">&times;</button>' +
      "</div>";
  }

  function catSubsHTML(subs) {
    return '<div class="cat-subs">' +
      (subs || []).map(catSubRowHTML).join("") +
      '<button type="button" class="cat-sub-add">+ Subcategory</button>' +
      "</div>";
  }

  function categoryRowHTML(label, index, subs) {
    return '<div class="cat-row">' +
      '<div class="cat-row__main">' +
      '<input type="text" class="cat-name" value="' + escapeHtml(label) + '" placeholder="Category ' + (index + 1) + '">' +
      '<button type="button" class="cat-remove" aria-label="Remove category" hidden>&times;</button>' +
      "</div>" +
      catSubsHTML(subs) +
      "</div>";
  }

  function updateRemoveButtons() {
    var rows = catRows.querySelectorAll(".cat-row");
    if (rows.length <= 1) {
      rows.forEach(function (row) { row.querySelector(".cat-remove").hidden = true; });
      return;
    }
    rows.forEach(function (row) { row.querySelector(".cat-remove").hidden = false; });
  }

  function renderCategoryInputs() {
    var settings = getSettings();
    var cats = settings.categories || [];
    var subs = settings.subcategories || {};
    catRows.innerHTML = cats
      .map(function (label, i) {
        return categoryRowHTML(label, i, subs["gr" + (i + 1)]);
      })
      .join("");
    updateRemoveButtons();
  }

  addCategoryBtn.addEventListener("click", function () {
    var row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = categoryRowHTML("", catRows.querySelectorAll(".cat-row").length, []);
    catRows.appendChild(row);
    updateRemoveButtons();
    row.querySelector(".cat-name").focus();
  });

  catRows.addEventListener("click", function (e) {
    var addSubBtn = e.target.closest(".cat-sub-add");
    if (addSubBtn) {
      var holder = document.createElement("div");
      holder.innerHTML = catSubRowHTML("");
      var sub = holder.firstElementChild;
      addSubBtn.parentNode.insertBefore(sub, addSubBtn);
      sub.querySelector(".cat-sub-name").focus();
      return;
    }
    var removeSubBtn = e.target.closest(".cat-sub-remove");
    if (removeSubBtn) {
      removeSubBtn.closest(".cat-sub").remove();
      return;
    }
    var removeBtn = e.target.closest(".cat-remove");
    if (!removeBtn) return;
    var rows = catRows.querySelectorAll(".cat-row");
    if (rows.length <= 1) return;
    removeBtn.closest(".cat-row").remove();
    updateRemoveButtons();
  });

  var saveCategoriesBtn = document.getElementById("saveCategories");
  saveCategoriesBtn.addEventListener("click", async function () {
    var rows = Array.from(catRows.querySelectorAll(".cat-row"));
    var names = rows.map(function (row) {
      return row.querySelector(".cat-name").value.trim();
    });
    /* The inputs are the source of truth: the grN keys are re-derived from the
       row order on every save, so adding, removing or blanking a subcategory
       needs no bookkeeping. Blank subcategory names are dropped rather than
       saved as empty pills. */
    var subcategories = {};
    rows.forEach(function (row, i) {
      subcategories["gr" + (i + 1)] = Array.from(row.querySelectorAll(".cat-sub-name"))
        .map(function (input) { return input.value.trim(); })
        .filter(Boolean);
    });

    var settings = getSettings();
    settings.categories = names.length ? names : defaultCategoryNames();
    settings.subcategories = subcategories;
    if (GC.saveSettings) await GC.saveSettings(settings);
    fillCategorySelect(getSettings(), pCategory.value);
    renderCategoryInputs();
    renderCategoryImageEditor();
    renderList();
    alert("Categories saved.");
  });

  function defaultCategoryNames() {
    return ["Purse/Bags", "Wedding Gift", "Headband", "Small Gifts", "School Items"];
  }

  /* ---------- category images ---------- */
  var catImageRows = document.getElementById("catImageRows");

  function renderCategoryImageEditor() {
    if (!catImageRows) return;
    var settings = getSettings();
    var cats = settings.categories || [];
    var imgs = settings.categoryImages || {};
    catImageRows.innerHTML = cats
      .map(function (label, i) {
        var key = "gr" + (i + 1);
        var list = Array.isArray(imgs[key]) ? imgs[key] : [];
        var thumbs = list
          .map(function (src, idx) {
            return (
              '<span class="cat-img">' +
              '<img src="' + src + '" alt="" data-key="' + key + '" data-idx="' + idx + '">' +
              '<button type="button" class="cat-img__remove" data-key="' + key + '" data-idx="' + idx + '" aria-label="Remove image">&times;</button>' +
              "</span>"
            );
          })
          .join("");
        return (
          '<div class="cat-img-row">' +
          '<span class="cat-img-row__name">' + escapeHtml(label || "Category " + (i + 1)) + "</span>" +
          '<div class="cat-img-row__thumbs">' +
          (thumbs || '<span class="cat-img-row__empty">No images yet</span>') +
          "</div>" +
          (list.length < 5
            ? '<label class="btn btn--small btn--ghost cat-img-upload">Add photo<input type="file" accept="image/*" data-key="' + key + '" hidden></label>'
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  catImageRows.addEventListener("change", async function (e) {
    var input = e.target.closest('input[type="file"][data-key]');
    if (!input) return;
    var file = input.files && input.files[0];
    if (!file) return;
    var key = input.dataset.key;

    var settings = getSettings();
    settings.categoryImages = settings.categoryImages || {};
    var list = Array.isArray(settings.categoryImages[key]) ? settings.categoryImages[key].slice() : [];
    if (list.length >= 5) {
      alert("Maximum 5 images per category.");
      input.value = "";
      return;
    }

    var up = await GC.uploadImage(file);
    var imgUrl = (up && up.url) || null;
    if (!imgUrl) {
      imgUrl = await readAsDataURL(file);
    }
    if (!imgUrl) return;
    list.push(imgUrl);
    settings.categoryImages[key] = list;
    if (GC.saveSettings) await GC.saveSettings(settings);
    renderCategoryImageEditor();
    input.value = "";
  });

  function readAsDataURL(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  catImageRows.addEventListener("click", async function (e) {
    var removeBtn = e.target.closest(".cat-img__remove");
    if (!removeBtn) return;
    var settings = getSettings();
    var key = removeBtn.dataset.key;
    var idx = parseInt(removeBtn.dataset.idx, 10);
    var list = (settings.categoryImages && settings.categoryImages[key]) || [];
    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
    settings.categoryImages[key] = list;
    if (GC.saveSettings) await GC.saveSettings(settings);
    renderCategoryImageEditor();
  });

  /* ---------- shop settings ---------- */
  var shopWhatsAppInput = document.getElementById("shopWhatsApp");
  var shopCraftDaysInput = document.getElementById("shopCraftDays");
  var shopDeliveryDaysInput = document.getElementById("shopDeliveryDays");
  var shopBankTitleInput = document.getElementById("shopBankTitle");
  var shopBankAccountInput = document.getElementById("shopBankAccount");
  var shopBankIBANInput = document.getElementById("shopBankIBAN");
  var shopJazzcashInput = document.getElementById("shopJazzcash");
  var shopEasypaisaInput = document.getElementById("shopEasypaisa");
  var saveShopSettingsBtn = document.getElementById("saveShopSettings");

  function renderShopSettings() {
    var s = getSettings();
    if (shopWhatsAppInput) shopWhatsAppInput.value = s.whatsapp || "03075729901";
    if (shopCraftDaysInput) shopCraftDaysInput.value = s.craftDays || "";
    if (shopDeliveryDaysInput) shopDeliveryDaysInput.value = s.deliveryDays || "";
    if (shopBankTitleInput) shopBankTitleInput.value = s.bankAccountTitle || "";
    if (shopBankAccountInput) shopBankAccountInput.value = s.bankAccountNo || "";
    if (shopBankIBANInput) shopBankIBANInput.value = s.bankIBAN || "";
    if (shopJazzcashInput) shopJazzcashInput.value = s.jazzcashNumber || "";
    if (shopEasypaisaInput) shopEasypaisaInput.value = s.easypaisaNumber || "";
  }

  if (saveShopSettingsBtn) {
    saveShopSettingsBtn.addEventListener("click", async function () {
      var settings = getSettings();
      settings.whatsapp = (shopWhatsAppInput.value || "").trim();
      settings.craftDays = parseInt(shopCraftDaysInput.value || "0", 10) || 0;
      settings.deliveryDays = parseInt(shopDeliveryDaysInput.value || "0", 10) || 0;
      settings.bankAccountTitle = (shopBankTitleInput.value || "").trim();
      settings.bankAccountNo = (shopBankAccountInput.value || "").trim();
      settings.bankIBAN = (shopBankIBANInput.value || "").trim();
      settings.jazzcashNumber = (shopJazzcashInput.value || "").trim();
      settings.easypaisaNumber = (shopEasypaisaInput.value || "").trim();
      if (GC.saveSettings) await GC.saveSettings(settings);
      alert("Shop settings saved.");
    });
  }

  /* =========================================================
     PROFESSIONAL ORDER MANAGEMENT
     ========================================================= */

  var ORDER_STATUSES = (GC && GC.ORDER_STATUSES) || [
    "Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"
  ];

  function getOrders() {
    return (GC && GC.orders) || [];
  }

  function orderDateShort(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric", month: "short", year: "numeric"
      });
    } catch (e) {
      return "";
    }
  }

  function orderDateTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: "numeric", month: "short", year: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function friendlyDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
      });
    } catch (e) {
      return "";
    }
  }

  function statusBadge(status) {
    var s = escapeHtml(status || "Pending");
    var cls = (status || "Pending").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return '<span class="order-status order-status--' + cls + '">' + s + "</span>";
  }

  function payBadge(o) {
    var pay = (o && o.payment) || {};
    var method = pay.method || "Cash on delivery";
    if (String(pay.status || "").toLowerCase() === "paid") {
      return '<span class="pay-badge pay-badge--paid">Paid</span>';
    }
    if (method.toLowerCase() === "cash on delivery") {
      return '<span class="pay-badge pay-badge--pending">Awaiting payment</span>';
    }
    return '<span class="pay-badge pay-badge--pending">Awaiting payment</span>';
  }

  var adminOrders = document.getElementById("adminOrders");
  var orderCount = document.getElementById("orderCount");
  var orderSearch = document.getElementById("orderSearchInput");
  var orderStatusFilter = document.getElementById("orderStatusFilter");
  var orderStatsEl = document.getElementById("orderStats");
  var bulkActionsEl = document.getElementById("bulkActions");
  var bulkStatusSelect = document.getElementById("bulkStatusSelect");
  var bulkApplyBtn = document.getElementById("bulkApplyBtn");
  var bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
  var selectAllOrders = document.getElementById("selectAllOrders");

  var _selectedOrders = new Set();
  var _openOrders = new Set();
  var _orderSearchDebounce = null;

  function renderOrderStats() {
    if (!orderStatsEl) return;
    var stats = (GC && GC.getOrderStats) ? GC.getOrderStats() : {};
    var d = {
      total: stats.total || 0,
      pending: stats.pending || 0,
      progress: (stats.confirmed || 0) + (stats.processing || 0) + (stats.shipped || 0),
      delivered: stats.delivered || 0,
      cancelled: stats.cancelled || 0,
      revenue: stats.revenue || 0,
      today: stats.todayOrders || 0,
      paid: stats.paidCount || 0
    };

    orderStatsEl.innerHTML =
      '<div class="stat-card stat-card--total"><span class="stat-card__value">' + d.total + '</span><span class="stat-card__label">Total Orders</span></div>' +
      '<div class="stat-card stat-card--pending"><span class="stat-card__value">' + d.pending + '</span><span class="stat-card__label">Pending</span></div>' +
      '<div class="stat-card stat-card--progress"><span class="stat-card__value">' + d.progress + '</span><span class="stat-card__label">In Progress</span></div>' +
      '<div class="stat-card stat-card--shipped"><span class="stat-card__value">' + d.shipped + '</span><span class="stat-card__label">Shipped</span></div>' +
      '<div class="stat-card stat-card--delivered"><span class="stat-card__value">' + d.delivered + '</span><span class="stat-card__label">Delivered</span></div>' +
      '<div class="stat-card stat-card--paid"><span class="stat-card__value">' + d.paid + '</span><span class="stat-card__label">Paid</span></div>' +
      '<div class="stat-card stat-card--today"><span class="stat-card__value">' + d.today + '</span><span class="stat-card__label">Today</span></div>' +
      '<div class="stat-card stat-card--revenue"><span class="stat-card__value">' + money(d.revenue) + '</span><span class="stat-card__label">Revenue</span></div>';
  }

  function getFilteredOrders() {
    var query = orderSearch ? orderSearch.value.trim() : "";
    var status = orderStatusFilter ? orderStatusFilter.value : "";
    if (GC && GC.searchOrders) return GC.searchOrders(query, status);
    return getOrders();
  }

  /* ---------- order card (collapsed) ---------- */
  function orderCardHTML(o) {
    var cust = o.customer || {};
    var items = o.items || [];
    var isSelected = _selectedOrders.has(o.id);
    var isOpen = _openOrders.has(o.id);
    var itemSummary = items
      .slice(0, 2)
      .map(function (i) { return escapeHtml(i.name) + " x" + i.qty; })
      .join(", ");
    if (items.length > 2) itemSummary += " +" + (items.length - 2) + " more";

    return (
      '<div class="admin-order' + (isSelected ? " admin-order--selected" : "") + (isOpen ? " admin-order--open" : "") + '" data-order-card="' + escapeHtml(o.id) + '">' +
      '<div class="admin-order__bar" data-order-toggle="' + escapeHtml(o.id) + '">' +
      '<label class="admin-order__check" aria-label="Select order">' +
      '<input type="checkbox" data-ordercheck="' + escapeHtml(o.id) + '"' + (isSelected ? " checked" : "") + ">" +
      "</label>" +
      '<div class="admin-order__main">' +
      '<div class="admin-order__row1">' +
      '<span class="admin-order__no">' + escapeHtml(o.id) + "</span>" +
      '<span class="admin-order__cust">' + escapeHtml(cust.name || "Customer") + "</span>" +
      statusBadge(o.status) +
      payBadge(o) +
      "</div>" +
      '<div class="admin-order__row2">' +
      escapeHtml(orderDateTime(o.placedAt)) +
      " &middot; " + money(o.total) +
      " &middot; " + (items.length || 0) + " item(s)" +
      (cust.city ? " &middot; " + escapeHtml(cust.city) : "") +
      "</div>" +
      '<div class="admin-order__sk">' + (itemSummary || "No items") + "</div>" +
      "</div>" +
      '<span class="admin-order__chev" aria-hidden="true">' + (isOpen ? "&#9650;" : "&#9660;") + "</span>" +
      "</div>" +
      orderDetailHTML(o) +
      "</div>"
    );
  }

  /* ---------- order detail (expanded) ---------- */
  function orderDetailHTML(o) {
    var cust = o.customer || {};
    var items = o.items || [];
    var pay = o.payment || {};

    var itemsHTML = items
      .map(function (i) {
        return '<div class="ad-order-item">' +
          '<span class="ad-order-item__img">' +
          (i.image ? '<img src="' + i.image + '" alt="" loading="lazy" decoding="async">' : "<span>&#128722;</span>") +
          "</span>" +
          '<span class="ad-order-item__name">' + escapeHtml(i.name) + (i.color ? " <span class='muted'>(" + escapeHtml(i.color) + ")</span>" : "") + "</span>" +
          '<span class="ad-order-item__qty">x' + i.qty + "</span>" +
          '<span class="ad-order-item__price">' + money((i.price || 0) * i.qty) + "</span>" +
          "</div>";
      })
      .join("");

    var statusOpts = ORDER_STATUSES.map(function (s) {
      return '<option value="' + escapeHtml(s) + '"' + (s === (o.status || "Pending") ? " selected" : "") + ">" + escapeHtml(s) + "</option>";
    }).join("");

    var historyHTML = (Array.isArray(o.statusHistory) && o.statusHistory.length
      ? o.statusHistory.map(function (h) {
          return '<div class="ad-order-history__row">' +
            '<span class="ad-order-history__dot"></span>' +
            '<span class="ad-order-history__status">' + escapeHtml(h.status) + "</span>" +
            '<span class="ad-order-history__when">' + escapeHtml(orderDateTime(h.at)) + "</span>" +
            (h.note ? '<span class="ad-order-history__note">' + escapeHtml(h.note) + "</span>" : "") +
            "</div>";
        }).join("")
      : '<div class="muted">No status history yet.</div>');

    var canShowEst = o.estDelivery &&
      String(o.status || "").toLowerCase() !== "cancelled" &&
      String(o.status || "").toLowerCase() !== "delivered";
    var wa = (GC && GC.shopWhatsApp) ? GC.shopWhatsApp() : "";

    var phoneDigits = String(cust.phone || "").replace(/[^\d]/g, "").replace(/^0+/, "");

    return (
      '<div class="admin-order__detail" hidden>' +
      '<div class="ad-order-grid-r">' +
      '<div class="ad-order-block">' +
      '<h4>Customer</h4>' +
      '<p><strong>' + escapeHtml(cust.name || "—") + "</strong></p>" +
      (cust.phone ? '<p>' + (phoneDigits ? '<a class="link" href="tel:+' + escapeHtml(phoneDigits) + '">+' + escapeHtml(cust.phone) + "</a>" : escapeHtml(cust.phone)) + "</p>" : "") +
      (cust.email ? "<p>" + escapeHtml(cust.email) + "</p>" : "") +
      (cust.address || cust.city ? "<p class='muted'>" + escapeHtml(cust.address) + (cust.city ? ", " + escapeHtml(cust.city) : "") + "</p>" : "") +
      (cust.notes ? '<p class="muted"><em>Notes: ' + escapeHtml(cust.notes) + "</em></p>" : "") +
      "</div>" +
      '<div class="ad-order-block">' +
      "<h4>Totals</h4>" +
      '<div class="ad-order-items">' + (itemsHTML || '<span class="muted">No items</span>') + "</div>" +
      '<div class="ad-order-total-row"><span>Total</span><strong>' + money(o.total) + "</strong></div>" +
      "</div>" +
      "</div>" +
      '<div class="ad-order-grid-r">' +
      '<div class="ad-order-block">' +
      "<h4>Payment</h4>" +
      '<p><strong>' + escapeHtml(pay.method || "Cash on delivery") + "</strong></p>" +
      payBadge(o) +
      (String(pay.status || "").toLowerCase() !== "paid"
        ? '<button class="btn btn--small" type="button" data-payorder="' + escapeHtml(o.id) + '">Mark as paid</button>'
        : "") +
      "</div>" +
      '<div class="ad-order-block">' +
      "<h4>Status &amp; note</h4>" +
      '<div class="ad-order-status-row">' +
      '<select class="order-status-select" data-order-status="' + escapeHtml(o.id) + '" aria-label="Order status">' + statusOpts + "</select>" +
      '<input type="text" class="admin-text" data-order-note="' + escapeHtml(o.id) + '" placeholder="Internal note (optional)">' +
      '<button class="btn btn--small" type="button" data-status-apply="' + escapeHtml(o.id) + '">Update</button>' +
      "</div>" +
      (canShowEst ? '<p class="muted" style="margin-top:0.4rem">Estimated delivery: <strong>' + escapeHtml(orderDateShort(o.estDelivery)) + "</strong></p>" : "") +
      "</div>" +
      "</div>" +
      '<div class="ad-order-block">' +
      "<h4>Status history</h4>" +
      '<div class="ad-order-history">' + historyHTML + "</div>" +
      "</div>" +
      '<div class="ad-order-actions">' +
      (wa && phoneDigits
        ? '<button class="btn btn--small btn--wa-inline" type="button" data-waorder="' + escapeHtml(o.id) + '">WhatsApp customer</button>'
        : "") +
      '<button class="btn btn--small btn--ghost" type="button" data-invoice="' + escapeHtml(o.id) + '">Print invoice</button>' +
      '<button class="btn btn--small btn--danger" type="button" data-delorder="' + escapeHtml(o.id) + '">Delete</button>' +
      "</div>" +
      "</div>"
    );
  }

  function renderOrders() {
    var orders = getFilteredOrders();
    var allOrders = getOrders();

    trackNewOrders();

    if (orderCount) orderCount.textContent = allOrders.length ? "(" + allOrders.length + ")" : "";

    renderOrderStats();

    if (!adminOrders) return;
    if (!orders.length) {
      adminOrders.innerHTML = '<p class="admin-empty">No orders found.</p>';
      _selectedOrders.clear();
      updateBulkUI();
      return;
    }

    adminOrders.innerHTML = orders.map(orderCardHTML).join("");
  }

  /* ---------- new order alerts ---------- */
  var knownOrderIds = null;
  var alertEl = null;

  function showOrderAlert(msg) {
    if (!alertEl) {
      alertEl = document.createElement("div");
      alertEl.className = "admin-alert";
      document.body.appendChild(alertEl);
    }
    alertEl.textContent = msg;
    alertEl.classList.add("show");
    clearTimeout(alertEl._timer);
    alertEl._timer = setTimeout(function () {
      alertEl.classList.remove("show");
    }, 6000);
  }

  function notifyNewOrder(order) {
    if (!order || !order.id) return;
    var title = "New order " + order.id;
    var parts = [];
    if (order.customer && order.customer.name) parts.push(order.customer.name);
    if (order.total) parts.push(money(order.total));
    var itemNames = (order.items || []).slice(0, 2).map(function (i) { return i.name; }).join(", ");
    if (itemNames) parts.push(itemNames);
    showOrderAlert("\ud83d\udd14 " + title + " \u2014 " + parts.join(" \u00b7 "));
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        try { new Notification(title, { body: parts.join("\n") }); } catch (err) { /* ignore */ }
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then(function (p) {
          if (p === "granted") {
            try { new Notification(title, { body: parts.join("\n") }); } catch (err) { /* ignore */ }
          }
        });
      }
    }
  }

  function trackNewOrders() {
    var orders = getOrders();
    var ids = orders.map(function (o) { return o.id; });
    if (knownOrderIds === null) {
      knownOrderIds = new Set(ids);
      return;
    }
    ids.forEach(function (id) {
      if (knownOrderIds.has(id)) return;
      knownOrderIds.add(id);
      var o = orders.find(function (x) { return x.id === id; });
      if (o) notifyNewOrder(o);
    });
  }

  function updateBulkUI() {
    if (bulkActionsEl) bulkActionsEl.classList.toggle("show", _selectedOrders.size > 0);
    if (bulkActionsEl) {
      var countEl = bulkActionsEl.querySelector(".bulk-count");
      if (countEl) countEl.textContent = _selectedOrders.size + " selected";
    }
  }

  function toggleOrder(id, open) {
    if (open) _openOrders.add(id); else _openOrders.delete(id);
    var card = adminOrders.querySelector('[data-order-card="' + CSS.escape(id) + '"]');
    if (card) {
      card.classList.toggle("admin-order--open", open);
      var detail = card.querySelector(".admin-order__detail");
      if (detail) detail.hidden = !open;
      var chev = card.querySelector(".admin-order__chev");
      if (chev) chev.innerHTML = open ? "&#9650;" : "&#9660;";
    }
  }

  if (adminOrders) {
    /* expand / collapse */
    adminOrders.addEventListener("click", function (e) {
      var bar = e.target.closest("[data-order-toggle]");
      if (!bar) return;
      if (e.target.closest("input,select,button,a,label")) return;
      var id = bar.dataset.orderToggle;
      toggleOrder(id, !_openOrders.has(id));
    });

    /* checkbox selection */
    adminOrders.addEventListener("change", function (e) {
      var cb = e.target.closest("[data-ordercheck]");
      if (cb) {
        if (cb.checked) _selectedOrders.add(cb.dataset.ordercheck);
        else _selectedOrders.delete(cb.dataset.ordercheck);
        var row = cb.closest(".admin-order");
        if (row) row.classList.toggle("admin-order--selected", cb.checked);
        updateBulkUI();
        return;
      }
    });

    /* apply status from detail */
    adminOrders.addEventListener("click", async function (e) {
      var applyBtn = e.target.closest("[data-status-apply]");
      if (!applyBtn) return;
      var id = applyBtn.dataset.statusApply;
      var card = adminOrders.querySelector('[data-order-card="' + CSS.escape(id) + '"]');
      var sel = card ? card.querySelector('[data-order-status="' + CSS.escape(id) + '"]') : null;
      var noteInput = card ? card.querySelector('[data-order-note="' + CSS.escape(id) + '"]') : null;
      if (!sel) return;
      var status = sel.value;
      var note = noteInput ? noteInput.value.trim() : "";
      if (GC.updateOrderStatus) await GC.updateOrderStatus(id, status, note);
      renderOrders();
    });

    /* mark paid */
    adminOrders.addEventListener("click", async function (e) {
      var payBtn = e.target.closest("[data-payorder]");
      if (!payBtn) return;
      if (GC.markOrderPaid) await GC.markOrderPaid(payBtn.dataset.payorder);
      renderOrders();
    });

    /* WhatsApp notify */
    adminOrders.addEventListener("click", function (e) {
      var waBtn = e.target.closest("[data-waorder]");
      if (!waBtn) return;
      var order = getOrders().find(function (o) { return o.id === waBtn.dataset.waorder; });
      if (!order) return;
      var cust = order.customer || {};
      var phone = String(cust.phone || "").replace(/[^\d]/g, "").replace(/^0+/, "");
      if (!phone) { alert("No phone number for this order."); return; }
      var status = order.status || "Pending";
      var msg = "Hi " + (cust.name || "Customer") + ",\n\nYour order *" + order.id + "* has been updated to: *" + status + "*.\n\nItems: " +
        (order.items || []).map(function (i) { return i.name + " x" + i.qty; }).join(", ") +
        "\nTotal: " + money(order.total) +
        (order.estDelivery && status.toLowerCase() !== "cancelled"
          ? "\nEstimated delivery: " + friendlyDate(order.estDelivery)
          : "") +
        (String(status).toLowerCase() === "shipped" ? "\n\nYour order is on the way!" : "") +
        (String(status).toLowerCase() === "delivered" ? "\n\nThank you for shopping with Gulnish Crochet!" : "");
      window.open("https://wa.me/92" + phone + "?text=" + encodeURIComponent(msg), "_blank");
    });

    /* delete */
    adminOrders.addEventListener("click", async function (e) {
      var del = e.target.closest("[data-delorder]");
      if (!del) return;
      if (!confirm("Delete this order?")) return;
      if (GC.deleteOrder) await GC.deleteOrder(del.dataset.delorder);
      _selectedOrders.delete(del.dataset.delorder);
      _openOrders.delete(del.dataset.delorder);
      renderOrders();
    });

    /* print invoice */
    adminOrders.addEventListener("click", function (e) {
      var invBtn = e.target.closest("[data-invoice]");
      if (!invBtn) return;
      var order = getOrders().find(function (o) { return o.id === invBtn.dataset.invoice; });
      if (!order) return;
      printInvoice(order);
    });
  }

  function printInvoice(o) {
    var cust = o.customer || {};
    var pay = o.payment || {};
    var itemsHTML = (o.items || []).map(function (i) {
      return "<tr>" +
        "<td>" + escapeHtml(i.name) + (i.color ? " (" + escapeHtml(i.color) + ")" : "") + "</td>" +
        "<td class='ac'>" + i.qty + "</td>" +
        "<td class='ar'>" + money(i.price || 0) + "</td>" +
        "<td class='ar'>" + money((i.price || 0) * i.qty) + "</td>" +
        "</tr>";
    }).join("");
    var histHTML = (Array.isArray(o.statusHistory) ? o.statusHistory : []).map(function (h) {
      return "<li><strong>" + escapeHtml(h.status) + "</strong> &mdash; " + escapeHtml(orderDateTime(h.at)) + (h.note ? " <em>(" + escapeHtml(h.note) + ")</em>" : "") + "</li>";
    }).join("");

    var html =
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Invoice " + escapeHtml(o.id) + "</title>" +
      "<style>" +
      "body{font-family:Georgia,'Times New Roman',serif;color:#1b211d;margin:40px;line-height:1.5}" +
      ".inv-head{display:flex;justify-content:space-between;border-bottom:3px double #b98f3e;padding-bottom:16px;margin-bottom:24px}" +
      ".inv-head h1{margin:0;font-size:22px;letter-spacing:0.02em}" +
      ".inv-head .sub{color:#68706b;font-size:13px}" +
      "h2{font-size:19px;border-bottom:1px solid #e7eae8;padding-bottom:6px;margin:22px 0 10px}" +
      "table{width:100%;border-collapse:collapse;font-size:14px}" +
      "th{text-align:left;border-bottom:2px solid #d6dcd7;padding:6px 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#68706b}" +
      "td{padding:8px;border-bottom:1px solid #e7eae8}" +
      ".ar{text-align:right}.ac{text-align:center}" +
      ".totals{margin-left:auto;width:260px;margin-top:14px}" +
      ".totals div{display:flex;justify-content:space-between;padding:6px 0}" +
      ".totals .grand{border-top:2px solid #1b211d;font-weight:700;font-size:17px}" +
      ".meta p{margin:2px 0;font-size:14px}" +
      ".note{margin-top:28px;font-size:12px;color:#68706b;border-top:1px solid #e7eae8;padding-top:10px}" +
      "@media print{body{margin:20px}}" +
      "</style></head><body>" +
      "<div class='inv-head'><div>" +
      "<h1>Gulnish Crochet</h1>" +
      "<div class='sub'>Handmade crochet purses, bags, jewellery &amp; gifts</div>" +
      "</div><div class='sub'>" +
      "<div><strong>Order:</strong> " + escapeHtml(o.id) + "</div>" +
      "<div><strong>Date:</strong> " + escapeHtml(orderDateTime(o.placedAt)) + "</div>" +
      "<div><strong>Status:</strong> " + escapeHtml(o.status) + "</div>" +
      "</div></div>" +
      "<h2>Billed to</h2>" +
      "<div class='meta'>" +
      "<p><strong>" + escapeHtml(cust.name || "—") + "</strong></p>" +
      (cust.phone ? "<p>" + escapeHtml(GC && GC.formatPhone ? GC.formatPhone(cust.phone) : "+" + cust.phone) + "</p>" : "") +
      (cust.email ? "<p>" + escapeHtml(cust.email) + "</p>" : "") +
      "<p>" + escapeHtml(cust.address || "") + (cust.city ? ", " + escapeHtml(cust.city) : "") + "</p>" +
      (cust.notes ? "<p><em>Notes: " + escapeHtml(cust.notes) + "</em></p>" : "") +
      "</div>" +
      "<h2>Order items</h2>" +
      "<table><thead><tr><th>Item</th><th class='ac'>Qty</th><th class='ar'>Price</th><th class='ar'>Amount</th></tr></thead>" +
      "<tbody>" + itemsHTML + "</tbody></table>" +
      "<div class='totals'>" +
      "<div><span>Subtotal</span><span>" + money(o.total) + "</span></div>" +
      "<div><span>Delivery</span><span>Arranged</span></div>" +
      "<div class='grand'><span>Total</span><span>" + money(o.total) + "</span></div>" +
      "</div>" +
      "<h2>Payment</h2>" +
      "<div class='meta'>" +
      "<p><strong>" + escapeHtml(pay.method || "Cash on delivery") + "</strong> &mdash; " +
      (String(pay.status || "").toLowerCase() === "paid" ? "<strong>Paid</strong>" : "Awaiting payment") + "</p>" +
      (o.estDelivery ? "<p>Estimated delivery: " + escapeHtml(friendlyDate(o.estDelivery)) + "</p>" : "") +
      "</div>" +
      "<h2>Status history</h2>" +
      "<ul class='meta'>" + histHTML + "</ul>" +
      "<div class='note'>Thank you for shopping with Gulnish Crochet. For questions about this order, message us on WhatsApp.</div>" +
      "</body></html>";

    var w = window.open("", "_blank", "width=760,height=900");
    if (!w) { alert("Please allow pop-ups to print the invoice."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (err) { /* ignore */ } }, 250);
  }

  /* ---------- search / filter ---------- */
  if (orderSearch) {
    orderSearch.addEventListener("input", function () {
      clearTimeout(_orderSearchDebounce);
      _orderSearchDebounce = setTimeout(renderOrders, 200);
    });
  }
  if (orderStatusFilter) {
    orderStatusFilter.addEventListener("change", renderOrders);
  }

  /* ---------- select all ---------- */
  if (selectAllOrders) {
    selectAllOrders.addEventListener("change", function () {
      var checked = selectAllOrders.checked;
      var checkboxes = adminOrders ? adminOrders.querySelectorAll("[data-ordercheck]") : [];
      checkboxes.forEach(function (cb) {
        cb.checked = checked;
        if (checked) _selectedOrders.add(cb.dataset.ordercheck);
        else _selectedOrders.delete(cb.dataset.ordercheck);
        var row = cb.closest(".admin-order");
        if (row) row.classList.toggle("admin-order--selected", checked);
      });
      updateBulkUI();
    });
  }

  /* ---------- bulk actions ---------- */
  if (bulkApplyBtn) {
    bulkApplyBtn.addEventListener("click", async function () {
      var status = bulkStatusSelect ? bulkStatusSelect.value : "";
      if (!status || !_selectedOrders.size) return;
      if (!confirm("Change " + _selectedOrders.size + " order(s) to " + status + "?")) return;
      var ids = Array.from(_selectedOrders);
      if (GC.bulkUpdateStatus) await GC.bulkUpdateStatus(ids, status, "");
      _selectedOrders.clear();
      if (selectAllOrders) selectAllOrders.checked = false;
      renderOrders();
    });
  }

  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async function () {
      if (!_selectedOrders.size) return;
      if (!confirm("Delete " + _selectedOrders.size + " order(s)? This cannot be undone.")) return;
      var ids = Array.from(_selectedOrders);
      if (GC.bulkDeleteOrders) await GC.bulkDeleteOrders(ids);
      _selectedOrders.clear();
      if (selectAllOrders) selectAllOrders.checked = false;
      renderOrders();
    });
  }

  /* ---------- real-time order updates ---------- */
  if (GC && GC.onOrdersChanged) {
    GC.onOrdersChanged(function () {
      trackNewOrders();
      renderOrders();
    });
  }

  // Demo (localStorage) mode has no Realtime; poll shared storage so
  // orders placed in another tab of this browser still alert the admin.
  if (GC && !GC.configured && GC.refreshLocalData) {
    setInterval(function () { GC.refreshLocalData(); }, 20000);
  }

  /* ---------- auth -------- */
  function enterAdmin() {
    adminWrap.hidden = false;
    if (loginOverlay) loginOverlay.hidden = true;
    if (GC && !GC.configured && adminDemoNote) adminDemoNote.hidden = false;
    renderShopSettings();
    renderCategoryInputs();
    fillCategorySelect(getSettings(), pCategory.value || "gr1");
    if (subcategoryWarn) subcategoryWarn.hidden = !GC.subcategoryColumnMissing;
    renderCategoryImageEditor();
    addColorRow("", "#d9a5b0");
    renderList();
    renderOrders();
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", async function () {
      if (loginErr) loginErr.hidden = true;
      var email = loginEmail ? loginEmail.value.trim() : "";
      var password = loginPassword ? loginPassword.value : "";
      if (!email || !password) {
        if (loginErr) { loginErr.textContent = "Enter your email and password."; loginErr.hidden = false; }
        return;
      }
      loginBtn.disabled = true;
      var ok = await GC.signInAdmin(email, password);
      loginBtn.disabled = false;
      if (ok) {
        if (loginPassword) loginPassword.value = "";
        enterAdmin();
      } else if (loginErr) {
        loginErr.textContent = "Sign in failed. Check your email and password.";
        loginErr.hidden = false;
      }
    });

    loginPassword.addEventListener("keydown", function (e) {
      if (e.key === "Enter") loginBtn.click();
    });
    loginEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") loginBtn.click();
    });
  }

  if (adminSignOut) {
    adminSignOut.addEventListener("click", async function () {
      await GC.signOutAdmin();
      adminWrap.hidden = true;
      if (loginOverlay) loginOverlay.hidden = false;
      if (loginErr) loginErr.hidden = true;
    });
  }

  /* ---------- init ---------- */
  function init() {
    GC.checkAdminSession().then(function (isAdmin) {
      if (isAdmin) {
        enterAdmin();
      } else {
        adminWrap.hidden = true;
        if (loginOverlay) loginOverlay.hidden = false;
        if (GC && !GC.configured && adminDemoNote) adminDemoNote.hidden = false;
      }
    });
  }

  if (GC && GC.init) {
    GC.init().then(init);
  } else {
    init();
  }
})();
