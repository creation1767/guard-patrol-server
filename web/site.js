/* 4 Horseman Security — website helpers (no libraries). */
(function () {
  const TOKEN = 'hm_web_token';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get() { try { return sessionStorage.getItem(TOKEN); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem(TOKEN, v) : sessionStorage.removeItem(TOKEN); } catch (e) { } }
  };
  async function api(method, path, body) {
    const tok = store.get();
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) { const e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
    j.__status = r.status; return j;
  }
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tr = (k, v) => (window.t ? window.t(k, v) : k.replace(/\{(\w+)\}/g, (m, x) => v && v[x] != null ? v[x] : m));
  const date = ms => ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  function alertBox(el, msg, kind = 'err') { el.className = 'alert ' + kind; el.textContent = msg; el.hidden = !msg; }
  // Header: show "Account" instead of "Log in" when signed in on this tab.
  document.addEventListener('DOMContentLoaded', () => {
    const l = $('[data-login-link]'); if (l && store.get()) { l.textContent = tr('Dashboard'); l.href = '/account'; }
    // Language menu in the header of every page.
    if (window.I18N) {
      const slot = $('[data-lang-slot]') || $('.top nav'); if (slot) slot.insertBefore(I18N.picker('lang-select'), slot.firstChild);
      const foot = $('footer nav'); if (foot) foot.appendChild(I18N.picker('lang-select foot-lang'));
    }
    const y = $('[data-year]'); if (y) y.textContent = new Date().getFullYear();
  });
  window.HM = { $, esc, api, store, money, date, alertBox, t: tr };
})();
