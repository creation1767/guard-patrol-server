/* 4 Horseman Security — administrator dashboard (website only).
   Tabs: Overview (account & subscription), Schedule, Payroll, Billing (client invoices), Clients & portal, Settings.
   Data comes from /api/dash (schedule, pay rates, clients, invoices, requests) and /api/account (subscription). */
(() => {
  'use strict';
  const { $, esc, api, store } = HM;
  const T = (k, v) => HM.t(k, v);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const DAY = 86400000;
  let D = null, A = null, tab = 'overview';
  const shiftCache = new Map(); // "from|to" -> shifts

  // ---------- formatting ----------
  const money = c => HM.money(c || 0);
  const pad = n => String(n).padStart(2, '0');
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const atLocal = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr || '00:00'}`).getTime();
  const fDate = (t, o) => new Date(t).toLocaleDateString(undefined, o || { month: 'short', day: 'numeric', year: 'numeric' });
  const fDay = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fTime = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fDT = t => t ? `${fDate(t, { month: 'short', day: 'numeric' })} ${fTime(t)}` : '—';
  const hrs = h => (Math.round(h * 100) / 100).toFixed(2);
  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const weekStart = t => addDays(dayStart(t), -new Date(t).getDay()); // Sunday
  const userName = id => D.users.find(u => u.id === id)?.name || T('Former officer');
  const siteName = id => D.sites.find(s => s.id === id)?.name || T('Removed site');
  const clientById = id => D.clients.find(c => c.id === id);
  const staff = () => D.users.filter(u => u.role !== 'admin').sort((a, b) => a.name.localeCompare(b.name));
  const ROLE = { guard: 'Officer', supervisor: 'Supervisor', admin: 'Administrator' };

  // ---------- page plumbing ----------
  const msg = $('#msg'), panel = $('#panel');
  function toast(text, kind = 'ok') {
    const el = $('#toast'); el.textContent = text; el.className = 'toast ' + kind; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3600);
  }
  function modal(html, cls = '') {
    $('#modalBody').innerHTML = html; const m = $('#modal'); m.hidden = false; m.firstElementChild.className = 'modal ' + cls;
    document.body.classList.add('noscroll');
    const f = $('#modalBody input:not([type=hidden]), #modalBody select, #modalBody textarea'); if (f && !cls.includes('nofocus')) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; document.body.classList.remove('noscroll'); }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  async function act(action, body, ok) {
    const r = await api('POST', '/api/dash/' + action, body);
    D = r.state; if (ok) toast(ok); return r;
  }
  // Runs an async button action, showing errors in the modal (or page) instead of losing them.
  function guard(btn, fn) {
    return async e => {
      e && e.preventDefault();
      if (btn) btn.disabled = true;
      try { await fn(); } catch (x) { const box = $('#modalBody .alert') || msg; if (x.message) HM.alertBox(box, x.message); }
      finally { if (btn) btn.disabled = false; }
    };
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const pill = (text, kind) => `<span class="pill ${kind || ''}">${esc(text)}</span>`;
  const empty = (title, body) => `<div class="empty"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
  async function shiftsBetween(from, to) {
    const k = from + '|' + to;
    if (!shiftCache.has(k)) shiftCache.set(k, (await api('GET', `/api/dash/shifts?from=${from}&to=${to}`)).shifts);
    return shiftCache.get(k);
  }

  // ---------- load ----------
  if (!store.get()) return location.replace('/login');
  $('#logout').onclick = async () => { try { await api('POST', '/api/logout'); } catch (e) { } store.set(null); location.href = '/'; };
  async function load() {
    try { [A, D] = await Promise.all([api('GET', '/api/account'), api('GET', '/api/dash')]); }
    catch (e) {
      if ([401, 403, 410].includes(e.status)) { store.set(null); return location.replace('/login'); }
      $('#loading').hidden = true; return HM.alertBox(msg, e.message);
    }
    $('#loading').hidden = true; panel.hidden = false;
    $('#openApp').href = '/app/?company=' + encodeURIComponent(A.company.code);
    dueBanner();
    go(location.hash.slice(1));
  }
  function go(name) {
    tab = TABS[name] ? name : 'overview';
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    const cur = $(`#tabs a[data-tab="${tab}"]`); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    msg.hidden = true;
    TABS[tab]();
  }
  window.addEventListener('hashchange', () => { closeModal(); go(location.hash.slice(1)); });

  // Overdue subscription: shown above every tab.
  function dueBanner() {
    const b = A.billing, el = $('#due');
    if (!b || !b.overdue) { el.hidden = true; return; }
    const days = Math.max(0, Math.ceil((b.deleteAt - Date.now()) / DAY));
    el.hidden = false;
    el.innerHTML = `<div class="due-banner"><div><b>${esc(T('Your monthly payment is overdue'))}</b>
      <p>${esc(T('Pay by {date} or your company account and all of its data will be permanently deleted ({n} days left).', { date: fDate(b.deleteAt), n: days }))}</p></div>
      <button class="btn btn-gold btn-sm" id="payNow">${esc(T('Pay now'))}</button></div>`;
    $('#payNow').onclick = guard($('#payNow'), async () => {
      if (b.payUrl) { location.href = b.payUrl; return; }
      const r = await api('POST', '/api/account/portal'); location.href = r.url;
    });
  }

  // =====================================================================
  // OVERVIEW
  // =====================================================================
  function overview() {
    const today0 = dayStart(Date.now()), today1 = addDays(today0, 1);
    const todays = D.sched.filter(x => x.start < today1 && x.end > today0).sort((a, b) => a.start - b.start);
    const openReq = D.requests.filter(r => r.status === 'open');
    const unpaid = D.invoices.filter(i => i.status === 'sent');
    const owed = unpaid.reduce((a, i) => a + i.total, 0);
    const b = A.billing;
    const statusRow = () => {
      if (b.status === 'owner') return `<dl class="kv"><dt>${esc(T('Billing'))}</dt><dd>${esc(T('Not billed (owner company)'))}</dd></dl>`;
      const labels = { active: ['Active', 'ok'], trialing: ['Free trial', 'ok'], past_due: ['Payment overdue', 'bad'], unpaid: ['Payment overdue', 'bad'], canceled: ['Ended', 'bad'], incomplete: ['Incomplete', 'warn'] };
      const [lt, lc] = b.cancelAtPeriodEnd ? ['Cancelling', 'warn'] : labels[b.status] || [b.status, ''];
      return `<div class="row-between"><div><div class="plan-name">${esc(T('{name} plan', { name: T(A.plan?.name || 'Company plan') }))}</div><div class="price small-price">${money(A.price)} <small>${esc(T('/ month'))}</small></div></div>${pill(T(lt), lc)}</div>
        ${b.trialEnd && !b.cancelAtPeriodEnd ? `<div class="alert info" style="margin:12px 0 0">${esc(T('Free trial until {date}. Your first payment of {price} is taken then. Cancel before then and you pay nothing.', { date: fDate(b.trialEnd), price: money(A.price) }))}</div>` : ''}
        <dl class="kv">${b.cancelAtPeriodEnd ? `<dt>${esc(T('Access ends'))}</dt><dd>${fDate(b.periodEnd)}</dd>` : `<dt>${esc(T('Next payment'))}</dt><dd>${fDate(b.periodEnd)}</dd>`}
        ${b.overdue ? `<dt>${esc(T('Deleted if unpaid on'))}</dt><dd class="bad-text">${fDate(b.deleteAt)}</dd>` : ''}</dl>
        <p class="dim small" style="margin-top:12px">${esc(T('Charged automatically every month. If a payment fails you have {n} days to pay before the account and its data are deleted.', { n: A.graceDays || 15 }))}</p>
        <div class="btn-row" id="billbtns"></div>`;
    };
    panel.innerHTML = `
      <div class="dash-head"><div><span class="eyebrow" translate="no">4 HORSEMAN Security Server</span><h1 translate="no">${esc(A.company.name)}</h1>
        <p class="muted">${esc(T('Signed in as {name} · administrator', { name: A.me.name }))}</p></div></div>
      <div class="tiles">
        <a class="tile" href="#schedule"><span>${esc(T('On duty now'))}</span><b>${D.onDuty.length}</b></a>
        <a class="tile" href="#schedule"><span>${esc(T('Shifts scheduled today'))}</span><b>${todays.length}</b></a>
        <a class="tile" href="#clients"><span>${esc(T('Open client requests'))}</span><b>${openReq.length}</b></a>
        <a class="tile" href="#billing"><span>${esc(T('Unpaid invoices'))}</span><b>${money(owed)}</b></a>
      </div>
      <div class="grid2">
        <section class="card"><div class="row-between"><h3>${esc(T("Today's schedule"))}</h3><a class="small" href="#schedule">${esc(T('Open schedule'))}</a></div>
          ${todays.length ? `<ul class="list">${todays.map(x => {
            const on = D.onDuty.find(s => s.userId === x.userId && s.siteId === x.siteId);
            const st = on ? ['On duty', 'ok'] : !x.userId ? ['Open shift', 'warn'] : Date.now() > x.end ? ['Ended', ''] : Date.now() > x.start + 10 * 60000 ? ['Not checked in', 'bad'] : ['Upcoming', ''];
            return `<li><div><b translate="no">${esc(x.userId ? userName(x.userId) : T('Open shift'))}</b><span class="muted small"> · <span translate="no">${esc(siteName(x.siteId))}</span></span>
              <div class="dim small">${fTime(x.start)} – ${fTime(x.end)}</div></div>${pill(T(st[0]), st[1])}</li>`;
          }).join('')}</ul>` : empty(T('Nothing scheduled today'), T('Add shifts on the Schedule tab.'))}</section>
        <section class="card"><span class="eyebrow">${esc(T('Company code'))}</span>
          <div class="bigcode gold-text" translate="no">${esc(A.company.code)}</div>
          <p class="muted small">${esc(T('Officers sign in with this code plus their badge number and PIN, in the Android or iPhone app, or the web app.'))}</p></section>
        <section class="card" id="subCard"><div class="row-between" style="margin-bottom:6px"><span class="eyebrow">${esc(T('Subscription'))}</span></div>${statusRow()}</section>
        <section class="card"><span class="eyebrow">${esc(T('Usage'))}</span>
          <dl class="kv"><dt>${esc(T('Sites'))}</dt><dd>${esc(T('{a} of {b}', { a: A.usage.sites, b: A.usage.maxSites }))}</dd></dl><div class="meter"><i style="width:${A.usage.sites / A.usage.maxSites * 100}%"></i></div>
          <dl class="kv"><dt>${esc(T('Officer accounts'))}</dt><dd>${esc(T('{a} of {b}', { a: A.usage.officers, b: A.usage.maxOfficers }))}</dd></dl><div class="meter"><i style="width:${A.usage.officers / A.usage.maxOfficers * 100}%"></i></div>
          <dl class="kv"><dt>${esc(T('Clients'))}</dt><dd>${D.clients.length}</dd></dl>
          <p class="dim small" style="margin-top:14px">${esc(T('Add officers here under Payroll. Add sites and tour locations in the app under More → Administration.'))}</p>
          <div class="btn-row"><a class="btn btn-ghost btn-sm" href="/app/?company=${encodeURIComponent(A.company.code)}">${esc(T('Open web app'))}</a></div></section>
      </div>`;
    if (b.status !== 'owner') billingButtons();
  }
  function billingButtons() {
    const b = A.billing, box = $('#billbtns');
    const btn = (label, cls, fn) => { const x = document.createElement('button'); x.className = 'btn btn-sm ' + cls; x.textContent = T(label); x.onclick = guard(x, fn); box.appendChild(x); };
    if (b.overdue && b.payUrl) btn('Pay now', 'btn-gold', async () => { location.href = b.payUrl; });
    if (!b.overdue && !b.cancelAtPeriodEnd && A.plan?.plan !== 'enterprise') btn('Change plan', 'btn-gold', async () => planForm());
    btn('Update payment method', 'btn-ghost', async () => { const r = await api('POST', '/api/account/portal'); location.href = r.url; });
    if (b.cancelAtPeriodEnd) btn('Keep my subscription', 'btn-gold', async () => { await api('POST', '/api/account/resume'); A = await api('GET', '/api/account'); overview(); toast(T('Your subscription will continue.')); });
    else btn('Cancel subscription', 'btn-danger', async () => {
      if (!confirm(T('Cancel your subscription?') + '\n\n' + T('You keep access until {date}. After that, your company account and ALL of its data (officers, sites, reports, messages) are permanently deleted.', { date: fDate(b.periodEnd) }))) return;
      await api('POST', '/api/account/cancel'); A = await api('GET', '/api/account'); overview();
    });
  }

  // Change between Starter, Pro and Business. Plans the company has outgrown are shown but can't be picked.
  function planForm() {
    const cur = A.plan?.plan, u = A.usage;
    const fits = x => u.sites <= x.sites && u.officers <= x.officers;
    modal(`<h2>${esc(T('Change plan'))}</h2>
      <p class="muted small">${esc(T('You use {s} site(s) and {o} officer account(s). The price difference is prorated on your next invoice.', { s: u.sites, o: u.officers }))}</p>
      <form id="pf" class="form"><div class="plan-pick">${A.plans.map(x => `<label class="plan-opt${fits(x) ? '' : ' off'}"><input type="radio" name="plan" value="${esc(x.id)}"${x.id === cur ? ' checked' : ''}${fits(x) ? '' : ' disabled'}>
        <span class="grow"><b>${esc(T(x.name))}${x.id === cur ? ` · <span class="gold-text">${esc(T('Current plan'))}</span>` : ''}</b><span class="muted small">${esc(T(x.sites === 1 ? '1 site' : 'Up to {n} sites', { n: x.sites }))} · ${esc(T('up to {n} officers', { n: x.officers }))}</span>
        ${fits(x) ? '' : `<span class="warn-text small" style="display:block">${esc(T('Too small for your current sites or officers'))}</span>`}</span>
        <span class="pp">${money(x.price)} ${esc(T('/ month'))}</span></label>`).join('')}</div>
        <p class="hint">${esc(T('Need more than 5 sites or 50 officers?'))} <a href="/enterprise" target="_blank">${esc(T('Ask about Enterprise'))}</a></p>
        <div class="alert err" hidden></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="pSave">${esc(T('Change plan'))}</button></div></form>`);
    if (cur === 'enterprise') { $('#pSave').disabled = true; HM.alertBox($('#modalBody .alert'), T('Your Enterprise plan is managed by 4 Horseman Security. Contact us to change it.')); }
    const f = $('#pf');
    f.onsubmit = guard($('#pSave'), async () => {
      const v = f.plan.value; if (!v || v === cur) return closeModal();
      const x = A.plans.find(p => p.id === v);
      if (!confirm(T('Switch to the {name} plan at {price} a month?', { name: T(x.name), price: money(x.price) }))) return;
      await api('POST', '/api/account/plan', { plan: v });
      A = await api('GET', '/api/account'); closeModal(); overview(); toast(T('Your plan was changed to {name}.', { name: T(x.name) }));
    });
  }

  // =====================================================================
  // SCHEDULE
  // =====================================================================
  const SC = { week: weekStart(Date.now()), site: '' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function weekShifts() {
    const end = addDays(SC.week, 7);
    return D.sched.filter(x => x.start < end && x.start >= SC.week && (!SC.site || x.siteId === SC.site));
  }
  function conflicts(list) {
    const bad = new Set(), by = {};
    for (const x of list) if (x.userId) (by[x.userId] = by[x.userId] || []).push(x);
    for (const arr of Object.values(by)) { arr.sort((a, b) => a.start - b.start); for (let i = 1; i < arr.length; i++) if (arr[i].start < arr[i - 1].end) { bad.add(arr[i].id); bad.add(arr[i - 1].id); } }
    return bad;
  }
  function schedule() {
    const days = [...Array(7)].map((_, i) => addDays(SC.week, i));
    const list = weekShifts(), bad = conflicts(D.sched.filter(x => x.start < addDays(SC.week, 8) && x.end > addDays(SC.week, -1)));
    const people = staff().filter(u => !SC.site || u.siteId === SC.site || list.some(x => x.userId === u.id));
    const siteIdx = id => Math.max(0, D.sites.findIndex(s => s.id === id));
    const today = dayStart(Date.now());
    const chip = x => `<button class="chip s${siteIdx(x.siteId) % 4}${bad.has(x.id) ? ' clash' : ''}" data-edit="${x.id}" title="${esc(siteName(x.siteId))}${x.note ? ' — ' + esc(x.note) : ''}">
      <b>${hm(x.start)}–${hm(x.end)}</b>${SC.site ? '' : `<span translate="no">${esc(siteName(x.siteId))}</span>`}${x.note ? '<i>•</i>' : ''}</button>`;
    const row = (uid, label, sub) => {
      const mine = list.filter(x => (x.userId || '') === uid);
      const total = mine.reduce((a, x) => a + (x.end - x.start) / 3600000, 0);
      const ot = uid && D.pay.otWeekly && total > D.pay.otWeekly;
      return `<tr><th scope="row"><div translate="no">${label}</div><small>${sub}</small></th>
        ${days.map(d => `<td class="${d === today ? 'today' : ''}">${mine.filter(x => dayStart(x.start) === d).sort((a, b) => a.start - b.start).map(chip).join('')}
          <button class="add" data-add="${ymd(d)}" data-user="${uid}" aria-label="${esc(T('Add shift'))}">+</button></td>`).join('')}
        <td class="tot${ot ? ' warn-text' : ''}">${hrs(total)}${ot ? `<small>${esc(T('Overtime'))}</small>` : ''}</td></tr>`;
    };
    const totalHrs = list.reduce((a, x) => a + (x.end - x.start) / 3600000, 0);
    panel.innerHTML = `
      <div class="dash-head"><div><span class="eyebrow">${esc(T('Scheduling'))}</span><h1>${esc(T('Schedule'))}</h1>
        <p class="muted">${esc(T('Plan shifts for each officer and site. Officers still check in and out with the app; the Payroll tab uses those real hours.'))}</p></div></div>
      <div class="toolbar">
        <div class="seg-nav"><button class="btn btn-ghost btn-sm" id="wPrev" aria-label="${esc(T('Previous week'))}">‹</button>
          <button class="btn btn-ghost btn-sm" id="wToday">${esc(T('This week'))}</button>
          <button class="btn btn-ghost btn-sm" id="wNext" aria-label="${esc(T('Next week'))}">›</button>
          <b class="range">${fDate(SC.week, { month: 'short', day: 'numeric' })} – ${fDate(addDays(SC.week, 6))}</b></div>
        <select id="wSite" class="sel"><option value="">${esc(T('All sites'))}</option>${D.sites.map(s => opt(s.id, s.name, s.id === SC.site)).join('')}</select>
        <div class="grow"></div>
        <button class="btn btn-ghost btn-sm" id="wCopy">${esc(T('Copy last week'))}</button>
        <button class="btn btn-ghost btn-sm" id="wXlsx">${esc(T('Export to Excel'))}</button>
        <button class="btn btn-gold btn-sm" id="wAdd">${esc(T('Add shift'))}</button>
      </div>
      ${D.sites.length ? '' : `<div class="alert info">${esc(T('Add a site in the app (More → Administration) before scheduling shifts.'))}</div>`}
      <div class="sched-wrap"><table class="sched">
        <thead><tr><th>${esc(T('Officer'))}</th>${days.map(d => `<th class="${d === today ? 'today' : ''}"><span>${esc(T(DOW[new Date(d).getDay()]))}</span><b>${new Date(d).getDate()}</b></th>`).join('')}<th>${esc(T('Hours'))}</th></tr></thead>
        <tbody>${people.map(u => row(u.id, esc(u.name), `${esc(T(ROLE[u.role] || 'Officer'))} · <span translate="no">${esc(u.siteId ? siteName(u.siteId) : '')}</span>`)).join('')}
          ${row('', esc(T('Open shifts')), esc(T('Not assigned yet')))}</tbody>
      </table></div>
      <p class="dim small sched-foot">${esc(T('{n} shifts · {h} hours this week', { n: list.length, h: hrs(totalHrs) }))}${bad.size ? ` · <span class="bad-text">${esc(T('Red shifts overlap another shift for the same officer.'))}</span>` : ''}</p>`;
    $('#wPrev').onclick = () => { SC.week = addDays(SC.week, -7); schedule(); };
    $('#wNext').onclick = () => { SC.week = addDays(SC.week, 7); schedule(); };
    $('#wToday').onclick = () => { SC.week = weekStart(Date.now()); schedule(); };
    $('#wSite').onchange = e => { SC.site = e.target.value; schedule(); };
    $('#wAdd').onclick = () => shiftForm({ date: ymd(Math.max(SC.week, today)) });
    $('#wCopy').onclick = guard($('#wCopy'), copyWeek);
    $('#wXlsx').onclick = () => exportSchedule(days, list);
    $$('[data-add]', panel).forEach(b => b.onclick = () => shiftForm({ date: b.dataset.add, userId: b.dataset.user }));
    $$('[data-edit]', panel).forEach(b => b.onclick = () => shiftForm({ item: D.sched.find(x => x.id === b.dataset.edit) }));
  }
  function shiftForm({ item, date, userId }) {
    const x = item || {};
    const u = D.users.find(v => v.id === (x.userId ?? userId));
    const siteId = x.siteId || SC.site || u?.siteId || D.sites[0]?.id || '';
    const d0 = x.start ? ymd(x.start) : date;
    const dow = new Date(d0 + 'T12:00').getDay();
    modal(`<h2>${esc(T(item ? 'Edit shift' : 'Add shift'))}</h2>
      <form id="sf" class="form">
        <div class="row2"><div class="field"><label>${esc(T('Officer'))}</label><select name="userId"><option value="">${esc(T('Open shift (not assigned)'))}</option>
          ${staff().map(v => opt(v.id, v.name, v.id === (x.userId ?? userId))).join('')}</select></div>
        <div class="field"><label>${esc(T('Site'))}</label><select name="siteId">${D.sites.map(s => opt(s.id, s.name, s.id === siteId)).join('')}</select></div></div>
        <div class="row3"><div class="field"><label>${esc(T('Date'))}</label><input type="date" name="date" value="${d0}" required></div>
          <div class="field"><label>${esc(T('Starts'))}</label><input type="time" name="start" value="${x.start ? hm(x.start) : '07:00'}" required></div>
          <div class="field"><label>${esc(T('Ends'))}</label><input type="time" name="end" value="${x.end ? hm(x.end) : '15:00'}" required></div></div>
        <p class="hint" id="sfLen"></p>
        ${item ? '' : `<div class="field"><label>${esc(T('Also on'))}</label><div class="days">${DOW.map((n, i) => `<label class="day"><input type="checkbox" name="d${i}"${i === dow ? ' checked disabled' : ''}><span>${esc(T(n))}</span></label>`).join('')}</div></div>
          <div class="field"><label>${esc(T('Repeat for'))}</label><select name="weeks">${[1, 2, 3, 4, 6, 8, 12].map(n => opt(n, n === 1 ? T('This week only') : T('{n} weeks', { n }), n === 1)).join('')}</select></div>`}
        <div class="field"><label>${esc(T('Note for this shift'))}</label><input name="note" maxlength="300" value="${esc(x.note || '')}" placeholder="${esc(T('Optional'))}"></div>
        <div class="alert err" hidden></div>
        <div class="btn-row">${item ? `<button type="button" class="btn btn-danger btn-sm" id="sfDel">${esc(T('Delete shift'))}</button><div class="grow"></div>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="sfSave">${esc(T('Save shift'))}</button></div>
      </form>`);
    const f = $('#sf');
    const times = () => {
      const s = atLocal(f.date.value, f.start.value); let e = atLocal(f.date.value, f.end.value);
      if (e <= s) e = addDays(e, 1); // ends after midnight
      return [s, e];
    };
    const len = () => { const [s, e] = times(); $('#sfLen').textContent = isFinite(s) ? T('{h} hours', { h: hrs((e - s) / 3600000) }) + (ymd(e - 1) !== f.date.value ? ' · ' + T('ends the next day') : '') : ''; };
    f.addEventListener('input', len); len();
    f.onsubmit = guard($('#sfSave'), async () => {
      if (!f.siteId.value) throw new Error(T('Choose a site'));
      const [s, e] = times(), dur = e - s;
      const base = { userId: f.userId.value, siteId: f.siteId.value, note: f.note.value.trim() };
      let items;
      if (item) items = [{ ...base, id: item.id, start: s, end: e }];
      else {
        const weeks = +f.weeks.value, dows = DOW.map((_, i) => i === dow || f['d' + i].checked);
        items = [];
        const wk0 = weekStart(s);
        for (let w = 0; w < weeks; w++) for (let i = 0; i < 7; i++) {
          if (!dows[i]) continue;
          const day = addDays(wk0, w * 7 + i); if (day < dayStart(s)) continue;
          const st = atLocal(ymd(day), f.start.value);
          items.push({ ...base, start: st, end: st + dur });
        }
      }
      await act('schedSave', { items }, T(items.length > 1 ? '{n} shifts saved' : 'Shift saved', { n: items.length }));
      closeModal(); schedule();
    });
    if (item) $('#sfDel').onclick = guard($('#sfDel'), async () => { await act('schedDelete', { id: item.id }, T('Shift deleted')); closeModal(); schedule(); });
  }
  async function copyWeek() {
    const prev = D.sched.filter(x => x.start >= addDays(SC.week, -7) && x.start < SC.week && (!SC.site || x.siteId === SC.site));
    if (!prev.length) return toast(T('Last week has no shifts to copy'), 'err');
    if (!confirm(T('Copy {n} shifts from last week into this week?', { n: prev.length }))) return;
    const items = prev.map(x => ({ userId: x.userId, siteId: x.siteId, note: x.note, start: addDays(x.start, 7), end: addDays(x.end, 7) }));
    await act('schedSave', { items }, T('{n} shifts saved', { n: items.length })); schedule();
  }
  function exportSchedule(days, list) {
    const S = XL.S;
    const rows = [[{ v: `${A.company.name} — ${T('Schedule')} ${ymd(days[0])} – ${ymd(days[6])}`, s: S.title }], [],
      [T('Date'), T('Day'), T('Starts'), T('Ends'), T('Hours'), T('Officer'), T('Badge'), T('Site'), T('Note')].map(v => ({ v, s: S.head }))];
    for (const x of [...list].sort((a, b) => a.start - b.start)) {
      const u = D.users.find(v => v.id === x.userId);
      rows.push([{ v: XL.serial(dayStart(x.start)), s: S.date }, T(DOW[new Date(x.start).getDay()]), hm(x.start), hm(x.end), { v: (x.end - x.start) / 3600000, s: S.hours },
        u ? u.name : T('Open shift'), u ? u.badge : '', siteName(x.siteId), x.note || '']);
    }
    XL.download(`schedule_${ymd(days[0])}.xlsx`, XL.workbook([{ name: T('Schedule').slice(0, 31), widths: [12, 8, 9, 9, 8, 24, 9, 26, 40], rows, headRow: 3 }], T('Schedule')));
  }

  // =====================================================================
  // PAYROLL
  // =====================================================================
  const PR = { offset: 0, custom: null };
  function periodLen(p) { return p.period === 'weekly' ? 7 : 14; }
  function anchorOf(p) { return p.anchor ? new Date(p.anchor + 'T00:00').getTime() : weekStart(Date.now()); }
  function period() {
    const p = D.pay;
    if (PR.custom) return PR.custom;
    const now = Date.now();
    if (p.period === 'monthly') { const d = new Date(now); const a = new Date(d.getFullYear(), d.getMonth() + PR.offset, 1); return [a.getTime(), new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime()]; }
    if (p.period === 'semimonthly') {
      const d = new Date(now); let half = (d.getDate() > 15 ? 1 : 0) + PR.offset, m = d.getMonth() + Math.floor(half / 2);
      half = ((half % 2) + 2) % 2; const y = d.getFullYear();
      return half ? [new Date(y, m, 16).getTime(), new Date(y, m + 1, 1).getTime()] : [new Date(y, m, 1).getTime(), new Date(y, m, 16).getTime()];
    }
    const len = periodLen(p), a = anchorOf(p);
    const k = Math.floor((dayStart(now) - a) / (len * DAY)) + PR.offset;
    const from = addDays(a, k * len); return [from, addDays(from, len)];
  }
  // Hours and overtime per officer. Overtime: hours over the daily limit (if set), then regular hours over the weekly limit.
  function computePayroll(shifts, from, to) {
    const p = D.pay, mult = p.otMult || 1.5, wkAnchor = p.period === 'weekly' || p.period === 'biweekly' ? anchorOf(p) : weekStart(0);
    const weekKey = t => Math.floor((dayStart(t) - dayStart(wkAnchor)) / (7 * DAY));
    const by = new Map();
    const rec = id => { if (!by.has(id)) { const u = D.users.find(x => x.id === id); by.set(id, { id, name: u ? u.name : T('Former officer'), badge: u ? u.badge : '', rate: u ? u.rate : 0, reg: 0, ot: 0, shifts: [], open: 0, sched: 0 }); } return by.get(id); };
    for (const u of staff()) rec(u.id);
    const done = shifts.filter(s => s.inAt >= from && s.inAt < to).sort((a, b) => a.inAt - b.inAt);
    const dayH = {}, weekReg = {};
    for (const s of done) {
      const r = rec(s.userId);
      if (!s.outAt) { r.open++; r.shifts.push({ ...s, h: 0, ot: 0 }); continue; }
      const h = Math.max(0, (s.outAt - s.inAt) / 3600000);
      const dk = s.userId + '|' + dayStart(s.inAt), wk = s.userId + '|' + weekKey(s.inAt);
      let ot = 0;
      if (p.otDaily) { const before = dayH[dk] || 0; ot += Math.max(0, before + h - p.otDaily) - Math.max(0, before - p.otDaily); dayH[dk] = before + h; }
      let reg = h - ot;
      if (p.otWeekly) { const before = weekReg[wk] || 0, over = Math.max(0, before + reg - p.otWeekly) - Math.max(0, before - p.otWeekly); ot += over; reg -= over; weekReg[wk] = before + reg; }
      r.reg += reg; r.ot += ot; r.shifts.push({ ...s, h, ot });
    }
    for (const x of D.sched) if (x.userId && x.start >= from && x.start < to) rec(x.userId).sched += (x.end - x.start) / 3600000;
    const rows = [...by.values()].filter(r => r.shifts.length || r.sched || D.users.some(u => u.id === r.id && u.role !== 'admin'))
      .map(r => ({ ...r, total: r.reg + r.ot, regPay: Math.round(r.reg * r.rate), otPay: Math.round(r.ot * r.rate * mult) }))
      .map(r => ({ ...r, gross: r.regPay + r.otPay })).sort((a, b) => a.name.localeCompare(b.name));
    return { rows, mult };
  }
  async function payroll() {
    const [from, to] = period();
    panel.innerHTML = `<div class="dash-head"><div><span class="eyebrow">${esc(T('Payroll'))}</span><h1>${esc(T('Payroll'))}</h1>
      <p class="muted">${esc(T('Hours come from officer check-ins and check-outs in the app. Gross pay = regular hours × pay rate + overtime hours × pay rate × overtime multiplier. Export the totals to your payroll provider; no money is sent from here.'))}</p></div></div>
      <div class="toolbar">
        <div class="seg-nav"><button class="btn btn-ghost btn-sm" id="pPrev" aria-label="${esc(T('Previous pay period'))}">‹</button>
          <button class="btn btn-ghost btn-sm" id="pCur">${esc(T('Current period'))}</button>
          <button class="btn btn-ghost btn-sm" id="pNext" aria-label="${esc(T('Next pay period'))}">›</button>
          <b class="range">${fDate(from)} – ${fDate(to - 1)}</b></div>
        <button class="btn btn-ghost btn-sm" id="pCustom">${esc(T('Custom dates'))}</button>
        <div class="grow"></div>
        <button class="btn btn-ghost btn-sm" id="pCsv">${esc(T('Export CSV'))}</button>
        <button class="btn btn-gold btn-sm" id="pXlsx">${esc(T('Export to Excel'))}</button>
      </div>
      <div id="payBody"><div class="spinner"></div></div>
      <section class="card" style="margin-top:22px"><h3>${esc(T('Payroll settings'))}</h3>
        <form id="psf" class="form"><div class="row4">
          <div class="field"><label>${esc(T('Pay period'))}</label><select name="period">${[['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['semimonthly', 'Twice a month (1st & 16th)'], ['monthly', 'Monthly']].map(([v, l]) => opt(v, T(l), v === D.pay.period)).join('')}</select></div>
          <div class="field"><label>${esc(T('A period starts on'))}</label><input type="date" name="anchor" value="${esc(D.pay.anchor || ymd(anchorOf(D.pay)))}"></div>
          <div class="field"><label>${esc(T('Weekly overtime after (hours)'))}</label><input type="number" name="otWeekly" min="0" max="168" step="0.5" value="${D.pay.otWeekly}"></div>
          <div class="field"><label>${esc(T('Daily overtime after (hours, 0 = off)'))}</label><input type="number" name="otDaily" min="0" max="24" step="0.5" value="${D.pay.otDaily}"></div>
          <div class="field"><label>${esc(T('Overtime multiplier'))}</label><input type="number" name="otMult" min="1" max="3" step="0.05" value="${D.pay.otMult}"></div></div>
          <p class="hint">${esc(T('Federal rule: overtime after 40 hours in a workweek at 1.5×. Some states (such as California) also require daily overtime after 8 hours. Check your state rules.'))}</p>
          <div class="alert err" hidden></div>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" id="psSave">${esc(T('Save settings'))}</button></div></form></section>`;
    $('#pPrev').onclick = () => { PR.custom = null; PR.offset--; payroll(); };
    $('#pNext').onclick = () => { PR.custom = null; PR.offset++; payroll(); };
    $('#pCur').onclick = () => { PR.custom = null; PR.offset = 0; payroll(); };
    $('#pCustom').onclick = () => {
      modal(`<h2>${esc(T('Custom dates'))}</h2><form id="cf" class="form"><div class="row2"><div class="field"><label>${esc(T('From'))}</label><input type="date" name="a" value="${ymd(from)}" required></div>
        <div class="field"><label>${esc(T('To'))}</label><input type="date" name="b" value="${ymd(to - 1)}" required></div></div><div class="alert err" hidden></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm">${esc(T('Show'))}</button></div></form>`);
      $('#cf').onsubmit = e => { e.preventDefault(); const a = new Date(e.target.a.value + 'T00:00').getTime(), b = addDays(new Date(e.target.b.value + 'T00:00').getTime(), 1); if (!(a < b)) return HM.alertBox($('#modalBody .alert'), T('The end date must be on or after the start date')); PR.custom = [a, b]; closeModal(); payroll(); };
    };
    const psf = $('#psf');
    psf.onsubmit = guard($('#psSave'), async () => {
      shiftCache.clear();
      await act('paySettings', { period: psf.period.value, anchor: psf.anchor.value, otWeekly: +psf.otWeekly.value, otDaily: +psf.otDaily.value, otMult: +psf.otMult.value }, T('Payroll settings saved'));
      PR.offset = 0; payroll();
    });
    let shifts;
    try { shifts = await shiftsBetween(from, to); } catch (e) { $('#payBody').innerHTML = ''; return HM.alertBox(msg, e.message); }
    const { rows, mult } = computePayroll(shifts, from, to);
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    $('#payBody').innerHTML = `<div class="tiles">
        <div class="tile"><span>${esc(T('Officers paid'))}</span><b>${rows.filter(r => r.total > 0).length}</b></div>
        <div class="tile"><span>${esc(T('Total hours'))}</span><b>${hrs(sum('total'))}</b></div>
        <div class="tile"><span>${esc(T('Overtime hours'))}</span><b>${hrs(sum('ot'))}</b></div>
        <div class="tile"><span>${esc(T('Gross pay'))}</span><b>${money(sum('gross'))}</b></div></div>
      ${rows.length ? `<form id="rf"><div class="table-wrap"><table class="data">
        <thead><tr><th>${esc(T('Officer'))}</th><th class="n">${esc(T('Pay rate / hour'))}</th><th class="n">${esc(T('Scheduled'))}</th><th class="n">${esc(T('Regular hours'))}</th><th class="n">${esc(T('Overtime hours'))}</th><th class="n">${esc(T('Gross pay'))}</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><b translate="no">${esc(r.name)}</b><div class="dim small">${esc(T('Badge'))} <span translate="no">${esc(r.badge)}</span>${r.open ? ` · <span class="warn-text">${esc(T('{n} shift(s) still open — not counted', { n: r.open }))}</span>` : ''}</div></td>
          <td class="n"><span class="money-in">$<input name="rate_${esc(r.id)}" type="number" min="0" step="0.01" value="${(r.rate / 100).toFixed(2)}" aria-label="${esc(T('Pay rate / hour'))}"></span></td>
          <td class="n">${hrs(r.sched)}</td><td class="n">${hrs(r.reg)}</td><td class="n${r.ot ? ' warn-text' : ''}">${hrs(r.ot)}</td><td class="n"><b>${money(r.gross)}</b></td>
          <td class="n"><button type="button" class="btn-link" data-detail="${esc(r.id)}">${esc(T('Shifts'))} (${r.shifts.length})</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>${esc(T('Total'))}</td><td></td><td class="n">${hrs(sum('sched'))}</td><td class="n">${hrs(sum('reg'))}</td><td class="n">${hrs(sum('ot'))}</td><td class="n">${money(sum('gross'))}</td><td></td></tr></tfoot>
      </table></div><div class="btn-row"><button class="btn btn-gold btn-sm" id="rSave">${esc(T('Save pay rates'))}</button><button type="button" class="btn btn-ghost btn-sm" data-add-officer>+ ${esc(T('Add officer'))}</button></div></form>`
      : `${empty(T('No officers yet'), T('Add your first officer here. They appear in the mobile app as soon as it syncs.'))}<div class="btn-row"><button type="button" class="btn btn-gold btn-sm" data-add-officer>+ ${esc(T('Add officer'))}</button></div>`}`;
    const rf = $('#rf');
    if (rf) rf.onsubmit = guard($('#rSave'), async () => {
      const rates = {}; for (const el of $$('input[name^="rate_"]', rf)) rates[el.name.slice(5)] = Math.round((+el.value || 0) * 100);
      await act('paySettings', { rates }, T('Pay rates saved')); payroll();
    });
    $$('[data-add-officer]', panel).forEach(b => b.onclick = () => officerForm());
    $$('[data-detail]', panel).forEach(b => b.onclick = () => {
      const r = rows.find(x => x.id === b.dataset.detail);
      modal(`<h2 translate="no">${esc(r.name)}</h2><p class="muted small">${fDate(from)} – ${fDate(to - 1)}</p>
        ${r.shifts.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${esc(T('Site'))}</th><th>${esc(T('Check-in'))}</th><th>${esc(T('Check-out'))}</th><th class="n">${esc(T('Hours'))}</th><th class="n">${esc(T('Overtime'))}</th></tr></thead>
        <tbody>${r.shifts.map(s => `<tr><td translate="no">${esc(siteName(s.siteId))}</td><td>${fDT(s.inAt)}</td><td>${s.outAt ? fDT(s.outAt) : `<span class="warn-text">${esc(T('Still on duty'))}</span>`}</td><td class="n">${hrs(s.h)}</td><td class="n">${hrs(s.ot)}</td></tr>`).join('')}</tbody></table></div>`
        : empty(T('No shifts in this period'))}`, 'wide');
    });
    $('#pXlsx').onclick = () => exportPayroll(rows, mult, from, to, 'xlsx');
    $('#pCsv').onclick = () => exportPayroll(rows, mult, from, to, 'csv');
  }
  // Add an officer from the Payroll tab. The server applies the same rules as the app (limits, badge, site, PIN),
  // and the officer shows up in the mobile app on its next sync.
  function officerForm() {
    const L = D.limits, staff = D.users.filter(u => u.role !== 'admin');
    if (staff.length >= L.officers) return HM.alertBox(msg, T('You have reached the limit of {a} officer accounts', { a: L.officers }));
    const perSite = id => staff.filter(u => u.siteId === id).length;
    modal(`<h2>${esc(T('Add officer'))}</h2>
      <p class="muted small">${esc(T('{a} of {b} accounts used', { a: staff.length, b: L.officers }))} · ${esc(T('Up to {a} officers per site. Only the administrator can add or remove officers.', { a: L.officersPerSite }))}</p>
      <form id="of" class="form">
        <div class="row2"><div class="field"><label>${esc(T('Full name'))}</label><input name="name" required maxlength="120" autocomplete="off"></div>
          <div class="field"><label>${esc(T('Badge number'))}</label><input name="badge" required maxlength="20" inputmode="numeric" autocomplete="off"></div></div>
        <div class="row2"><div class="field"><label>${esc(T('Phone'))}</label><input name="phone" type="tel" maxlength="40"></div>
          <div class="field"><label>${esc(T('Role'))}</label><select name="role">${opt('guard', T('Officer'), true)}${opt('supervisor', T('Supervisor'))}</select></div></div>
        <div class="row2"><div class="field"><label>${esc(T('Assigned site'))}</label>${D.sites.length ? `<select name="siteId" required><option value="" disabled selected>${esc(T('Choose a site'))}</option>${D.sites.map(s => { const n = perSite(s.id), full = n >= L.officersPerSite; return `<option value="${esc(s.id)}"${full ? ' disabled' : ''}>${esc(s.name)} (${n}/${L.officersPerSite}${full ? ' · ' + esc(T('full')) : ''})</option>`; }).join('')}</select>` : `<p class="small warn-text">${esc(T('Add a site in the app (More → Administration) first.'))}</p>`}</div>
          <div class="field"><label>${esc(T('Pay rate / hour'))}</label><span class="money-in big">$<input name="rate" type="number" min="0" step="0.01" value="0.00"></span></div></div>
        <div class="field"><label>${esc(T('PIN (4–8 digits)'))}</label><input name="pin" required inputmode="numeric" pattern="\\d{4,8}" maxlength="8" autocomplete="off">
          <p class="hint">${esc(T('The officer signs in to the app with your company code, their badge number and this PIN.'))}</p></div>
        <div class="alert err" hidden></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="oSave"${D.sites.length ? '' : ' disabled'}>${esc(T('Add officer'))}</button></div>
      </form>`, 'wide');
    const f = $('#of');
    f.onsubmit = guard($('#oSave'), async () => {
      const pin = f.pin.value.trim();
      if (!/^\d{4,8}$/.test(pin)) throw new Error(T('PIN must be 4–8 digits'));
      if (!f.siteId || !f.siteId.value) throw new Error(T('Choose the site this officer is assigned to'));
      await act('officerAdd', { name: f.name.value, badge: f.badge.value, phone: f.phone.value, role: f.role.value, siteId: f.siteId.value,
        pin, rate: Math.round((+f.rate.value || 0) * 100) }, T('Officer added — it will appear in the mobile app on its next sync'));
      closeModal(); payroll();
    });
  }
  function exportPayroll(rows, mult, from, to, kind) {
    const name = `payroll_${ymd(from)}_to_${ymd(to - 1)}`;
    if (kind === 'csv') {
      const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
      const lines = [['Officer', 'Badge', 'Period start', 'Period end', 'Pay rate', 'Regular hours', 'Overtime hours', 'Overtime rate', 'Regular pay', 'Overtime pay', 'Gross pay'].join(',')]
        .concat(rows.filter(r => r.total > 0).map(r => [r.name, r.badge, ymd(from), ymd(to - 1), (r.rate / 100).toFixed(2), hrs(r.reg), hrs(r.ot), (r.rate * mult / 100).toFixed(2), (r.regPay / 100).toFixed(2), (r.otPay / 100).toFixed(2), (r.gross / 100).toFixed(2)].map(q).join(',')));
      return XL.download(name + '.csv', new TextEncoder().encode('﻿' + lines.join('\r\n')), 'text/csv');
    }
    const S = XL.S;
    const head = [T('Officer'), T('Badge'), T('Pay rate / hour'), T('Scheduled'), T('Regular hours'), T('Overtime hours'), T('Total hours'), T('Regular pay'), T('Overtime pay'), T('Gross pay')].map(v => ({ v, s: S.head }));
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    const summary = [[{ v: `${A.company.name} — ${T('Payroll')} ${ymd(from)} – ${ymd(to - 1)}`, s: S.title }],
      [{ v: D.pay.otDaily ? T('Overtime: after {w} hours a week and {h} hours a day, paid at {m}×.', { w: D.pay.otWeekly, h: D.pay.otDaily, m: mult }) : T('Overtime: after {w} hours a week, paid at {m}×.', { w: D.pay.otWeekly, m: mult }), s: S.muted }], [], head]
      .concat(rows.map(r => [r.name, r.badge, { v: r.rate / 100, s: S.money }, { v: r.sched, s: S.hours }, { v: r.reg, s: S.hours }, { v: r.ot, s: S.hours }, { v: r.total, s: S.hours }, { v: r.regPay / 100, s: S.money }, { v: r.otPay / 100, s: S.money }, { v: r.gross / 100, s: S.money }]))
      .concat([[{ v: T('Total'), s: S.bold }, { v: '', s: S.bold }, { v: '', s: S.bold }, { v: sum('sched'), s: S.hoursB }, { v: sum('reg'), s: S.hoursB }, { v: sum('ot'), s: S.hoursB }, { v: sum('total'), s: S.hoursB }, { v: sum('regPay') / 100, s: S.moneyB }, { v: sum('otPay') / 100, s: S.moneyB }, { v: sum('gross') / 100, s: S.moneyB }]]);
    const detail = [[T('Officer'), T('Badge'), T('Site'), T('Check-in'), T('Check-out'), T('Hours'), T('Overtime hours')].map(v => ({ v, s: S.head }))];
    for (const r of rows) for (const s of r.shifts) detail.push([r.name, r.badge, siteName(s.siteId), { v: XL.serial(s.inAt), s: S.dt }, s.outAt ? { v: XL.serial(s.outAt), s: S.dt } : T('Still on duty'), { v: s.h, s: S.hours }, { v: s.ot, s: S.hours }]);
    XL.download(name + '.xlsx', XL.workbook([
      { name: T('Summary').slice(0, 31), widths: [26, 10, 14, 11, 13, 13, 12, 13, 13, 13], rows: summary, headRow: 4 },
      { name: T('Shifts').slice(0, 31), widths: [26, 10, 28, 18, 18, 9, 13], rows: detail, headRow: 1 }], T('Payroll')));
  }

  // =====================================================================
  // BILLING (client invoices)
  // =====================================================================
  const BL = { status: 'all' };
  function billing() {
    const todayS = ymd(Date.now());
    const inv = [...D.invoices].sort((a, b) => (b.issued || '').localeCompare(a.issued || '') || +b.number - +a.number);
    const sent = inv.filter(i => i.status === 'sent'), over = sent.filter(i => i.due && i.due < todayS);
    const paid30 = inv.filter(i => i.status === 'paid' && i.paidAt > Date.now() - 30 * DAY);
    const sum = l => money(l.reduce((a, i) => a + i.total, 0));
    const shown = inv.filter(i => BL.status === 'all' || (BL.status === 'overdue' ? INV.overdue(i) : i.status === BL.status));
    panel.innerHTML = `<div class="dash-head"><div><span class="eyebrow">${esc(T('Billing'))}</span><h1>${esc(T('Client invoices'))}</h1>
      <p class="muted">${esc(T('Bill your clients for the hours your officers worked at their sites. Print or save invoices as PDF, email them, and track what has been paid.'))}</p></div></div>
      <div class="tiles"><button class="tile" data-f="sent"><span>${esc(T('Outstanding'))}</span><b>${sum(sent)}</b></button>
        <button class="tile" data-f="overdue"><span>${esc(T('Overdue'))}</span><b class="${over.length ? 'bad-text' : ''}">${sum(over)}</b></button>
        <button class="tile" data-f="paid"><span>${esc(T('Paid in the last 30 days'))}</span><b>${sum(paid30)}</b></button>
        <button class="tile" data-f="draft"><span>${esc(T('Drafts'))}</span><b>${inv.filter(i => i.status === 'draft').length}</b></button></div>
      <div class="toolbar"><select id="bF" class="sel">${[['all', 'All invoices'], ['draft', 'Drafts'], ['sent', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) => opt(v, T(l), v === BL.status)).join('')}</select>
        <div class="grow"></div><button class="btn btn-ghost btn-sm" id="bX">${esc(T('Export to Excel'))}</button><button class="btn btn-gold btn-sm" id="bNew">${esc(T('New invoice'))}</button></div>
      ${!D.clients.length ? `<div class="alert info">${esc(T('Add a client on the Clients & portal tab first, with their sites and hourly bill rate.'))}</div>` : ''}
      ${shown.length ? `<div class="table-wrap"><table class="data click"><thead><tr><th>${esc(T('Invoice'))}</th><th>${esc(T('Client'))}</th><th>${esc(T('Service period'))}</th><th>${esc(T('Due'))}</th><th class="n">${esc(T('Total'))}</th><th>${esc(T('Status'))}</th></tr></thead>
        <tbody>${shown.map(i => `<tr data-open="${i.id}" tabindex="0"><td translate="no"><b>#${esc(i.number)}</b></td><td translate="no">${esc(clientById(i.clientId)?.name || '—')}</td>
          <td>${i.from ? `${fDate(i.from + 'T12:00', { month: 'short', day: 'numeric' })} – ${fDate(i.to + 'T12:00')}` : '—'}</td><td>${i.due ? fDate(i.due + 'T12:00') : '—'}</td>
          <td class="n"><b>${money(i.total)}</b></td><td>${pill(T(INV.statusOf(i)), { Paid: 'ok', Overdue: 'bad', Unpaid: 'warn', Draft: '', Void: '' }[INV.statusOf(i)])}</td></tr>`).join('')}</tbody></table></div>`
        : empty(T('No invoices here yet'), D.clients.length ? T('Create one with New invoice. It can fill itself in from the hours worked at the client\'s sites.') : '')}`;
    $$('[data-f]', panel).forEach(b => b.onclick = () => { BL.status = b.dataset.f; billing(); });
    $('#bF').onchange = e => { BL.status = e.target.value; billing(); };
    $('#bNew').onclick = () => D.clients.length ? invoiceForm({}) : (location.hash = '#clients');
    $('#bX').onclick = () => exportInvoices(shown);
    $$('[data-open]', panel).forEach(r => { r.onclick = () => invoiceView(r.dataset.open); r.onkeydown = e => { if (e.key === 'Enter') invoiceView(r.dataset.open); }; });
  }
  function invoiceForm({ inv, clientId }) {
    const x = inv || { lines: [], taxPct: D.profile.taxPct || 0, clientId: clientId || D.clients[0]?.id };
    const lastMonth = (() => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 1, 1), new Date(d.getFullYear(), d.getMonth(), 0)]; })();
    const issued = x.issued || ymd(Date.now());
    const termsOf = cid => { const c = clientById(cid); return c && c.terms != null ? c.terms : (D.profile.terms ?? 15); };
    modal(`<h2>${esc(inv ? T('Edit invoice #{n}', { n: inv.number }) : T('New invoice'))}</h2>
      <form id="if" class="form">
        <div class="row3"><div class="field"><label>${esc(T('Client'))}</label><select name="clientId">${D.clients.map(c => opt(c.id, c.name, c.id === x.clientId)).join('')}</select></div>
          <div class="field"><label>${esc(T('Service from'))}</label><input type="date" name="from" value="${x.from || ymd(lastMonth[0])}"></div>
          <div class="field"><label>${esc(T('Service to'))}</label><input type="date" name="to" value="${x.to || ymd(lastMonth[1])}"></div></div>
        <div class="btn-row" style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="iFill">${esc(T('Fill from hours worked'))}</button><span class="hint" id="iFillNote"></span></div>
        <div class="table-wrap" style="margin-top:14px"><table class="data lines"><thead><tr><th>${esc(T('Description'))}</th><th class="n">${esc(T('Hours / qty'))}</th><th class="n">${esc(T('Rate'))}</th><th class="n">${esc(T('Amount'))}</th><th></th></tr></thead><tbody id="iLines"></tbody></table></div>
        <button type="button" class="btn-link" id="iAdd">+ ${esc(T('Add line'))}</button>
        <div class="row4" style="margin-top:12px"><div class="field"><label>${esc(T('Tax %'))}</label><input type="number" name="taxPct" min="0" max="50" step="0.01" value="${x.taxPct || 0}"></div>
          <div class="field"><label>${esc(T('Issue date'))}</label><input type="date" name="issued" value="${issued}"></div>
          <div class="field"><label>${esc(T('Due date'))}</label><input type="date" name="due" value="${x.due || ymd(addDays(new Date(issued + 'T12:00').getTime(), termsOf(x.clientId)))}"></div>
          <div class="field inv-total-box"><label>${esc(T('Total'))}</label><b id="iTotal"></b></div></div>
        <div class="field"><label>${esc(T('Notes on the invoice'))}</label><textarea name="notes" rows="2" maxlength="2000">${esc(x.notes || '')}</textarea></div>
        <div class="alert err" hidden></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="iSave">${esc(T('Save draft'))}</button></div>
      </form>`, 'wide');
    const f = $('#if'), body = $('#iLines');
    const lineRow = l => `<tr><td><input name="desc" value="${esc(l.desc || '')}" maxlength="300" translate="no"></td><td class="n"><input name="qty" type="number" step="0.01" min="0" value="${l.qty ?? ''}" class="num"></td>
      <td class="n"><span class="money-in">$<input name="rate" type="number" step="0.01" min="0" value="${l.rate != null ? (l.rate / 100).toFixed(2) : ''}" class="num"></span></td><td class="n amt"></td>
      <td><button type="button" class="btn-link" data-rm aria-label="${esc(T('Remove line'))}">×</button></td></tr>`;
    const lines = () => $$('tr', body).map(tr => ({ desc: tr.querySelector('[name=desc]').value.trim(), qty: +tr.querySelector('[name=qty]').value || 0, rate: Math.round((+tr.querySelector('[name=rate]').value || 0) * 100) }));
    const totals = () => {
      $$('tr', body).forEach((tr, i) => { const l = lines()[i]; tr.querySelector('.amt').textContent = money(Math.round(l.qty * l.rate)); });
      const sub = lines().reduce((a, l) => a + Math.round(l.qty * l.rate), 0), tax = Math.round(sub * (+f.taxPct.value || 0) / 100);
      $('#iTotal').textContent = money(sub + tax);
    };
    const setLines = ls => { body.innerHTML = (ls.length ? ls : [{}]).map(lineRow).join(''); totals(); };
    setLines(x.lines);
    f.addEventListener('input', totals);
    body.addEventListener('click', e => { if (e.target.closest('[data-rm]')) { e.target.closest('tr').remove(); if (!body.children.length) setLines([]); totals(); } });
    $('#iAdd').onclick = () => { body.insertAdjacentHTML('beforeend', lineRow({ rate: clientById(f.clientId.value)?.rate })); totals(); };
    f.clientId.onchange = () => { f.due.value = ymd(addDays(new Date(f.issued.value + 'T12:00').getTime(), termsOf(f.clientId.value))); };
    f.issued.onchange = f.clientId.onchange;
    $('#iFill').onclick = guard($('#iFill'), async () => {
      const c = clientById(f.clientId.value); if (!c) return;
      if (!c.siteIds.length) throw new Error(T('This client has no sites. Edit the client and choose their sites first.'));
      const a = new Date(f.from.value + 'T00:00').getTime(), b = addDays(new Date(f.to.value + 'T00:00').getTime(), 1);
      if (!(a < b)) throw new Error(T('The end date must be on or after the start date'));
      const shifts = (await shiftsBetween(a, b)).filter(s => c.siteIds.includes(s.siteId) && s.outAt && s.inAt >= a && s.inAt < b);
      const per = {}; for (const s of shifts) per[s.siteId] = (per[s.siteId] || 0) + (s.outAt - s.inAt) / 3600000;
      const ls = c.siteIds.filter(id => per[id]).map(id => ({ desc: `${T('Security officer services')} — ${siteName(id)} (${fDate(a, { month: 'short', day: 'numeric' })} – ${fDate(b - 1)})`, qty: Math.round(per[id] * 100) / 100, rate: c.rate }));
      $('#iFillNote').textContent = ls.length ? T('{n} completed shifts, {h} hours', { n: shifts.length, h: hrs(shifts.reduce((s, x) => s + (x.outAt - x.inAt) / 3600000, 0)) }) : T('No completed shifts at this client\'s sites in these dates');
      if (ls.length) setLines(ls.concat(lines().filter(l => l.desc && !l.desc.startsWith(T('Security officer services')))));
    });
    f.onsubmit = guard($('#iSave'), async () => {
      const ls = lines().filter(l => l.desc || l.qty);
      if (!ls.length) throw new Error(T('Add at least one line'));
      const r = await act('invoiceSave', { id: inv?.id, clientId: f.clientId.value, from: f.from.value, to: f.to.value, lines: ls, taxPct: +f.taxPct.value || 0, issued: f.issued.value, due: f.due.value, notes: f.notes.value }, T('Invoice saved'));
      if (tab === 'billing') billing(); else go(tab);
      invoiceView(r.id);
    });
  }
  function invoiceView(id) {
    const inv = D.invoices.find(i => i.id === id); if (!inv) return;
    const client = clientById(inv.clientId) || {};
    const data = { inv, client, profile: D.profile, company: D.company };
    const portal = `${location.origin}/client?company=${encodeURIComponent(D.company.code)}`;
    modal(`<div class="inv-actions">
        <button class="btn btn-ghost btn-sm" id="vPrint">${esc(T('Print / save PDF'))}</button>
        ${client.email && inv.status !== 'void' ? `<a class="btn btn-ghost btn-sm" id="vMail">${esc(T('Email to client'))}</a>` : ''}
        ${inv.status === 'draft' ? `<button class="btn btn-ghost btn-sm" id="vEdit">${esc(T('Edit'))}</button><button class="btn btn-gold btn-sm" data-st="sent">${esc(T('Mark as sent'))}</button>` : ''}
        ${inv.status === 'sent' ? `<button class="btn btn-gold btn-sm" data-st="paid">${esc(T('Mark as paid'))}</button>` : ''}
        ${inv.status === 'paid' ? `<button class="btn btn-ghost btn-sm" data-st="sent">${esc(T('Mark as unpaid'))}</button>` : ''}
        ${inv.status === 'draft' ? `<button class="btn btn-danger btn-sm" id="vDel">${esc(T('Delete draft'))}</button>` : inv.status !== 'void' ? `<button class="btn btn-danger btn-sm" data-st="void">${esc(T('Void'))}</button>` : ''}
      </div><div class="alert err" hidden></div><div class="paper">${INV.doc(data)}</div>`, 'wide nofocus');
    $('#vPrint').onclick = () => INV.print(data);
    const mail = $('#vMail');
    if (mail) {
      const subj = T('Invoice {n} from {company}', { n: inv.number, company: D.profile.name || D.company.name });
      const bodyTxt = [T('Hello {name},', { name: client.contact || client.name }), '',
        T('Here is invoice {n} for {amount}, due {date}.', { n: inv.number, amount: money(inv.total), date: inv.due ? fDate(inv.due + 'T12:00') : '—' }),
        client.portal ? T('You can view and print it in your client portal: {url}', { url: portal }) : '', '',
        D.profile.payTo ? T('How to pay') + ':\n' + D.profile.payTo : '', '', T('Thank you,'), D.profile.name || D.company.name].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
      mail.href = `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(bodyTxt)}`;
      mail.onclick = async () => { if (inv.status === 'draft') { try { await act('invoiceStatus', { id, status: 'sent' }); if (tab === 'billing') billing(); } catch (e) { } } };
    }
    const ed = $('#vEdit'); if (ed) ed.onclick = () => invoiceForm({ inv });
    const del = $('#vDel'); if (del) del.onclick = guard(del, async () => { if (!confirm(T('Delete this draft invoice?'))) return; await act('invoiceDelete', { id }, T('Draft deleted')); closeModal(); go(tab); });
    $$('[data-st]', $('#modalBody')).forEach(b => b.onclick = guard(b, async () => {
      if (b.dataset.st === 'void' && !confirm(T('Void invoice #{n}? It stays on record but no longer counts as owed.', { n: inv.number }))) return;
      await act('invoiceStatus', { id, status: b.dataset.st }, T('Invoice updated')); go(tab); invoiceView(id);
    }));
  }
  function exportInvoices(list) {
    const S = XL.S;
    const rows = [[T('Invoice'), T('Client'), T('Issued'), T('Due'), T('Service from'), T('Service to'), T('Subtotal'), T('Tax'), T('Total'), T('Status'), T('Paid on')].map(v => ({ v, s: S.head }))]
      .concat(list.map(i => [i.number, clientById(i.clientId)?.name || '', i.issued || '', i.due || '', i.from || '', i.to || '', { v: i.subtotal / 100, s: S.money }, { v: i.tax / 100, s: S.money }, { v: i.total / 100, s: S.money }, T(INV.statusOf(i)), i.paidAt ? { v: XL.serial(dayStart(i.paidAt)), s: S.date } : '']));
    XL.download(`invoices_${ymd(Date.now())}.xlsx`, XL.workbook([{ name: T('Invoices').slice(0, 31), widths: [10, 28, 12, 12, 12, 12, 12, 10, 12, 10, 12], rows, headRow: 1 }], T('Invoices')));
  }

  // =====================================================================
  // CLIENTS & PORTAL
  // =====================================================================
  function clients() {
    const portal = `${location.origin}/client?company=${encodeURIComponent(D.company.code)}`;
    const reqs = [...D.requests].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.updatedAt - a.updatedAt);
    const owed = cid => D.invoices.filter(i => i.clientId === cid && i.status === 'sent').reduce((a, i) => a + i.total, 0);
    panel.innerHTML = `<div class="dash-head"><div><span class="eyebrow">${esc(T('Clients & portal'))}</span><h1>${esc(T('Clients'))}</h1>
      <p class="muted">${esc(T('The properties and businesses you protect. Give a client portal access and they can see the reports, check-ins and guard-tour scans for their own sites, view their invoices and send you requests.'))}</p></div></div>
      <div class="card portal-box"><div><span class="eyebrow">${esc(T('Client portal address'))}</span><p class="portal-url" translate="no">${esc(portal)}</p>
        <p class="dim small">${esc(T('Clients sign in with your company code, their email address and the portal PIN you set for them.'))}</p></div>
        <button class="btn btn-ghost btn-sm" id="cCopy">${esc(T('Copy link'))}</button></div>
      <div class="toolbar"><h3 style="margin:0">${esc(T('Clients'))}</h3><div class="grow"></div><button class="btn btn-gold btn-sm" id="cNew">${esc(T('Add client'))}</button></div>
      ${D.clients.length ? `<div class="client-grid">${D.clients.map(c => `<article class="card client">
          <div class="row-between"><h3 translate="no">${esc(c.name)}</h3>${c.portal ? pill(T('Portal on'), 'ok') : pill(T('No portal access'), '')}</div>
          <p class="muted small" translate="no">${esc([c.contact, c.email, c.phone].filter(Boolean).join(' · '))}</p>
          <dl class="kv"><dt>${esc(T('Sites'))}</dt><dd translate="no">${esc(c.siteIds.map(siteName).join(', ') || '—')}</dd>
            <dt>${esc(T('Bill rate / hour'))}</dt><dd>${money(c.rate)}</dd>
            <dt>${esc(T('Owed'))}</dt><dd>${money(owed(c.id))}</dd>
            <dt>${esc(T('Open requests'))}</dt><dd>${D.requests.filter(r => r.clientId === c.id && r.status === 'open').length}</dd></dl>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" data-cedit="${c.id}">${esc(T('Edit'))}</button><button class="btn btn-ghost btn-sm" data-cinv="${c.id}">${esc(T('New invoice'))}</button></div>
        </article>`).join('')}</div>` : empty(T('No clients yet'), T('Add your first client to start billing and give them portal access.'))}
      <div class="toolbar" style="margin-top:34px"><h3 style="margin:0">${esc(T('Client requests'))}</h3></div>
      ${reqs.length ? `<ul class="list req-list">${reqs.map(r => `<li data-req="${r.id}" tabindex="0"><div><b translate="no">${esc(r.subject)}</b>
          <div class="dim small"><span translate="no">${esc(clientById(r.clientId)?.name || r.clientName || '')}</span> · ${fDT(r.updatedAt || r.at)} · ${esc(T(r.thread.length === 1 ? '1 message' : '{n} messages', { n: r.thread.length }))}</div></div>
          ${pill(T(r.status === 'open' ? 'Open' : 'Closed'), r.status === 'open' ? 'warn' : '')}</li>`).join('')}</ul>` : empty(T('No requests yet'), T('Requests your clients send from the portal appear here and in the app\'s report alerts.'))}`;
    $('#cCopy').onclick = async () => { try { await navigator.clipboard.writeText(portal); toast(T('Link copied')); } catch (e) { prompt(T('Copy this link'), portal); } };
    $('#cNew').onclick = () => clientForm();
    $$('[data-cedit]', panel).forEach(b => b.onclick = () => clientForm(clientById(b.dataset.cedit)));
    $$('[data-cinv]', panel).forEach(b => b.onclick = () => invoiceForm({ clientId: b.dataset.cinv }));
    $$('[data-req]', panel).forEach(li => { li.onclick = () => requestView(li.dataset.req); li.onkeydown = e => { if (e.key === 'Enter') requestView(li.dataset.req); }; });
  }
  function clientForm(c) {
    const x = c || { siteIds: [], rate: 0 };
    modal(`<h2>${esc(T(c ? 'Edit client' : 'Add client'))}</h2>
      <form id="cf" class="form">
        <div class="row2"><div class="field"><label>${esc(T('Client name'))}</label><input name="name" required maxlength="160" value="${esc(x.name || '')}" placeholder="${esc(T('Business or property name'))}"></div>
          <div class="field"><label>${esc(T('Contact person'))}</label><input name="contact" maxlength="160" value="${esc(x.contact || '')}"></div></div>
        <div class="row2"><div class="field"><label>${esc(T('Email'))}</label><input name="email" type="email" maxlength="200" value="${esc(x.email || '')}"><p class="hint">${esc(T('Invoices go here. It is also their portal sign-in.'))}</p></div>
          <div class="field"><label>${esc(T('Phone'))}</label><input name="phone" maxlength="40" value="${esc(x.phone || '')}"></div></div>
        <div class="field"><label>${esc(T('Billing address'))}</label><textarea name="address" rows="2" maxlength="300">${esc(x.address || '')}</textarea></div>
        <div class="field"><label>${esc(T('Their sites'))}</label><div class="checks-row">${D.sites.length ? D.sites.map(s => `<label class="day"><input type="checkbox" name="site" value="${esc(s.id)}"${x.siteIds.includes(s.id) ? ' checked' : ''}><span translate="no">${esc(s.name)}</span></label>`).join('') : `<span class="dim small">${esc(T('No sites yet. Add sites in the app first.'))}</span>`}</div>
          <p class="hint">${esc(T('Invoices are filled from hours worked at these sites, and the portal shows only these sites.'))}</p></div>
        <div class="row2"><div class="field"><label>${esc(T('Bill rate per officer hour'))}</label><span class="money-in big">$<input name="rate" type="number" min="0" step="0.01" value="${(x.rate / 100).toFixed(2)}"></span></div>
          <div class="field"><label>${esc(T('Payment terms (days)'))}</label><input name="terms" type="number" min="0" max="120" value="${x.terms ?? ''}" placeholder="${esc(T('Default: {n}', { n: D.profile.terms ?? 15 }))}"></div></div>
        <fieldset class="portal-set"><legend>${esc(T('Client portal'))}</legend>
          <p class="small muted">${esc(x.portal ? T('Portal access is on. Set a new PIN to reset it.') : T('Set a PIN of 4–8 digits to give this client portal access.'))}</p>
          <div class="row2"><div class="field"><label>${esc(T(x.portal ? 'New portal PIN' : 'Portal PIN'))}</label><input name="portalPin" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" autocomplete="off"></div>
          ${x.portal ? `<label class="check" style="align-self:end"><input type="checkbox" name="portalOff"><span>${esc(T('Turn off portal access'))}</span></label>` : ''}</div></fieldset>
        <div class="alert err" hidden></div>
        <div class="btn-row">${c ? `<button type="button" class="btn btn-danger btn-sm" id="cDel">${esc(T('Remove client'))}</button><div class="grow"></div>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="cSave">${esc(T('Save client'))}</button></div>
      </form>`, 'wide');
    const f = $('#cf');
    f.onsubmit = guard($('#cSave'), async () => {
      const pin = f.portalPin.value.trim();
      if (pin && !/^\d{4,8}$/.test(pin)) throw new Error(T('Portal PIN must be 4–8 digits'));
      const r = await act('clientSave', { id: c?.id, name: f.name.value, contact: f.contact.value, email: f.email.value, phone: f.phone.value, address: f.address.value,
        siteIds: $$('input[name=site]:checked', f).map(i => i.value), rate: Math.round((+f.rate.value || 0) * 100), terms: f.terms.value, portalPin: pin,
        portalOff: f.portalOff ? f.portalOff.checked : false }, T('Client saved'));
      clients();
      if (pin) invite(clientById(r.id), pin); else closeModal();
    });
    if (c) $('#cDel').onclick = guard($('#cDel'), async () => {
      if (!confirm(T('Remove {name}? Their invoices stay on record.', { name: c.name }))) return;
      await act('clientDelete', { id: c.id }, T('Client removed')); closeModal(); clients();
    });
  }
  // After a portal PIN is set: offer an email with the sign-in details.
  function invite(c, pin) {
    const url = `${location.origin}/client?company=${encodeURIComponent(D.company.code)}`;
    const body = [T('Hello {name},', { name: c.contact || c.name }), '', T('You now have access to the {company} client portal. You can see reports, officer check-ins and guard-tour scans for your sites, view invoices and send us requests.', { company: D.profile.name || D.company.name }), '',
      T('Portal: {url}', { url }), T('Company code: {code}', { code: D.company.code }), T('Email: {email}', { email: c.email }), T('PIN: {pin}', { pin }), '', T('Thank you,'), D.profile.name || D.company.name].join('\n');
    modal(`<h2>${esc(T('Portal access is ready'))}</h2>
      <p class="muted">${esc(T('Send {name} their sign-in details. The PIN is shown only now.', { name: c.name }))}</p>
      <dl class="kv"><dt>${esc(T('Portal'))}</dt><dd translate="no">${esc(url)}</dd><dt>${esc(T('Company code'))}</dt><dd translate="no">${esc(D.company.code)}</dd><dt>${esc(T('Email'))}</dt><dd translate="no">${esc(c.email)}</dd><dt>${esc(T('PIN'))}</dt><dd translate="no"><b>${esc(pin)}</b></dd></dl>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" data-close>${esc(T('Done'))}</button>
        <a class="btn btn-gold btn-sm" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(T('Your client portal access'))}&body=${encodeURIComponent(body)}">${esc(T('Email sign-in details'))}</a></div>`);
  }
  function requestView(id) {
    const r = D.requests.find(x => x.id === id); if (!r) return;
    const c = clientById(r.clientId);
    modal(`<h2 translate="no">${esc(r.subject)}</h2><p class="muted small"><span translate="no">${esc(c?.name || r.clientName || '')}</span>${r.siteId ? ` · <span translate="no">${esc(siteName(r.siteId))}</span>` : ''} · ${fDT(r.at)}</p>
      <div class="thread">${r.thread.map(m => `<div class="bubble ${m.from === 'company' ? 'me' : ''}"><div class="who"><span translate="no">${esc(m.name)}</span> · ${fDT(m.at)}</div><p translate="no">${esc(m.text).replace(/\n/g, '<br>')}</p></div>`).join('')}</div>
      <form id="rq" class="form"><div class="field"><label>${esc(T('Reply'))}</label><textarea name="text" rows="3" maxlength="4000"></textarea></div><div class="alert err" hidden></div>
        <div class="btn-row">${r.status === 'open' ? `<button type="button" class="btn btn-ghost btn-sm" id="rqClose">${esc(T('Close request'))}</button>` : `<button type="button" class="btn btn-ghost btn-sm" id="rqOpen">${esc(T('Reopen'))}</button>`}
          <div class="grow"></div><button class="btn btn-gold btn-sm" id="rqSend">${esc(T('Send reply'))}</button></div></form>`, 'wide');
    const f = $('#rq');
    f.onsubmit = guard($('#rqSend'), async () => { if (!f.text.value.trim()) throw new Error(T('Write a message')); await act('requestReply', { id, text: f.text.value }, T('Reply sent')); clients(); requestView(id); });
    const cl = $('#rqClose'), op = $('#rqOpen');
    if (cl) cl.onclick = guard(cl, async () => { await act('requestReply', { id, text: f.text.value, status: 'closed' }, T('Request closed')); clients(); closeModal(); });
    if (op) op.onclick = guard(op, async () => { await act('requestReply', { id, status: 'open' }, T('Request reopened')); clients(); requestView(id); });
  }

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function settings() {
    const p = D.profile;
    panel.innerHTML = `<div class="dash-head"><div><span class="eyebrow">${esc(T('Settings'))}</span><h1>${esc(T('Settings'))}</h1></div></div>
      <div class="grid2">
        <section class="card"><h3>${esc(T('Business details for invoices'))}</h3>
          <form id="bp" class="form">
            <div class="field"><label>${esc(T('Business name'))}</label><input name="name" maxlength="160" value="${esc(p.name || '')}" placeholder="${esc(D.company.name)}"></div>
            <div class="field"><label>${esc(T('Address'))}</label><textarea name="address" rows="3" maxlength="600">${esc(p.address || '')}</textarea></div>
            <div class="row2"><div class="field"><label>${esc(T('Phone'))}</label><input name="phone" maxlength="40" value="${esc(p.phone || '')}"></div>
              <div class="field"><label>${esc(T('Billing email'))}</label><input name="email" type="email" maxlength="160" value="${esc(p.email || '')}"></div></div>
            <div class="field"><label>${esc(T('How clients pay you'))}</label><textarea name="payTo" rows="3" maxlength="600" placeholder="${esc(T('For example: Check payable to … / Zelle … / Bank transfer …'))}">${esc(p.payTo || '')}</textarea></div>
            <div class="row2"><div class="field"><label>${esc(T('Default payment terms (days)'))}</label><input name="terms" type="number" min="0" max="120" value="${p.terms ?? 15}"></div>
              <div class="field"><label>${esc(T('Default tax %'))}</label><input name="taxPct" type="number" min="0" max="50" step="0.01" value="${p.taxPct || 0}"></div></div>
            <div class="alert err" hidden></div>
            <div class="btn-row"><button class="btn btn-gold btn-sm" id="bpSave">${esc(T('Save'))}</button></div></form></section>
        <section class="card"><h3>${esc(T('Language'))}</h3>
          <p class="muted small" style="margin:10px 0 14px">${esc(T('Choose the language for the website, this dashboard and the app on this device. Each officer can choose their own language in the app.'))}</p>
          <div id="langSlot"></div>
          <h3 style="margin-top:30px">${esc(T('Company account'))}</h3>
          <dl class="kv"><dt>${esc(T('Company code'))}</dt><dd translate="no">${esc(A.company.code)}</dd><dt>${esc(T('Account email'))}</dt><dd translate="no">${esc(A.company.email || '—')}</dd><dt>${esc(T('Created'))}</dt><dd>${fDate(A.company.createdAt)}</dd></dl>
        </section>
        ${D.inquiries ? enterpriseCard() : ''}
      </div>`;
    if (window.I18N) $('#langSlot').appendChild(I18N.picker('lang-select big'));
    if (D.inquiries) enterpriseWire();
    const f = $('#bp');
    f.onsubmit = guard($('#bpSave'), async () => {
      await act('profile', { name: f.name.value, address: f.address.value, phone: f.phone.value, email: f.email.value, payTo: f.payTo.value, terms: +f.terms.value, taxPct: +f.taxPct.value }, T('Saved'));
    });
  }

  // Owner company only: enterprise enquiries from the website, and the plan of every customer company.
  const ST = { new: ['New', 'warn'], contacted: ['Contacted', ''], won: ['Won', 'ok'], closed: ['Closed', ''] };
  function enterpriseCard() {
    const q = D.inquiries, cs = D.companies || [];
    return `<section class="card wide-card"><h3>${esc(T('Enterprise'))}</h3>
      <p class="muted small" style="margin:8px 0 14px">${esc(T('Enquiries sent from the Enterprise page of the website. Agree a price with the customer, ask them to sign up on any plan, then set their company to Enterprise below.'))}</p>
      ${q.length ? `<ul class="list">${q.map(x => `<li><div><b translate="no">${esc(x.company)}</b> <span class="muted small" translate="no">· ${esc(x.name)} · <a href="mailto:${esc(x.email)}">${esc(x.email)}</a>${x.phone ? ' · ' + esc(x.phone) : ''}</span>
        <div class="dim small">${fDate(x.at)} · ${esc(T('{s} sites, {o} officers', { s: x.sites || '?', o: x.officers || '?' }))}</div>${x.message ? `<div class="small" translate="no" style="margin-top:4px">${esc(x.message)}</div>` : ''}</div>
        <select class="inq" data-id="${esc(x.id)}" aria-label="${esc(T('Status'))}">${Object.entries(ST).map(([k, v]) => opt(k, T(v[0]), x.status === k)).join('')}</select></li>`).join('')}</ul>` : empty(T('No enquiries yet'))}
      <h3 style="margin-top:26px">${esc(T('Customer plans'))}</h3>
      ${cs.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${esc(T('Company'))}</th><th>${esc(T('Plan'))}</th><th class="n">${esc(T('Price'))}</th><th class="n">${esc(T('Sites'))}</th><th class="n">${esc(T('Officers'))}</th><th></th></tr></thead>
        <tbody>${cs.map(c => `<tr><td><b translate="no">${esc(c.name)}</b><div class="dim small" translate="no">${esc(c.code)}</div></td><td>${esc(T(c.planName))}</td><td class="n">${money(c.price)}</td>
          <td class="n">${c.usage.sites} / ${c.sites}</td><td class="n">${c.usage.officers} / ${c.officers}</td><td class="n"><button type="button" class="btn-link" data-setplan="${esc(c.code)}">${esc(T('Change'))}</button></td></tr>`).join('')}</tbody></table></div>`
        : empty(T('No customer companies yet'))}
    </section>`;
  }
  function enterpriseWire() {
    $$('select.inq', panel).forEach(sel => sel.onchange = guard(null, async () => { await act('inquiryStatus', { id: sel.dataset.id, status: sel.value }, T('Saved')); }));
    $$('[data-setplan]', panel).forEach(b => b.onclick = () => {
      const c = D.companies.find(x => x.code === b.dataset.setplan);
      modal(`<h2 translate="no">${esc(c.name)}</h2><p class="muted small">${esc(T('Uses {s} site(s) and {o} officer account(s).', { s: c.usage.sites, o: c.usage.officers }))}</p>
        <form id="sp" class="form"><div class="field"><label>${esc(T('Plan'))}</label><select name="plan">${['starter', 'pro', 'business', 'enterprise'].map(k => opt(k, T(k[0].toUpperCase() + k.slice(1)), c.plan === k)).join('')}</select></div>
          <div class="row2" id="entFields"><div class="field"><label>${esc(T('Sites'))}</label><input name="sites" type="number" min="1" value="${c.plan === 'enterprise' ? c.sites : 10}"></div>
            <div class="field"><label>${esc(T('Officers'))}</label><input name="officers" type="number" min="1" value="${c.plan === 'enterprise' ? c.officers : 100}"></div></div>
          <div class="field" id="entPrice"><label>${esc(T('Monthly price'))}</label><span class="money-in big">$<input name="price" type="number" min="1" step="0.01" value="${c.plan === 'enterprise' ? (c.price / 100).toFixed(2) : '599.00'}"></span>
            <p class="hint">${esc(T('Their Stripe subscription moves to this price; the difference is prorated on their next invoice.'))}</p></div>
          <div class="alert err" hidden></div>
          <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-close>${esc(T('Cancel'))}</button><button class="btn btn-gold btn-sm" id="spSave">${esc(T('Save'))}</button></div></form>`);
      const f = $('#sp');
      const toggle = () => { const e = f.plan.value === 'enterprise'; $('#entFields').hidden = !e; $('#entPrice').hidden = !e; };
      f.plan.onchange = toggle; toggle();
      f.onsubmit = guard($('#spSave'), async () => {
        await act('ownerSetPlan', { code: c.code, plan: f.plan.value, sites: +f.sites.value, officers: +f.officers.value, price: Math.round((+f.price.value || 0) * 100) }, T('Plan saved'));
        closeModal(); settings();
      });
    });
  }

  const TABS = { overview, schedule, payroll, billing, clients, settings };
  load();
})();
