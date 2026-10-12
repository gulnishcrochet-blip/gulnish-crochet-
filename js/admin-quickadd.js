/* =========================================================
   Admin quick-add — product images from the shop page
   =========================================================
   A small, admin-only uploader that lives on /products. It
   reuses the exact same GC API the full Product Manager uses
   (GC.uploadImage + GC.saveProduct), so a photo added here
   behaves like one added in /admin. The section stays hidden
   unless a signed-in admin is looking at the page.
   ========================================================= */
(function () {
  var GC = window.GC;
  if (!GC || !GC.init) return;

  var section = document.getElementById("adminAddImages");
  if (!section) return;

  var fileInput = document.getElementById("adminImageFiles");
  var listEl = document.getElementById("adminImageList");
  var catEl = document.getElementById("adminImageCategory");
  var subEl = document.getElementById("adminImageSub");
  var saveBtn = document.getElementById("adminImageSave");
  var statusEl = document.getElementById("adminImageStatus");
  var noteEl = document.getElementById("adminAddNote");

  var rows = [];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nameFromFile(file) {
    var base = (file.name || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : "New product";
  }

  function fillCategories() {
    var settings = GC.settings || {};
    var cats = settings.categories || [];
    catEl.innerHTML = cats
      .map(function (label, i) {
        return (
          '<option value="' + GC.categoryKey(i) + '">' +
          esc(label || "Category " + (i + 1)) +
          "</option>"
        );
      })
      .join("");
    var urlCat = new URLSearchParams(location.search).get("cat");
    var known = cats.some(function (_l, i) { return GC.categoryKey(i) === urlCat; });
    if (urlCat && known) catEl.value = urlCat;
    fillSubs();
  }

  function fillSubs() {
    var subs = GC.subcategoriesOf ? GC.subcategoriesOf(catEl.value) || [] : [];
    var opts = ['<option value="">None (category level)</option>'];
    subs.forEach(function (name, i) {
      opts.push(
        '<option value="' + GC.subcategoryKey(i) + '">' + esc(name) + "</option>"
      );
    });
    subEl.innerHTML = opts.join("");
    var urlSub = new URLSearchParams(location.search).get("sub");
    if (urlSub) subEl.value = urlSub;
  }

  function updateSaveBtn() {
    saveBtn.hidden = !rows.some(function (r) { return !r.saved; });
  }

  function addRow(file) {
    var row = { file: file, dataUrl: "", saved: false, el: null };
    rows.push(row);

    var reader = new FileReader();
    reader.onload = function () {
      row.dataUrl = String(reader.result || "");
      var el = document.createElement("div");
      el.className = "admin-add__row";
      el.innerHTML =
        '<span class="admin-add__thumb"><img alt="" src="' + esc(row.dataUrl) + '"></span>' +
        '<label class="admin-add__field admin-add__field--grow">Name' +
        '<input type="text" data-qa="name" value="' + esc(nameFromFile(file)) + '">' +
        "</label>" +
        '<label class="admin-add__field">Price (Rs.)' +
        '<input type="number" min="0" step="1" data-qa="price" placeholder="0">' +
        "</label>" +
        '<button class="btn btn--ghost btn--small" type="button" data-qa="remove">Remove</button>' +
        '<span class="admin-add__state" data-qa="state"></span>';

      row.el = el;
      row.nameInput = el.querySelector('[data-qa="name"]');
      row.priceInput = el.querySelector('[data-qa="price"]');
      row.stateEl = el.querySelector('[data-qa="state"]');

      el.querySelector('[data-qa="remove"]').addEventListener("click", function () {
        rows = rows.filter(function (r) { return r !== row; });
        el.remove();
        updateSaveBtn();
      });

      listEl.appendChild(el);
      updateSaveBtn();
    };
    reader.readAsDataURL(file);
  }

  async function saveAll() {
    var pending = rows.filter(function (r) { return !r.saved && r.dataUrl; });
    if (!pending.length) return;

    var cat = catEl.value || "gr1";
    var sub = subEl.value || "";
    var done = 0;
    var failed = 0;

    saveBtn.disabled = true;
    for (var i = 0; i < pending.length; i += 1) {
      var r = pending[i];
      r.stateEl.textContent = "Saving…";
      r.stateEl.className = "admin-add__state";
      try {
        var url = r.dataUrl;
        if (GC.configured && GC.uploadImage) {
          var up = await GC.uploadImage(r.file);
          if (up && typeof up.url === "string") url = up.url;
        }
        var product = {
          id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: (r.nameInput.value || "").trim() || nameFromFile(r.file),
          price: parseFloat(r.priceInput.value) || 0,
          category: cat,
          subcategory: sub,
          status: "in stock",
          image: url,
          keywords: [],
          colors: [],
          gallery: []
        };
        var res = await GC.saveProduct(product);
        if (res && res.ok === false) throw res.error || new Error("save failed");
        r.saved = true;
        r.stateEl.textContent = "Saved";
        r.stateEl.className = "admin-add__state is-saved";
        done += 1;
      } catch (err) {
        r.stateEl.textContent = "Failed";
        r.stateEl.className = "admin-add__state is-error";
        failed += 1;
      }
    }
    saveBtn.disabled = false;

    if (done) {
      statusEl.textContent =
        done + " saved" + (failed ? ", " + failed + " failed" : "") + " — refreshing…";
      var target = "/products?cat=" + encodeURIComponent(cat) +
        (sub ? "&sub=" + encodeURIComponent(sub) : "");
      setTimeout(function () { location.href = target; }, 700);
    } else {
      statusEl.textContent = failed + " failed.";
    }
    updateSaveBtn();
  }

  fileInput.addEventListener("change", function (e) {
    Array.prototype.slice.call(e.target.files || []).forEach(addRow);
    fileInput.value = "";
  });
  catEl.addEventListener("change", fillSubs);
  saveBtn.addEventListener("click", saveAll);

  GC.init().then(function () {
    if (!GC.isAdmin) return;
    section.hidden = false;
    if (!GC.configured) {
      noteEl.hidden = false;
      noteEl.textContent =
        "Supabase is not connected yet, so photos you add are saved in this " +
        "browser only — customers will not see them. Connect Supabase to publish.";
    }
    fillCategories();
  });
})();
