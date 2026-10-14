/* Invoice document: shown in the dashboard and the client portal, and printed / saved as PDF from the browser. */
(function () {
  const T = (k, v) => HM.t(k, v);
  const esc = s => HM.esc(s);
  const money = c => HM.money(c || 0);
  const day = s => s ? new Date(s + 'T12:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const STATUS = { draft: 'Draft', sent: 'Unpaid', paid: 'Paid', void: 'Void' };
  const overdue = inv => inv.status === 'sent' && inv.due && inv.due < new Date().toISOString().slice(0, 10);
  const statusOf = inv => overdue(inv) ? 'Overdue' : STATUS[inv.status] || inv.status;
  const multiline = s => esc(s || '').replace(/\n/g, '<br>');

  function doc({ inv, client, profile, company }) {
    const p = profile || {}, c = client || {};
    const from = p.name || company.name;
    const lines = inv.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${(+l.qty).toFixed(2)}</td><td class="n">${money(l.rate)}</td><td class="n">${money(Math.round(l.qty * l.rate))}</td></tr>`).join('');
    return `<article class="inv-doc">
      <header class="inv-top">
        <div><div class="inv-from" translate="no">${esc(from)}</div><div class="inv-addr" translate="no">${multiline(p.address)}${p.phone ? '<br>' + esc(p.phone) : ''}${p.email ? '<br>' + esc(p.email) : ''}</div></div>
        <div class="inv-meta"><div class="inv-title">${T('Invoice')}</div><div><span>${T('Invoice number')}</span><b translate="no">${esc(inv.number)}</b></div>
          <div><span>${T('Issued')}</span><b>${day(inv.issued)}</b></div><div><span>${T('Due')}</span><b>${day(inv.due)}</b></div>
          <div><span>${T('Status')}</span><b class="inv-st inv-${overdue(inv) ? 'overdue' : inv.status}">${T(statusOf(inv))}</b></div></div>
      </header>
      <section class="inv-to"><span>${T('Bill to')}</span><div translate="no"><b>${esc(c.name || '')}</b>${c.contact ? '<br>' + esc(c.contact) : ''}${c.address ? '<br>' + multiline(c.address) : ''}${c.email ? '<br>' + esc(c.email) : ''}</div>
        ${inv.from || inv.to ? `<p class="inv-period">${T('Service period')}: ${day(inv.from)} – ${day(inv.to)}</p>` : ''}</section>
      <table class="inv-lines"><thead><tr><th>${T('Description')}</th><th class="n">${T('Hours / qty')}</th><th class="n">${T('Rate')}</th><th class="n">${T('Amount')}</th></tr></thead><tbody translate="no">${lines}</tbody></table>
      <div class="inv-sum"><div><span>${T('Subtotal')}</span><b>${money(inv.subtotal)}</b></div>
        ${inv.taxPct ? `<div><span>${T('Tax')} (${inv.taxPct}%)</span><b>${money(inv.tax)}</b></div>` : ''}
        <div class="inv-total"><span>${T('Total due')}</span><b>${money(inv.total)}</b></div>
        ${inv.status === 'paid' && inv.paidAt ? `<div><span>${T('Paid on')}</span><b>${new Date(inv.paidAt).toLocaleDateString()}</b></div>` : ''}</div>
      ${p.payTo ? `<section class="inv-note"><span>${T('How to pay')}</span><p translate="no">${multiline(p.payTo)}</p></section>` : ''}
      ${inv.notes ? `<section class="inv-note"><span>${T('Notes')}</span><p translate="no">${multiline(inv.notes)}</p></section>` : ''}
    </article>`;
  }
  const PRINT_CSS = `body{margin:0;font:14px/1.5 Inter,Arial,sans-serif;color:#141820;background:#fff}
  .inv-doc{max-width:780px;margin:0 auto;padding:40px}
  .inv-top{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #b8955a;padding-bottom:20px}
  .inv-from{font:600 22px Lora,Georgia,serif}.inv-addr{color:#555;margin-top:6px}
  .inv-meta{min-width:230px}.inv-meta div{display:flex;justify-content:space-between;gap:16px}.inv-meta span{color:#666}
  .inv-title{font:600 30px Lora,Georgia,serif;color:#8e6936;margin-bottom:6px;justify-content:flex-end!important}
  .inv-to{margin:24px 0}.inv-to>span,.inv-note>span{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8e6936;margin-bottom:4px}
  .inv-period{color:#555;margin-top:10px}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#666;border-bottom:1px solid #ccc;padding:8px 6px}
  td{padding:9px 6px;border-bottom:1px solid #eee;vertical-align:top}.n{text-align:right;white-space:nowrap}
  .inv-sum{margin:16px 0 0 auto;max-width:300px}.inv-sum div{display:flex;justify-content:space-between;padding:4px 0}
  .inv-total{border-top:2px solid #141820;margin-top:6px;padding-top:8px!important;font-size:17px}
  .inv-note{margin-top:24px}.inv-st{font-weight:600}.inv-overdue{color:#b42318}.inv-paid{color:#067647}
  [dir=rtl] th{text-align:right}[dir=rtl] .n{text-align:left}[dir=rtl] .inv-sum{margin:16px auto 0 0}
  @media print{.inv-doc{padding:0}}`;
  function print(data) {
    const w = window.open('', '_blank');
    if (!w) return alert(T('Allow pop-ups for this site to print the invoice.'));
    w.document.write(`<!doctype html><html lang="${document.documentElement.lang}" dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${esc(T('Invoice'))} ${esc(data.inv.number)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Lora:wght@600&display=swap" rel="stylesheet"><style>${PRINT_CSS}</style></head><body>${doc(data)}
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  }
  window.INV = { doc, print, statusOf, overdue, STATUS };
})();
