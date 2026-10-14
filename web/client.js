/* 4 Horseman Security — client portal: a security company's clients see their sites' reports, check-ins,
   guard-tour scans and invoices, and send service requests. */
(() => {
  'use strict';
  const { $, esc } = HM;
  const T = (k, v) => HM.t(k, v);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const KEY = 'hm_client_token';
  const tok = { get() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }, set(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch (e) { } } };
  async function api(method, path, body) {
    const t = tok.get();
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || T('Something went wrong. Please try again.')); e.status = r.status; throw e; }
    return j;
  }
  const money = c => HM.money(c || 0);
  const fDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const fTime = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fDT = t => t ? `${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${fTime(t)}` : '—';
  const dur = (a, b) => { const m = Math.max(0, Math.round(((b || Date.now()) - a) / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const pill = (text, kind) => `<span class="pill ${kind || ''}">${esc(text)}</span>`;
  const empty = (title, body) => `<div class="empty"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
  const opt = (v, l, s) => `<option value="${esc(v)}"${s ? ' selected' : ''}>${esc(l)}</option>`;
  const TYPES = { incident: 'Incident report', dar: 'Daily activity report', maintenance: 'Maintenance & hazard report' };
  let S = null, days = 30, site = '', tab = 'reports';
  const panel = $('#panel'), msg = $('#msg');
  const siteName = id => S.sites.find(s => s.id === id)?.name || '';

  function toast(text, kind = 'ok') { const el = $('#toast'); el.textContent = text; el.className = 'toast ' + kind; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500); }
  function modal(html, cls = '') { $('#modalBody').innerHTML = html; $('#modal').hidden = false; $('#modal').firstElementChild.className = 'modal ' + cls; document.body.classList.add('noscroll'); }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; document.body.classList.remove('noscroll'); }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---------- sign in ----------
  const lf = $('#lf');
  const q = new URLSearchParams(location.search);
  if (q.get('company')) lf.company.value = q.get('company').toUpperCase();
  lf.addEventListener('submit', async e => {
    e.preventDefault(); HM.alertBox($('#err'), '');
    const v = Object.fromEntries(new FormData(lf));
    if (!v.company.trim() || !v.email.trim() || !v.pin) return HM.alertBox($('#err'), T('Enter the company code, your email and your portal PIN.'));
    const go = $('#go'); go.disabled = true;
    try { const r = await api('POST', '/api/client/login', { company: v.company.trim(), email: v.email.trim(), pin: v.pin }); tok.set(r.token); lf.pin.value = ''; await load(); }
    catch (x) { HM.alertBox($('#err'), x.message); }
    finally { go.disabled = false; }
  });
  $('#logout').onclick = async () => { try { await api('POST', '/api/client/logout'); } catch (e) { } tok.set(null); location.reload(); };

  async function load() {
    if (!tok.get()) { $('#login').hidden = false; (lf.company.value ? lf.email : lf.company).focus(); return; }
    try { S = await api('GET', '/api/client/state?days=' + days); }
    catch (e) { if (e.status === 401) { tok.set(null); $('#app').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; return; } return HM.alertBox(msg, e.message); }
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    go(location.hash.slice(1));
  }
  function go(name) {
    tab = TABS[name] ? name : 'reports';
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    msg.hidden = true; TABS[tab]();
  }
  window.addEventListener('hashchange', () => { if (S) go(location.hash.slice(1)); });
  const head = (eyebrow, title, sub) => `<div class="portal-head"><div><span class="eyebrow" translate="no">${esc(S.company.name)}</span><h1 style="font-size:clamp(30px,4vw,42px);margin-top:10px">${esc(title)}</h1>
    <p class="muted" style="margin-top:6px">${sub}</p></div></div>`;
  const filters = () => `<div class="toolbar"><select id="fSite" class="sel"><option value="">${esc(T('All your sites'))}</option>${S.sites.map(s => opt(s.id, s.name, s.id === site)).join('')}</select>
    <select id="fDays" class="sel">${[[1, 'Last 24 hours'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, l]) => opt(v, T(l), v === days)).join('')}</select></div>`;
  function bindFilters() {
    const fs = $('#fSite'), fd = $('#fDays');
    if (fs) fs.onchange = () => { site = fs.value; go(tab); };
    if (fd) fd.onchange = async () => { days = +fd.value; S = await api('GET', '/api/client/state?days=' + days); go(tab); };
  }
  const welcome = () => esc(T('Welcome, {name}', { name: S.client.contact || S.client.name }));

  // ---------- reports ----------
  function reports() {
    const list = S.reports.filter(r => !site || r.siteId === site);
    panel.innerHTML = head('', T('Reports'), welcome() + ' · ' + esc(T('Reports filed by officers at your sites.'))) + filters() +
      (list.length ? list.map(r => {
        const sev = r.severity ? ` · ${esc(T(r.severity.charAt(0).toUpperCase() + r.severity.slice(1)))}` : '';
        return `<details class="rep"><summary><div><span class="type-badge">${esc(T(TYPES[r.type] || r.type))}</span>
          <div style="margin-top:4px"><b translate="no">${esc(r.category || siteName(r.siteId))}</b><span class="muted small">${sev}</span></div>
          <div class="dim small"><span translate="no">${esc(siteName(r.siteId))}</span> · ${fDT(r.occurredAt || r.createdAt)} · <span translate="no">${esc(r.userName)}</span></div></div>
          ${r.reviewedAt ? pill(T('Reviewed'), 'ok') : ''}</summary>
          <dl>${r.location ? `<dt>${esc(T('Location'))}</dt><dd translate="no">${esc(r.location)}</dd>` : ''}
            ${r.authorities && r.authorities !== 'no' ? `<dt>${esc(T('Authorities'))}</dt><dd translate="no">${esc(r.authorities)}${r.caseNo ? ' · ' + esc(r.caseNo) : ''}</dd>` : ''}
            ${r.weather ? `<dt>${esc(T('Weather'))}</dt><dd translate="no">${esc(r.weather)}</dd>` : ''}</dl>
          ${r.description ? `<div class="body" translate="no">${esc(r.description)}</div>` : ''}
          ${r.timeline ? `<div class="body" translate="no">${esc(r.timeline)}</div>` : ''}
          ${r.actions ? `<p class="small muted" style="margin-top:10px">${esc(T('Actions taken'))}</p><div class="body" translate="no">${esc(r.actions)}</div>` : ''}
          ${r.photos && r.photos.length ? `<div class="photos">${r.photos.map((p, i) => `<img src="${esc(p)}" alt="${esc(T('Photo {n}', { n: i + 1 }))}" data-photo>`).join('')}</div>` : ''}
        </details>`;
      }).join('') : empty(T('No reports in this period'), T('Try a longer time period.')));
    bindFilters();
    $$('[data-photo]', panel).forEach(img => img.onclick = () => modal(`<img src="${img.src}" alt="" style="width:100%;border-radius:12px">`, 'wide'));
  }

  // ---------- check-ins & guard tours ----------
  function activity() {
    const sh = S.shifts.filter(s => !site || s.siteId === site), sc = S.scans.filter(s => !site || s.siteId === site);
    const issues = sc.filter(s => s.status === 'issue').length;
    panel.innerHTML = head('', T('Check-ins & tours'), esc(T('When officers were on post and which guard-tour checkpoints they scanned.'))) + filters() +
      `<div class="tiles"><div class="tile"><span>${esc(T('On duty now'))}</span><b>${sh.filter(s => !s.outAt).length}</b></div>
        <div class="tile"><span>${esc(T('Shifts'))}</span><b>${sh.length}</b></div><div class="tile"><span>${esc(T('Checkpoint scans'))}</span><b>${sc.length}</b></div>
        <div class="tile"><span>${esc(T('Issues found on tours'))}</span><b class="${issues ? 'warn-text' : ''}">${issues}</b></div></div>
      <div class="grid2"><section><h3 style="margin-bottom:12px">${esc(T('Officer check-ins'))}</h3>
        ${sh.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${esc(T('Officer'))}</th><th>${esc(T('Check-in'))}</th><th>${esc(T('Check-out'))}</th><th class="n">${esc(T('Time on post'))}</th></tr></thead>
          <tbody>${sh.map(s => `<tr><td><b translate="no">${esc(s.officer)}</b>${S.sites.length > 1 ? `<div class="dim small" translate="no">${esc(siteName(s.siteId))}</div>` : ''}</td><td>${fDT(s.inAt)}</td>
            <td>${s.outAt ? fDT(s.outAt) : pill(T('On duty'), 'ok')}</td><td class="n">${dur(s.inAt, s.outAt)}</td></tr>`).join('')}</tbody></table></div>` : empty(T('No check-ins in this period'))}</section>
        <section><h3 style="margin-bottom:12px">${esc(T('Guard-tour scans'))}</h3>
        ${sc.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${esc(T('Checkpoint'))}</th><th>${esc(T('Officer'))}</th><th>${esc(T('Time'))}</th><th>${esc(T('Result'))}</th></tr></thead>
          <tbody>${sc.slice(0, 500).map(s => `<tr><td><b translate="no">${esc(s.checkpoint)}</b>${s.note ? `<div class="dim small" translate="no">${esc(s.note)}</div>` : ''}</td><td translate="no">${esc(s.officer)}</td><td>${fDT(s.at)}</td>
            <td>${s.status === 'issue' ? pill(T('Issue'), 'warn') : pill(T('All clear'), 'ok')}</td></tr>`).join('')}</tbody></table></div>` : empty(T('No guard-tour scans in this period'))}</section></div>`;
    bindFilters();
  }

  // ---------- invoices ----------
  function invoices() {
    const inv = [...S.invoices].sort((a, b) => (b.issued || '').localeCompare(a.issued || ''));
    const owed = inv.filter(i => i.status === 'sent').reduce((a, i) => a + i.total, 0);
    panel.innerHTML = head('', T('Invoices'), esc(T('Your invoices from {company}.', { company: S.profile.name || S.company.name }))) +
      `<div class="tiles"><div class="tile"><span>${esc(T('Balance due'))}</span><b>${money(owed)}</b></div><div class="tile"><span>${esc(T('Invoices'))}</span><b>${inv.length}</b></div></div>` +
      (inv.length ? `<div class="table-wrap"><table class="data click"><thead><tr><th>${esc(T('Invoice'))}</th><th>${esc(T('Issued'))}</th><th>${esc(T('Due'))}</th><th class="n">${esc(T('Total'))}</th><th>${esc(T('Status'))}</th></tr></thead>
        <tbody>${inv.map(i => `<tr data-open="${i.id}" tabindex="0"><td translate="no"><b>#${esc(i.number)}</b></td><td>${i.issued ? fDate(i.issued + 'T12:00') : '—'}</td><td>${i.due ? fDate(i.due + 'T12:00') : '—'}</td>
          <td class="n"><b>${money(i.total)}</b></td><td>${pill(T(INV.statusOf(i)), { Paid: 'ok', Overdue: 'bad', Unpaid: 'warn' }[INV.statusOf(i)])}</td></tr>`).join('')}</tbody></table></div>`
        : empty(T('No invoices yet')));
    $$('[data-open]', panel).forEach(r => { const f = () => view(r.dataset.open); r.onclick = f; r.onkeydown = e => { if (e.key === 'Enter') f(); }; });
  }
  function view(id) {
    const inv = S.invoices.find(i => i.id === id); if (!inv) return;
    const data = { inv, client: S.client, profile: S.profile, company: S.company };
    modal(`<div class="inv-actions"><button class="btn btn-ghost btn-sm" id="vp">${esc(T('Print / save PDF'))}</button></div><div class="paper">${INV.doc(data)}</div>`, 'wide');
    $('#vp').onclick = () => INV.print(data);
  }

  // ---------- requests ----------
  function requests() {
    const list = [...S.requests].sort((a, b) => b.updatedAt - a.updatedAt);
    panel.innerHTML = head('', T('Requests'), esc(T('Ask for extra patrols, report a concern or send a message to {company}.', { company: S.profile.name || S.company.name }))) +
      `<div class="grid2"><section class="card"><h3>${esc(T('New request'))}</h3>
        <form id="nr" class="form">${S.sites.length > 1 ? `<div class="field"><label>${esc(T('Site'))}</label><select name="siteId"><option value="">${esc(T('All your sites'))}</option>${S.sites.map(s => opt(s.id, s.name)).join('')}</select></div>` : ''}
          <div class="field"><label>${esc(T('Subject'))}</label><input name="subject" maxlength="160" required placeholder="${esc(T('For example: Extra patrol on Friday night'))}"></div>
          <div class="field"><label>${esc(T('Message'))}</label><textarea name="text" rows="5" maxlength="4000" required></textarea></div>
          <div class="alert err" hidden></div>
          <div class="btn-row"><button class="btn btn-gold btn-sm" id="nrGo">${esc(T('Send request'))}</button></div></form>
        <p class="dim small" style="margin-top:14px">${esc(S.company.phone ? T('For emergencies call 911. For anything urgent, call us at {phone}.', { phone: S.company.phone }) : T('For emergencies call 911.'))}</p></section>
      <section><h3 style="margin-bottom:12px">${esc(T('Your requests'))}</h3>
        ${list.length ? `<ul class="list req-list">${list.map(r => `<li data-req="${r.id}" tabindex="0"><div><b translate="no">${esc(r.subject)}</b><div class="dim small">${fDT(r.updatedAt || r.at)} · ${esc(T(r.thread.length === 1 ? '1 message' : '{n} messages', { n: r.thread.length }))}</div></div>
          ${pill(T(r.status === 'open' ? 'Open' : 'Closed'), r.status === 'open' ? 'warn' : '')}</li>`).join('')}</ul>` : empty(T('No requests yet'))}</section></div>`;
    const f = $('#nr');
    f.onsubmit = async e => {
      e.preventDefault(); const b = $('#nrGo'); b.disabled = true;
      try { await api('POST', '/api/client/request', { subject: f.subject.value, text: f.text.value, siteId: f.siteId ? f.siteId.value : '' }); S = await api('GET', '/api/client/state?days=' + days); toast(T('Request sent')); requests(); }
      catch (x) { HM.alertBox($('.alert', f), x.message); b.disabled = false; }
    };
    $$('[data-req]', panel).forEach(li => { const fn = () => thread(li.dataset.req); li.onclick = fn; li.onkeydown = e => { if (e.key === 'Enter') fn(); }; });
  }
  function thread(id) {
    const r = S.requests.find(x => x.id === id); if (!r) return;
    modal(`<h2 translate="no">${esc(r.subject)}</h2><p class="muted small">${fDT(r.at)} · ${esc(T(r.status === 'open' ? 'Open' : 'Closed'))}</p>
      <div class="thread">${r.thread.map(m => `<div class="bubble ${m.from === 'client' ? 'me' : ''}"><div class="who"><span translate="no">${esc(m.name)}</span> · ${fDT(m.at)}</div><p translate="no">${esc(m.text).replace(/\n/g, '<br>')}</p></div>`).join('')}</div>
      <form id="rp" class="form"><div class="field"><label>${esc(T('Reply'))}</label><textarea name="text" rows="3" maxlength="4000"></textarea></div><div class="alert err" hidden></div>
        <div class="btn-row"><div class="grow"></div><button class="btn btn-gold btn-sm" id="rpGo">${esc(T('Send reply'))}</button></div></form>`, 'wide');
    const f = $('#rp');
    f.onsubmit = async e => {
      e.preventDefault(); if (!f.text.value.trim()) return;
      try { await api('POST', '/api/client/reply', { id, text: f.text.value }); S = await api('GET', '/api/client/state?days=' + days); requests(); thread(id); toast(T('Reply sent')); }
      catch (x) { HM.alertBox($('.alert', f), x.message); }
    };
  }

  const TABS = { reports, activity, invoices, requests };
  load();
})();
