/* =========================================================
   Gulnish Crochet — Newsletter subscribe (Supabase + fallback)
   ========================================================= */
(function () {
  "use strict";

  var forms = Array.prototype.slice.call(
    document.querySelectorAll('[data-newsletter-form]')
  );

  if (!forms.length) return;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setNote(form, msg, type) {
    var note = form.querySelector('[data-newsletter-note]');
    if (!note) return;
    note.textContent = msg || "";
    note.classList.remove('is-ok', 'is-err');
    if (type === 'ok') note.classList.add('is-ok');
    if (type === 'err') note.classList.add('is-err');
  }

  function saveLocal(email, name) {
    try {
      var list = JSON.parse(localStorage.getItem('gulnish-newsletter') || '[]');
      if (!list.some(function (e) { return e.email === email; })) {
        list.push({ email: email, name: name || '', at: new Date().toISOString() });
        localStorage.setItem('gulnish-newsletter', JSON.stringify(list));
      }
    } catch (e) {}
  }

  async function subscribeToSupabase(email, name, source) {
    if (!window.GC || !GC.supabase || !GC.supabase.from) return false;
    try {
      var payload = {
        email: email,
        name: name || null,
        source: source || (location.pathname || '/'),
        consent: true,
        consent_at: new Date().toISOString()
      };
      var { error } = await GC.supabase
        .from('newsletter_subscribers')
        .upsert(payload, { onConflict: 'email' });
      if (error) {
        console.warn('Newsletter upsert error:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Newsletter subscribe failed:', err);
      return false;
    }
  }

  forms.forEach(function (form) {
    var input = form.querySelector('[data-newsletter-email]');
    var nameInput = form.querySelector('[data-newsletter-name]');
    var btn = form.querySelector('[data-newsletter-submit]');
    var source = form.getAttribute('data-newsletter-source') || location.pathname || '/';

    if (!input || !btn) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = String(input.value || '').trim().toLowerCase();
      var name = nameInput ? String(nameInput.value || '').trim() : '';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setNote(form, 'Please enter a valid email address.', 'err');
        input.focus();
        return;
      }

      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = 'Subscribing...';
      setNote(form, '');

      var ok = await subscribeToSupabase(email, name, source);
      if (!ok) {
        // Fallback: store locally so we never block the UX
        saveLocal(email, name);
      }

      btn.disabled = false;
      btn.textContent = orig;
      form.reset();
      setNote(form,
        ok ? "Thanks for subscribing! We'll keep you updated." : "Thanks for subscribing! We'll keep you updated.",
        'ok'
      );

      setTimeout(function () {
        setNote(form, '');
      }, 4500);
    });
  });
})();
