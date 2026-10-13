/*
 * Family Budget – UI. Data is kept by a store (js/store.js): this browser
 * only, or, when opened inside Claude, a database shared with the family.
 */
(function () {
  'use strict';

  const C = window.BudgetCore;
  const PREFS_KEY = 'family-budget-prefs';
  const RATE_STALE_DAYS = 14;

  let store = null;
  let state = null;
  let user = null; // Claude `user` capability, when shared
  let downloads = null; // Claude `downloads` capability, when shared
  const people = {}; // id -> first name, for "added by"
  const prefs = loadPrefs();
  const ui = { tab: 'home', month: C.monthKey(C.todayISO()), filter: 'all' };

  const $view = document.getElementById('view');
  const $sheet = document.getElementById('sheet');

  // ---------- per-device preferences ----------

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* not important */ }
  }

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const money = (n, cur, opts) => C.formatMoney(n, cur, opts);
  const usd = (n, opts) => money(n, 'USD', opts);

  function monthLabel(m) {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function dayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function activeWallets() {
    return state.wallets.filter((w) => !w.archived);
  }

  function walletName(id) {
    const w = C.walletById(state, id);
    return w ? w.name : 'Unknown wallet';
  }

  function walletPill(w) {
    if (!w) return '';
    return `<span class="pill ${w.type === 'cash' ? 'cash' : ''}">${esc(w.name)}</span>`;
  }

  function pctBar(value, max) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
    const cls = max > 0 && value > max ? 'over' : max > 0 && value > max * 0.85 ? 'near' : '';
    return `<div class="bar ${cls}"><div style="width:${pct.toFixed(1)}%"></div></div>`;
  }

  function latestRateEntry() {
    return [...state.rates].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  }

  function defaultDateForMonth() {
    const today = C.todayISO();
    if (C.monthKey(today) === ui.month) return today;
    return ui.month < C.monthKey(today) ? `${ui.month}-${C.daysInMonth(ui.month)}` : `${ui.month}-01`;
  }

  function rateText(cur, rate) {
    if (cur === 'USD' || !rate) return '';
    return `1 USD = ${rate.toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${cur}`;
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function download(filename, text, type) {
    if (store && store.shared) {
      if (!downloads) return toast('Downloads are not available here');
      downloads.save({ filename, data: text }).then(
        () => toast('Saved'),
        (err) => { if (!err || err.code !== 'declined') toast('Could not save the file'); }
      );
      return;
    }
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  // In-page confirmation (browser confirm() pop-ups don't work everywhere).
  function askConfirm(message, okLabel) {
    let dlg = document.getElementById('confirm');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'confirm';
      dlg.className = 'sheet confirm';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<form method="dialog"><p class="confirm-msg"></p>
      <div class="btn-row"><button class="btn" value="no" type="submit" style="flex:1">Cancel</button>
      <button class="btn primary danger-fill" value="yes" type="submit" style="flex:1">${esc(okLabel || 'Delete')}</button></div></form>`;
    dlg.querySelector('.confirm-msg').textContent = message;
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
      dlg.showModal();
    });
  }

  function firstName(id) {
    if (!id) return '';
    if (store.meId && id === store.meId) return 'you';
    return people[id] || '';
  }

  // Look up names of whoever added entries; re-render once if any changed.
  function resolvePeople() {
    if (!user || !store.shared) return;
    const ids = [...new Set(state.transactions.map((t) => t.createdBy).filter(Boolean))];
    if (!ids.length) return;
    user.profiles(ids).then((ps) => {
      let changed = false;
      for (const id of ids) {
        const n = ((ps[id] && ps[id].name) || '').split(' ')[0];
        if (n && people[id] !== n) { people[id] = n; changed = true; }
      }
      if (changed) render();
    });
  }

  // ---------- rendering ----------

  function render() {
    if (!store || !store.ready) {
      $view.innerHTML = `<div class="empty">Loading your budget…</div>`;
      return;
    }
    document.getElementById('month-label').textContent = monthLabel(ui.month);
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const views = { home: viewHome, txns: viewTransactions, fixed: viewFixed, budget: viewBudget, settings: viewSettings };
    $view.innerHTML = (views[ui.tab] || viewHome)();
    resolvePeople();
  }

  function rateWarning() {
    const latest = latestRateEntry();
    const age = latest ? daysBetween(latest.date, C.todayISO()) : Infinity;
    if (latest && latest.source !== 'default' && age <= RATE_STALE_DAYS) return '';
    const why = !latest || latest.source === 'default'
      ? 'The exchange rates are placeholders.'
      : `Exchange rates were last updated ${age} days ago.`;
    return `<div class="alert">${why} Update them so your totals in USD are accurate.
      <div class="btn-row"><button class="btn small primary" data-action="goto-rates">Update rates</button></div></div>`;
  }

  function viewHome() {
    const report = C.budgetReport(state, ui.month);
    const sum = report.summary;
    const today = C.todayISO();
    const status = C.recurringStatus(state, ui.month, today);
    const paidCount = status.filter((s) => s.paid).length;
    const needs = C.cashNeeds(state, ui.month, today);
    const left = report.totalBudget - sum.spent;

    let html = rateWarning();

    if (state.transactions.length === 0) {
      html += `<div class="card"><h2>Getting started</h2>
        <ol class="small">
          <li>Check your <b>wallets</b> (USD cash, GBP card, ZAR card…) in Settings and add opening balances if you want to track how much cash is in the house.</li>
          <li>Set today's <b>exchange rates</b>.</li>
          <li>Check your <b>regular costs</b> (wages, school fees, WiFi, DStv…) under “Regular” – change the amount, wallet or due day if needed.</li>
          <li>Tap <b>+</b> whenever you pay for something. Pick the wallet and category – the app converts everything to USD for you.</li>
        </ol></div>`;
    }

    html += `<div class="stats">
      <div class="stat"><div class="label">Spent (USD)</div><div class="value num">${usd(sum.spent)}</div>
        <div class="small muted">${sum.count} payment${sum.count === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Budget left</div><div class="value num ${left < 0 ? 'danger' : ''}">${report.totalBudget ? usd(left) : '—'}</div>
        <div class="small muted">${report.totalBudget ? 'of ' + usd(report.totalBudget, { whole: true }) : 'No budget set'}</div></div>
      <div class="stat"><div class="label">Paid in cash</div><div class="value num">${usd(sum.byPaymentType.cash || 0)}</div>
        <div class="small muted">${sum.spent ? Math.round(((sum.byPaymentType.cash || 0) / sum.spent) * 100) + '% of spending' : '&nbsp;'}</div></div>
    </div><div style="height:14px"></div>`;

    // Cash planning
    const needRows = needs.filter((n) => n.due > 0);
    if (needRows.length) {
      html += `<div class="card"><h2>Still to pay this month <small>fixed costs</small></h2><ul class="rows">`;
      for (const n of needRows) {
        const w = C.walletById(state, n.walletId);
        const cur = w ? w.currency : 'USD';
        html += `<li><div class="grow"><div class="title">${esc(walletName(n.walletId))}</div>
          <div class="small muted">Balance ${money(n.balance, cur)}${n.shortfall > 0 ? ` · <b class="danger">need ${money(n.shortfall, cur)} more</b>` : ' · <span class="ok">covered</span>'}</div></div>
          <div class="num right"><b>${money(n.due, cur)}</b></div></li>`;
      }
      html += `</ul></div>`;
    }

    // Upcoming fixed costs
    if (status.length) {
      const unpaid = status.filter((s) => !s.paid);
      html += `<div class="card"><h2>Regular costs <small>${paidCount} of ${status.length} paid</small></h2>`;
      if (unpaid.length === 0) html += `<div class="small ok">All regular costs paid for ${esc(monthLabel(ui.month))} 🎉</div>`;
      else html += `<ul class="rows">${unpaid.slice(0, 5).map(recurringRow).join('')}</ul>`;
      if (unpaid.length > 5) html += `<button class="btn small" data-tab="fixed">See all ${unpaid.length} unpaid</button>`;
      html += `</div>`;
    }

    // By currency / wallet
    const walletIds = Object.keys(sum.byWallet);
    if (walletIds.length) {
      html += `<div class="card"><h2>How you paid <small>native → USD</small></h2><table class="simple"><thead><tr><th>Wallet</th><th class="num">Spent</th><th class="num">≈ USD</th></tr></thead><tbody>`;
      walletIds
        .sort((a, b) => sum.byWallet[b].usd - sum.byWallet[a].usd)
        .forEach((id) => {
          const w = C.walletById(state, id);
          const v = sum.byWallet[id];
          html += `<tr><td>${walletPill(w) || esc(id)}</td><td class="num">${money(v.native, w ? w.currency : 'USD')}</td><td class="num">${usd(v.usd)}</td></tr>`;
        });
      html += `</tbody></table>`;
      const cash = sum.byPaymentType.cash || 0;
      if (sum.spent > 0) {
        const pct = Math.round((cash / sum.spent) * 100);
        html += `<div class="small muted" style="margin-top:10px">Cash: <b>${usd(cash)}</b> (${pct}%) · Card &amp; other: <b>${usd(sum.spent - cash)}</b> (${100 - pct}%)</div>`;
      }
      html += `</div>`;
    }

    // Categories
    const catRows = report.rows.filter((r) => r.spent > 0 || r.budget > 0).sort((a, b) => b.spent - a.spent);
    if (catRows.length) {
      html += `<div class="card"><h2>Where it went <small>USD</small></h2><ul class="rows">`;
      for (const r of catRows) {
        html += `<li><div class="icon">${esc(r.category.icon)}</div><div class="grow">
          <div style="display:flex;justify-content:space-between;gap:8px"><span class="title">${esc(r.category.name)}</span>
          <span class="num">${usd(r.spent)}${r.budget ? ` <span class="muted small">/ ${usd(r.budget, { whole: true })}</span>` : ''}</span></div>
          ${r.budget ? pctBar(r.spent, r.budget) : ''}</div></li>`;
      }
      html += `</ul></div>`;
    }

    // Balances
    html += `<div class="card"><h2>Wallet balances <small>tracked in the app</small></h2><ul class="rows">`;
    let totalUsd = 0;
    for (const w of activeWallets()) {
      const bal = C.walletBalance(state, w.id);
      const balUsd = C.toBase(state, bal, w.currency, C.todayISO());
      totalUsd += balUsd;
      html += `<li><div class="grow"><div class="title">${esc(w.name)}</div><div class="small muted">${esc(C.WALLET_TYPES[w.type] || w.type)} · ${esc(w.currency)}</div></div>
        <div class="right num"><b class="${bal < 0 ? 'danger' : ''}">${money(bal, w.currency)}</b>${w.currency !== 'USD' ? `<div class="small muted">≈ ${usd(balUsd)}</div>` : ''}</div></li>`;
    }
    html += `</ul><div class="small muted" style="margin-top:6px">Total ≈ <b>${usd(totalUsd)}</b>. Balances are only right if you set opening balances in Settings and record withdrawals/exchanges with “Move money”.</div></div>`;

    return html;
  }

  function recurringRow(s) {
    const w = C.walletById(state, s.item.walletId);
    const cur = w ? w.currency : 'USD';
    const cat = C.categoryById(state, s.item.categoryId);
    const tag = s.paid
      ? `<span class="pill paid">Paid</span>`
      : s.overdue
        ? `<span class="pill overdue">Due ${esc(dayLabel(s.dueDate))}</span>`
        : `<span class="pill">Due ${esc(dayLabel(s.dueDate))}</span>`;
    const paidAmt = s.payments.reduce((a, t) => a + t.amount, 0);
    return `<li><div class="icon">${esc(cat.icon)}</div><div class="grow">
        <div class="title">${esc(s.item.name)}</div>
        <div class="small muted">${walletPill(w)} ${tag}${C.isMonthly(s.item) ? '' : ' <span class="pill">' + esc(C.frequencyLabel(s.item).split(' (')[0]) + '</span>'}</div></div>
      <div class="right"><div class="num"><b>${money(s.paid ? paidAmt : s.item.amount, cur)}</b></div>
        ${cur !== 'USD' ? `<div class="small muted num">≈ ${usd(s.expectedUsd)}</div>` : ''}
        ${s.paid ? '' : `<button class="btn small primary" data-action="pay-recurring" data-id="${esc(s.item.id)}" style="margin-top:4px">Pay</button>`}</div></li>`;
  }

  function viewTransactions() {
    let list = C.transactionsInMonth(state, ui.month);
    const f = ui.filter;
    if (f === 'cash' || f === 'card') {
      list = list.filter((t) => {
        const w = C.walletById(state, t.walletId);
        return t.type === 'expense' && w && (f === 'cash' ? w.type === 'cash' : w.type !== 'cash');
      });
    } else if (f === 'income' || f === 'transfer' || f === 'expense') {
      list = list.filter((t) => t.type === f);
    } else if (f.startsWith('cur:')) {
      const cur = f.slice(4);
      list = list.filter((t) => C.txnCurrency(state, t) === cur);
    }

    const filters = [
      ['all', 'All'], ['expense', 'Spending'], ['cash', 'Cash'], ['card', 'Card'],
      ['cur:USD', 'USD'], ['cur:GBP', 'GBP'], ['cur:ZAR', 'ZAR'], ['transfer', 'Moves'],
    ];
    let html = `<div class="card"><div class="chips">${filters
      .map(([k, l]) => `<label><input type="radio" name="txn-filter" value="${k}" ${ui.filter === k ? 'checked' : ''}>${l}</label>`)
      .join('')}</div></div>`;

    if (list.length === 0) {
      return html + `<div class="empty">Nothing recorded for ${esc(monthLabel(ui.month))} yet.<br>Tap <b>+</b> to add a payment.</div>`;
    }

    let total = 0;
    let currentDay = null;
    html += `<div class="card"><ul class="rows">`;
    for (const t of list) {
      if (t.date !== currentDay) {
        currentDay = t.date;
        html += `<li class="small muted" style="padding-top:14px"><b>${esc(dayLabel(t.date))}</b></li>`;
      }
      html += txnRow(t);
      if (t.type === 'expense') total += C.txnBase(state, t);
    }
    html += `</ul></div>`;
    html += `<div class="small muted" style="text-align:center">Spending shown: <b>${usd(total)}</b></div>
      <div class="btn-row" style="justify-content:center"><button class="btn small" data-action="export-csv-month">Export ${esc(monthLabel(ui.month))} as CSV</button></div>`;
    return html;
  }

  function txnRow(t) {
    const w = C.walletById(state, t.walletId);
    const cur = w ? w.currency : 'USD';
    if (t.type === 'transfer') {
      const to = C.walletById(state, t.toWalletId);
      const toCur = to ? to.currency : 'USD';
      let rateInfo = '';
      if (cur !== toCur && t.amount > 0) {
        const r = t.toAmount / t.amount;
        rateInfo = ` · 1 ${cur} = ${r.toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${toCur}`;
      }
      return `<li class="clickable" data-action="edit-txn" data-id="${esc(t.id)}"><div class="icon">🔁</div><div class="grow">
        <div class="title">${esc(t.note || 'Moved money')}</div>
        <div class="small muted">${walletPill(w)} → ${walletPill(to)}${esc(rateInfo)}</div></div>
        <div class="right num"><div>${money(t.amount, cur)}</div>${cur !== toCur ? `<div class="small muted">→ ${money(t.toAmount, toCur)}</div>` : ''}</div></li>`;
    }
    const cat = C.categoryById(state, t.categoryId);
    const base = C.txnBase(state, t);
    const sign = t.type === 'income' ? '+' : '';
    return `<li class="clickable" data-action="edit-txn" data-id="${esc(t.id)}"><div class="icon">${esc(cat.icon)}</div><div class="grow">
      <div class="title">${esc(t.note || cat.name)}</div>
      <div class="small muted">${t.note ? esc(cat.name) + ' · ' : ''}${walletPill(w)}${t.recurringId ? ' <span class="pill">regular</span>' : ''}${t.forMonth && t.forMonth !== C.monthKey(t.date) ? ` <span class="pill">for ${esc(monthLabel(t.forMonth).split(' ')[0])}</span>` : ''}${firstName(t.createdBy) ? ' · ' + esc(firstName(t.createdBy)) : ''}</div></div>
      <div class="right num"><div class="${t.type === 'income' ? 'ok' : ''}"><b>${sign}${money(t.amount, cur)}</b></div>
      ${cur !== 'USD' ? `<div class="small muted">≈ ${usd(base)}</div>` : ''}</div></li>`;
  }

  function viewFixed() {
    const status = C.recurringStatus(state, ui.month, C.todayISO());
    const inactive = state.recurring.filter((r) => r.active === false);
    let html = `<div class="card"><h2>Due in ${esc(monthLabel(ui.month))}</h2>
      <p class="small muted" style="margin-top:0">Regular payments – staff wages, WiFi, subscriptions, and termly ones like school fees. Tap <b>Pay</b> when you pay one: it's recorded with the right wallet and category, and you can change the amount if it was different this time.</p>`;
    if (status.length === 0) {
      html += `<div class="empty">Nothing due this month.</div>`;
    } else {
      html += `<ul class="rows">${status.map(recurringRow).join('')}</ul>`;
    }
    html += `<div class="btn-row"><button class="btn primary" data-action="add-recurring">+ Add regular cost</button></div></div>`;

    if (state.recurring.length) {
      const year = C.annualFixed(state);
      html += `<div class="card"><h2>Over a year <small>at today's rates</small></h2>
        <div class="stats two">
          <div class="stat"><div class="label">Per year</div><div class="value num">${usd(year.total, { whole: true })}</div></div>
          <div class="stat"><div class="label">Average / month</div><div class="value num">${usd(year.monthlyAverage, { whole: true })}</div></div>
        </div>
        <div class="small muted" style="margin-top:8px">Termly and yearly costs only show up in the months they're due. The average tells you how much to put aside each month to cover them.</div></div>`;
    }

    if (status.length) {
      // totals per wallet
      const perWallet = {};
      let totalUsd = 0;
      for (const s of status) {
        perWallet[s.item.walletId] = (perWallet[s.item.walletId] || 0) + Number(s.item.amount);
        totalUsd += s.expectedUsd;
      }
      html += `<div class="card"><h2>Due this month by wallet <small>≈ ${usd(totalUsd)}</small></h2><table class="simple"><tbody>`;
      for (const id of Object.keys(perWallet)) {
        const w = C.walletById(state, id);
        html += `<tr><td>${walletPill(w)}</td><td class="num">${money(perWallet[id], w ? w.currency : 'USD')}</td></tr>`;
      }
      html += `</tbody></table><div class="small muted" style="margin-top:8px">Useful for knowing how much cash to draw and how much to keep in each card account.</div></div>`;
    }

    if (state.recurring.length) {
      html += `<div class="card"><h2>All regular costs</h2><ul class="rows">`;
      for (const r of [...state.recurring].sort((a, b) => a.name.localeCompare(b.name))) {
        const w = C.walletById(state, r.walletId);
        html += `<li class="clickable" data-action="edit-recurring" data-id="${esc(r.id)}"><div class="icon">${esc(C.categoryById(state, r.categoryId).icon)}</div>
          <div class="grow"><div class="title">${esc(r.name)}${r.active === false ? ' <span class="pill">paused</span>' : ''}</div>
          <div class="small muted">${esc(C.frequencyLabel(r))} · day ${esc(r.dayOfMonth)} · ${esc(w ? w.name : '')}</div></div>
          <div class="num">${money(r.amount, w ? w.currency : 'USD')}</div></li>`;
      }
      html += `</ul></div>`;
    } else if (inactive.length) {
      html += `<div class="small muted">${inactive.length} paused item(s) – they appear in the list above once reactivated.</div>`;
    }
    return html;
  }

  function viewBudget() {
    const report = C.budgetReport(state, ui.month);
    let html = `<div class="card"><h2>Monthly budget <small>in USD</small></h2>
      <p class="small muted" style="margin-top:0">Set how much you want to spend each month per category, in USD. Spending in any currency counts against it at the exchange rate of the day. “Fixed” is what your regular costs in that category add up to this month. Termly costs like school fees are added to the budget automatically in the months they're due.</p>
      <table class="simple"><thead><tr><th>Category</th><th class="num">Fixed</th><th class="num">Budget</th><th class="num">Spent</th></tr></thead><tbody>`;
    for (const r of report.rows) {
      const notes = [];
      if (r.regular) notes.push(`≈ ${usd(r.regular * 12 / 52, { whole: true })}/week`);
      if (r.seasonal) notes.push(`+ ${usd(r.seasonal, { whole: true })} due this month`);
      if (r.isFund) notes.push(r.carried >= 0 ? `fund: + ${usd(r.carried, { whole: true })} saved up` : `fund: − ${usd(-r.carried, { whole: true })} overspent earlier`);
      html += `<tr><td>${esc(r.category.icon)} ${esc(r.category.name)}${notes.length ? `<div class="small muted">${notes.join(' · ')}</div>` : ''}${r.budget ? pctBar(r.spent, r.budget) : ''}</td>
        <td class="num muted">${r.fixed ? usd(r.fixed, { whole: true }) : ''}</td>
        <td class="num"><input class="budget-input" inputmode="decimal" data-budget="${esc(r.category.id)}" value="${r.regular || ''}" placeholder="0" aria-label="Budget for ${esc(r.category.name)}"></td>
        <td class="num ${r.budget && r.spent > r.budget ? 'danger' : ''}">${r.spent ? usd(r.spent, { whole: true }) : ''}</td></tr>`;
    }
    const totalFixed = report.rows.reduce((a, r) => a + r.fixed, 0);
    html += `<tr><td><b>Total</b></td><td class="num"><b>${usd(totalFixed, { whole: true })}</b></td><td class="num"><b>${usd(report.totalBudget, { whole: true })}</b>${report.totalBudget !== report.rows.reduce((a, r) => a + r.regular, 0) ? '<div class="small muted">incl. termly</div>' : ''}</td><td class="num"><b>${usd(report.totalSpent, { whole: true })}</b></td></tr>`;
    html += `</tbody></table>
      <div class="btn-row"><button class="btn small" data-action="budget-from-fixed">Fill empty budgets from fixed costs</button>
      <button class="btn small" data-action="budget-from-last">Use last month's spending</button></div></div>`;
    return html;
  }

  function viewSettings() {
    const latest = latestRateEntry();
    const rates = C.latestRates(state);
    let html = `<div class="card" id="rates-card"><h2>Exchange rates <small>${latest ? 'last set ' + esc(dayLabel(latest.date)) : ''}</small></h2>
      <form id="rates-form">
      <div class="field"><label for="rate-date">Rates from</label><input type="date" id="rate-date" name="date" value="${C.todayISO()}" required></div>`;
    for (const code of Object.keys(C.CURRENCIES)) {
      if (code === 'USD') continue;
      const r = rates[code];
      html += `<div class="field"><label for="rate-${code}">1 USD = ? ${code} <span class="muted">(${esc(C.CURRENCIES[code].name)})</span></label>
        <input id="rate-${code}" name="${code}" inputmode="decimal" value="${r || ''}" data-rate-input="${code}">
        <div class="hint"><span data-rate-hint="${code}">${r ? `1 ${code} = ${usd(1 / r)}` : ''}</span>
          <a class="xe-link" href="https://www.xe.com/currencyconverter/convert/?Amount=1&amp;From=USD&amp;To=${code}" target="_blank" rel="noopener">Check on XE ↗</a></div></div>`;
    }
    html += `<div class="btn-row"><button class="btn primary" type="submit">Save rates</button>
      ${store.shared ? '' : '<button class="btn" type="button" data-action="fetch-rates">Fetch GBP &amp; ZAR online</button>'}</div>
      <div class="hint small muted" style="margin-top:8px">Older payments keep using the rate that applied on their date. For a payment where the bank charged a different rate, enter the actual USD value on that payment.</div>
      </form>`;
    const history = [...state.rates].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    if (history.length > 1) {
      html += `<details style="margin-top:12px"><summary>Rate history</summary><table class="simple"><thead><tr><th>Date</th>${Object.keys(C.CURRENCIES)
        .filter((c) => c !== 'USD').map((c) => `<th class="num">${c}</th>`).join('')}<th></th></tr></thead><tbody>`;
      for (const r of history) {
        html += `<tr><td>${esc(r.date)}</td>${Object.keys(C.CURRENCIES).filter((c) => c !== 'USD')
          .map((c) => `<td class="num">${r.perUSD[c] || '—'}</td>`).join('')}
          <td class="right"><button class="btn small danger" data-action="delete-rate" data-date="${esc(r.date)}" aria-label="Delete">✕</button></td></tr>`;
      }
      html += `</tbody></table></details>`;
    }
    html += `</div>`;

    html += `<div class="card"><h2>Wallets <small>how you pay</small></h2><ul class="rows">`;
    for (const w of state.wallets) {
      html += `<li class="clickable" data-action="edit-wallet" data-id="${esc(w.id)}"><div class="grow"><div class="title">${esc(w.name)}${w.archived ? ' <span class="pill">hidden</span>' : ''}</div>
        <div class="small muted">${esc(C.WALLET_TYPES[w.type] || w.type)} · ${esc(w.currency)}</div></div>
        <div class="num">${money(C.walletBalance(state, w.id), w.currency)}</div></li>`;
    }
    html += `</ul><div class="btn-row"><button class="btn" data-action="add-wallet">+ Add wallet</button></div></div>`;

    html += `<div class="card"><h2>Categories</h2><div class="chips">${state.categories
      .map((c) => `<button class="btn small" data-action="edit-category" data-id="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</button>`)
      .join('')}</div><div class="btn-row"><button class="btn" data-action="add-category">+ Add category</button></div></div>`;

    if (store.shared) {
      html += `<div class="card"><h2>Sharing &amp; backup</h2>
        <p class="small muted" style="margin-top:0">This budget is shared. Anything either of you adds or changes shows up on the other's phone straight away.</p>
        <div class="btn-row">
          <button class="btn" data-action="export-json">Download backup</button>
          <button class="btn" data-action="export-csv-all">Export all as CSV</button>
        </div></div>`;
    } else {
      html += `<div class="card"><h2>Backup &amp; sharing</h2>
        <p class="small muted" style="margin-top:0">Your data is stored only on this device. Download a backup regularly. To move data to another phone, download a backup here and restore it there.</p>
        <div class="btn-row">
          <button class="btn" data-action="export-json">Download backup</button>
          <button class="btn" data-action="import-json">Restore backup</button>
          <button class="btn" data-action="export-csv-all">Export all as CSV</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <div class="btn-row"><button class="btn danger small" data-action="reset">Erase everything</button></div></div>`;
    }
    return html;
  }

  // ---------- sheets (forms) ----------

  let sheetSubmit = null;

  function openSheet(title, body, onSubmit, footer) {
    $sheet.innerHTML = `<form novalidate><h3>${esc(title)}<button type="button" class="close" data-action="close-sheet" aria-label="Close">×</button></h3>
      ${body}<div class="btn-row">${footer || ''}<button class="btn primary" type="submit" style="flex:1">Save</button></div></form>`;
    sheetSubmit = onSubmit;
    if (!$sheet.open) $sheet.showModal();
    return $sheet.querySelector('form');
  }

  function closeSheet() {
    sheetSubmit = null;
    if ($sheet.open) $sheet.close();
  }

  function parseAmount(v) {
    const n = parseFloat(String(v || '').replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? C.round2(n) : 0;
  }

  function walletChips(name, selected, wallets) {
    return `<div class="chips">${wallets
      .map((w) => `<label><input type="radio" name="${name}" value="${esc(w.id)}" ${w.id === selected ? 'checked' : ''}>${esc(w.name)}</label>`)
      .join('')}</div>`;
  }

  function categoryChips(name, list, selected) {
    return `<div class="chips">${list
      .map((c) => `<label><input type="radio" name="${name}" value="${esc(c.id)}" ${c.id === selected ? 'checked' : ''}>${esc(c.icon)} ${esc(c.name)}</label>`)
      .join('')}</div>`;
  }

  function openTxnSheet(existing, prefill) {
    const t = existing || Object.assign({ type: 'expense', date: defaultDateForMonth() }, prefill || {});
    const wallets = activeWallets();
    const walletId = t.walletId || prefs.lastWallet || (wallets[0] && wallets[0].id);
    const usdOverride = t.rate > 0 ? C.round2(t.amount / t.rate) : '';
    const body = `
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="type" value="expense" ${t.type === 'expense' ? 'checked' : ''}>Spent</label>
        ${t.type === 'income' ? `<label><input type="radio" name="type" value="income" checked>Received</label>` : ''}
        <label><input type="radio" name="type" value="transfer" ${t.type === 'transfer' ? 'checked' : ''}>Move / exchange</label>
      </div>
      <div class="field"><div class="label" data-wallet-label>Paid with</div>${walletChips('walletId', walletId, existing ? state.wallets : wallets)}</div>
      <div class="field"><label for="amt">Amount</label>
        <div class="amount-input"><span class="sym" data-sym></span><input id="amt" name="amount" inputmode="decimal" autocomplete="off" value="${t.amount || ''}" placeholder="0.00"></div>
        <div class="hint" data-preview></div></div>

      <div data-section="expense" class="field"><div class="label">Category</div>${categoryChips('expCat', state.categories, t.type === 'expense' ? t.categoryId || prefs.lastCategory : prefs.lastCategory)}</div>
      <div data-section="income" class="field"><div class="label">Category</div>${categoryChips('incCat', state.incomeCategories, t.type === 'income' ? t.categoryId : 'salary')}</div>

      <div data-section="transfer">
        <div class="field"><div class="label">Into</div>${walletChips('toWalletId', t.toWalletId, existing ? state.wallets : wallets)}</div>
        <div class="field"><label for="toAmt">Amount received <span data-to-cur></span></label>
          <input id="toAmt" name="toAmount" inputmode="decimal" value="${t.toAmount || ''}" placeholder="0.00">
          <div class="hint" data-transfer-hint>Use this for drawing cash from a card, or buying rand/dollars with another currency.</div></div>
      </div>

      <div class="grid2">
        <div class="field"><label for="date">Date</label><input type="date" id="date" name="date" value="${esc(t.date)}" required></div>
        <div class="field"><label for="note">Description</label><input id="note" name="note" value="${esc(t.note || '')}" placeholder="e.g. Plumber, Makro"></div>
      </div>

      <details data-section="rate" ${usdOverride ? 'open' : ''}><summary>Different exchange rate?</summary>
        <div class="field"><label for="usdv">Actual value in USD</label>
          <input id="usdv" name="usdValue" inputmode="decimal" value="${usdOverride}" placeholder="Leave blank to use the day's rate">
          <div class="hint">If your statement shows a different USD amount (bank rate, fees), enter it here.</div></div>
      </details>
      <input type="hidden" name="recurringId" value="${esc(t.recurringId || '')}">
      <input type="hidden" name="forMonth" value="${esc(t.forMonth || '')}">`;

    const footer = existing ? `<button class="btn danger" type="button" data-action="delete-txn" data-id="${esc(existing.id)}">Delete</button>` : '';
    const by = existing && firstName(existing.createdBy);
    const form = openSheet(existing ? (by ? `Added by ${by}` : 'Edit entry') : 'Add entry', body, (fd) => saveTxn(existing, fd), footer);

    let toAmountTouched = Boolean(existing && existing.type === 'transfer');
    const update = () => {
      const type = form.elements.type.value;
      form.querySelectorAll('[data-section]').forEach((el) => {
        const s = el.dataset.section;
        el.hidden = s === 'rate' ? type === 'transfer' : s !== type;
      });
      form.querySelector('[data-wallet-label]').textContent = type === 'expense' ? 'Paid with' : type === 'income' ? 'Received into' : 'From';
      const w = C.walletById(state, form.elements.walletId.value);
      const cur = w ? w.currency : 'USD';
      form.querySelector('[data-sym]').textContent = (C.CURRENCIES[cur] || { symbol: cur }).symbol.trim();
      const amount = parseAmount(form.elements.amount.value);
      const date = form.elements.date.value || C.todayISO();
      const preview = form.querySelector('[data-preview]');
      if (type !== 'transfer') {
        const ov = parseAmount(form.elements.usdValue.value);
        if (cur === 'USD' || !amount) preview.textContent = '';
        else if (ov > 0) preview.textContent = `= ${usd(ov)} (your rate: ${rateText(cur, amount / ov)})`;
        else preview.textContent = `≈ ${usd(C.toBase(state, amount, cur, date))} at ${rateText(cur, C.rateOn(state, cur, date))}`;
      } else {
        preview.textContent = '';
        const to = C.walletById(state, form.elements.toWalletId.value);
        const toCur = to ? to.currency : null;
        form.querySelector('[data-to-cur]').textContent = toCur ? `(${toCur})` : '';
        if (to && !toAmountTouched && amount) {
          const inUsd = C.toBase(state, amount, cur, date);
          form.elements.toAmount.value = toCur === cur ? amount : C.round2(inUsd * C.rateOn(state, toCur, date));
        }
        const toAmount = parseAmount(form.elements.toAmount.value);
        const hint = form.querySelector('[data-transfer-hint]');
        if (to && toCur !== cur && amount && toAmount) hint.textContent = `You got 1 ${cur} = ${(toAmount / amount).toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${toCur}. Adjust “Amount received” to what you actually got.`;
      }
    };
    // Picking a category selects the wallet it's usually paid with, unless
    // a wallet has already been chosen by hand.
    let walletTouched = Boolean(existing || (prefill && prefill.walletId));
    form.addEventListener('change', (e) => {
      if (e.target.name === 'walletId') walletTouched = true;
      if ((e.target.name === 'expCat' || e.target.name === 'incCat') && !walletTouched) {
        const cat = C.categoryById(state, e.target.value);
        const radio = cat.walletId && form.querySelector(`input[name="walletId"][value="${CSS.escape(cat.walletId)}"]`);
        if (radio) radio.checked = true;
      }
    });
    form.addEventListener('input', (e) => {
      if (e.target.name === 'toAmount') toAmountTouched = true;
      update();
    });
    form.addEventListener('change', update);
    update();
    if (!existing) setTimeout(() => form.elements.amount.focus(), 50);
  }

  function saveTxn(existing, fd) {
    const type = fd.get('type');
    const amount = parseAmount(fd.get('amount'));
    const walletId = fd.get('walletId');
    const date = fd.get('date');
    if (!walletId) return 'Choose a wallet';
    if (!(amount > 0)) return 'Enter an amount';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Choose a date';

    const t = existing ? { ...existing } : { id: C.uid(), createdAt: Date.now() };
    if (!existing && store.meId) t.createdBy = store.meId;
    t.type = type;
    t.amount = amount;
    t.walletId = walletId;
    t.date = date;
    t.note = String(fd.get('note') || '').trim();
    delete t.rate;
    delete t.toWalletId;
    delete t.toAmount;
    delete t.categoryId;

    if (type === 'transfer') {
      const toWalletId = fd.get('toWalletId');
      const toAmount = parseAmount(fd.get('toAmount'));
      if (!toWalletId) return 'Choose where the money went';
      if (toWalletId === walletId) return 'Choose two different wallets';
      if (!(toAmount > 0)) return 'Enter the amount received';
      t.toWalletId = toWalletId;
      t.toAmount = toAmount;
      delete t.recurringId;
    } else {
      const cat = fd.get(type === 'expense' ? 'expCat' : 'incCat');
      if (!cat) return 'Choose a category';
      t.categoryId = cat;
      const usdValue = parseAmount(fd.get('usdValue'));
      const w = C.walletById(state, walletId);
      if (usdValue > 0 && w && w.currency !== 'USD') t.rate = amount / usdValue;
      const rid = fd.get('recurringId');
      if (rid && type === 'expense') t.recurringId = rid;
      else delete t.recurringId;
      // Paying a bill late (or early): remember which month's bill it was.
      const forMonth = fd.get('forMonth');
      if (t.recurringId && forMonth && forMonth !== C.monthKey(date)) t.forMonth = forMonth;
      else delete t.forMonth;
      if (type === 'expense') prefs.lastCategory = cat;
    }
    prefs.lastWallet = walletId;
    savePrefs();
    store.putTxn(t);
    if (C.monthKey(date) !== ui.month) ui.month = C.monthKey(date);
    toast(existing ? 'Updated' : 'Saved');
    return null;
  }

  function openRecurringSheet(existing) {
    const r = existing || { dayOfMonth: 1, walletId: 'usd_cash', categoryId: 'staff', active: true };
    const wallets = existing ? state.wallets : activeWallets();
    const body = `
      <div class="field"><label for="rn">Name</label><input id="rn" name="name" value="${esc(r.name || '')}" placeholder="e.g. Maid wages, School fees" required></div>
      <div class="grid2">
        <div class="field"><label for="ra">Usual amount</label><input id="ra" name="amount" inputmode="decimal" value="${r.amount || ''}" placeholder="0.00"></div>
        <div class="field"><label for="rd">Day of month</label><input id="rd" name="dayOfMonth" type="number" min="1" max="31" value="${esc(r.dayOfMonth)}"></div>
      </div>
      <div class="field"><div class="label">Paid with</div>${walletChips('walletId', r.walletId, wallets)}</div>
      <div class="field"><label for="rc">Category</label><select id="rc" name="categoryId">${state.categories
        .map((c) => `<option value="${esc(c.id)}" ${c.id === r.categoryId ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rf">How often</label><select id="rf" name="frequency">
        <option value="monthly" ${C.isMonthly(r) ? 'selected' : ''}>Every month</option>
        <option value="months" ${C.isMonthly(r) ? '' : 'selected'}>Only in some months (termly, yearly…)</option></select></div>
      <div class="field" data-months ${C.isMonthly(r) ? 'hidden' : ''}><div class="label">Due in</div><div class="chips">${C.MONTH_NAMES
        .map((m, i) => `<label><input type="checkbox" name="months" value="${i + 1}" ${(r.months || [1, 5, 9]).includes(i + 1) ? 'checked' : ''}>${m}</label>`).join('')}</div>
        <div class="hint">School terms usually start in Jan, May and Sep.</div></div>
      <div class="field"><label><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}> Active (uncheck to pause)</label></div>`;
    const footer = existing ? `<button class="btn danger" type="button" data-action="delete-recurring" data-id="${esc(existing.id)}">Delete</button>` : '';
    const form = openSheet(existing ? 'Edit regular cost' : 'New regular cost', body, (fd) => {
      const name = String(fd.get('name') || '').trim();
      const amount = parseAmount(fd.get('amount'));
      const walletId = fd.get('walletId');
      const months = fd.get('frequency') === 'months' ? fd.getAll('months').map(Number) : [];
      if (!name) return 'Enter a name';
      if (!(amount > 0)) return 'Enter an amount';
      if (!walletId) return 'Choose a wallet';
      if (fd.get('frequency') === 'months' && months.length === 0) return 'Choose at least one month';
      const item = existing ? { ...existing } : { id: C.uid() };
      Object.assign(item, {
        name,
        amount,
        walletId,
        categoryId: fd.get('categoryId'),
        dayOfMonth: Math.min(31, Math.max(1, parseInt(fd.get('dayOfMonth'), 10) || 1)),
        active: fd.get('active') === 'on',
      });
      if (months.length && months.length < 12) item.months = months;
      else delete item.months;
      store.putRecurring(item);
      toast('Saved');
      return null;
    }, footer);
    form.elements.frequency.addEventListener('change', (e) => {
      form.querySelector('[data-months]').hidden = e.target.value !== 'months';
    });
  }

  function openWalletSheet(existing) {
    const w = existing || { currency: 'USD', type: 'cash', openingBalance: 0 };
    const body = `
      <div class="field"><label for="wn">Name</label><input id="wn" name="name" value="${esc(w.name || '')}" placeholder="e.g. Rand cash for SA trips"></div>
      <div class="grid2">
        <div class="field"><label for="wc">Currency</label><select id="wc" name="currency" ${existing ? 'disabled' : ''}>${Object.keys(C.CURRENCIES)
          .map((c) => `<option ${c === w.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="wt">Type</label><select id="wt" name="type">${Object.entries(C.WALLET_TYPES)
          .map(([k, v]) => `<option value="${k}" ${k === w.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="wo">Opening balance</label><input id="wo" name="openingBalance" inputmode="decimal" value="${w.openingBalance || ''}" placeholder="0">
        <div class="hint">What was in this wallet before you started using the app. Current balance: ${existing ? money(C.walletBalance(state, w.id), w.currency) : '—'}</div></div>
      ${existing ? `<div class="field"><label><input type="checkbox" name="archived" ${w.archived ? 'checked' : ''}> Hide this wallet</label></div>` : ''}`;
    const used = existing && state.transactions.some((t) => t.walletId === existing.id || t.toWalletId === existing.id);
    const footer = existing && !used ? `<button class="btn danger" type="button" data-action="delete-wallet" data-id="${esc(existing.id)}">Delete</button>` : '';
    openSheet(existing ? 'Edit wallet' : 'New wallet', body, (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return 'Enter a name';
      const item = existing ? { ...existing } : { id: C.uid(), currency: fd.get('currency'), archived: false };
      item.name = name;
      item.type = fd.get('type');
      item.openingBalance = parseAmount(fd.get('openingBalance'));
      if (existing) item.archived = fd.get('archived') === 'on';
      store.putWallet(item);
      toast('Saved');
      return null;
    }, footer);
  }

  function openCategorySheet(existing) {
    const c = existing || { icon: '📌' };
    const body = `<div class="grid2" style="grid-template-columns:80px 1fr">
      <div class="field"><label for="ci">Icon</label><input id="ci" name="icon" value="${esc(c.icon)}" maxlength="4"></div>
      <div class="field"><label for="cn">Name</label><input id="cn" name="name" value="${esc(c.name || '')}"></div></div>
      <div class="field"><label for="cw">Usually paid with</label><select id="cw" name="walletId"><option value="">— no default —</option>${activeWallets()
        .map((w) => `<option value="${esc(w.id)}" ${w.id === c.walletId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
        <div class="hint">Picking this category when adding a payment selects this wallet for you.</div></div>`;
    const used = existing && (state.transactions.some((t) => t.categoryId === existing.id) || state.recurring.some((r) => r.categoryId === existing.id));
    const footer = existing && !used ? `<button class="btn danger" type="button" data-action="delete-category" data-id="${esc(existing.id)}">Delete</button>` : '';
    openSheet(existing ? 'Edit category' : 'New category', body, (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return 'Enter a name';
      const item = existing ? { ...existing } : { id: C.uid() };
      item.name = name;
      item.icon = String(fd.get('icon') || '📌').trim() || '📌';
      if (fd.get('walletId')) item.walletId = fd.get('walletId');
      else delete item.walletId;
      store.putCategory(item);
      return null;
    }, footer);
  }

  // ---------- actions ----------

  async function fetchRates() {
    const urls = [
      'https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,ZAR',
      'https://api.frankfurter.app/latest?from=USD&to=GBP,ZAR',
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.rates) continue;
        const form = document.getElementById('rates-form');
        if (!form) return;
        for (const [code, val] of Object.entries(data.rates)) {
          if (form.elements[code]) form.elements[code].value = C.round2(val * 10000) / 10000;
        }
        updateRateHints();
        toast(`Fetched rates from ${data.date || 'today'} – check ZiG, then Save`);
        return;
      } catch (e) { /* try next */ }
    }
    toast('Could not fetch rates – enter them manually');
  }

  function updateRateHints() {
    document.querySelectorAll('[data-rate-input]').forEach((input) => {
      const code = input.dataset.rateInput;
      const v = parseFloat(input.value);
      const hint = document.querySelector(`[data-rate-hint="${code}"]`);
      if (hint) hint.textContent = v > 0 ? `1 ${code} = ${usd(1 / v)}` : '';
    });
  }

  function saveRates(form) {
    const date = form.elements.date.value;
    if (!date) return toast('Choose a date');
    const perUSD = {};
    for (const code of Object.keys(C.CURRENCIES)) {
      if (code === 'USD') continue;
      const v = parseFloat(form.elements[code].value);
      if (v > 0) perUSD[code] = v;
    }
    const existing = state.rates.find((r) => r.date === date && r.source !== 'default');
    store.putRate({ date, perUSD: Object.assign({}, existing && existing.perUSD, perUSD), source: 'manual' });
    toast('Rates saved');
  }

  function setBudgetsFromFixed() {
    const report = C.budgetReport(state, ui.month);
    const patch = {};
    for (const r of report.rows) {
      if (!r.regular && r.fixedMonthly) patch[r.category.id] = Math.ceil(r.fixedMonthly);
    }
    const n = Object.keys(patch).length;
    if (n) store.setBudgets(patch);
    toast(n ? `Filled ${n} budget${n === 1 ? '' : 's'}` : 'Nothing to fill');
  }

  async function setBudgetsFromLastMonth() {
    const last = C.monthSummary(state, C.shiftMonth(ui.month, -1));
    const cats = Object.keys(last.byCategory);
    if (!cats.length) return toast('No spending recorded last month');
    if (!(await askConfirm("Replace budgets with last month's spending, rounded up to the nearest $10?", 'Replace'))) return;
    const patch = {};
    for (const id of cats) patch[id] = Math.ceil(last.byCategory[id] / 10) * 10;
    store.setBudgets(patch);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try {
        data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.wallets)) throw new Error('bad file');
      } catch (e) {
        return toast('That file is not a Family Budget backup');
      }
      if (!(await askConfirm(`Replace everything on this device with the backup (${data.transactions.length} entries)?`, 'Replace'))) return;
      store.replaceAll(data);
      toast('Backup restored');
    };
    reader.readAsText(file);
  }

  const actions = {
    'open-add': () => openTxnSheet(),
    'close-sheet': closeSheet,
    'month-prev': () => { ui.month = C.shiftMonth(ui.month, -1); render(); },
    'month-next': () => { ui.month = C.shiftMonth(ui.month, 1); render(); },
    'goto-rates': () => { ui.tab = 'settings'; render(); document.getElementById('rates-card').scrollIntoView(); },
    'edit-txn': (el) => openTxnSheet(state.transactions.find((t) => t.id === el.dataset.id)),
    'delete-txn': async (el) => {
      if (!(await askConfirm('Delete this entry?'))) return;
      store.deleteTxn(el.dataset.id);
      closeSheet(); toast('Deleted');
    },
    'pay-recurring': (el) => {
      const r = state.recurring.find((x) => x.id === el.dataset.id);
      if (!r) return;
      const status = C.recurringStatus(state, ui.month).find((s) => s.item.id === r.id);
      const today = C.todayISO();
      // A past month's bill being paid now is a late payment: dated today,
      // counted against the month it was for.
      const late = ui.month < C.monthKey(today);
      openTxnSheet(null, {
        type: 'expense', amount: r.amount, walletId: r.walletId, categoryId: r.categoryId, note: r.name, recurringId: r.id,
        forMonth: ui.month,
        date: C.monthKey(today) === ui.month || late ? today : status ? status.dueDate : defaultDateForMonth(),
      });
    },
    'add-recurring': () => openRecurringSheet(),
    'edit-recurring': (el) => openRecurringSheet(state.recurring.find((r) => r.id === el.dataset.id)),
    'delete-recurring': async (el) => {
      if (!(await askConfirm('Delete this regular cost? Past payments stay recorded.'))) return;
      store.deleteRecurring(el.dataset.id);
      closeSheet();
    },
    'add-wallet': () => openWalletSheet(),
    'edit-wallet': (el) => openWalletSheet(C.walletById(state, el.dataset.id)),
    'delete-wallet': async (el) => {
      if (!(await askConfirm('Delete this wallet?'))) return;
      store.deleteWallet(el.dataset.id);
      closeSheet();
    },
    'add-category': () => openCategorySheet(),
    'edit-category': (el) => openCategorySheet(state.categories.find((c) => c.id === el.dataset.id)),
    'delete-category': async (el) => {
      if (!(await askConfirm('Delete this category?'))) return;
      store.deleteCategory(el.dataset.id);
      closeSheet();
    },
    'fetch-rates': fetchRates,
    'delete-rate': async (el) => {
      if (state.rates.length <= 1) return toast('Keep at least one set of rates');
      if (!(await askConfirm(`Delete the rates from ${el.dataset.date}?`))) return;
      store.deleteRate(el.dataset.date);
    },
    'budget-from-fixed': setBudgetsFromFixed,
    'budget-from-last': setBudgetsFromLastMonth,
    'export-csv-month': () => download(`budget-${ui.month}.csv`, C.toCSV(state, ui.month), 'text/csv'),
    'export-csv-all': () => download(`budget-all-${C.todayISO()}.csv`, C.toCSV(state), 'text/csv'),
    'export-json': () => download(`family-budget-backup-${C.todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json'),
    'import-json': () => document.getElementById('import-file').click(),
    reset: async () => {
      if (!store.replaceAll) return;
      if (!(await askConfirm('Erase all entries, wallets, regular costs and budgets on this device? Your family setup will be loaded again. Download a backup first if unsure.', 'Erase everything'))) return;
      const fresh = C.defaultState();
      C.applySetup(fresh, window.FAMILY_SETUP);
      store.replaceAll(fresh);
      toast('Erased');
    },
  };

  document.addEventListener('click', (e) => {
    if (!store || !store.ready) return;
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      ui.tab = tabBtn.dataset.tab;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) {
      e.preventDefault();
      actions[el.dataset.action](el);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.method === 'dialog') return; // confirm dialog closes itself
    e.preventDefault();
    if (e.target.id === 'rates-form') return saveRates(e.target);
    if (e.target.closest('#sheet') && sheetSubmit) {
      const err = sheetSubmit(new FormData(e.target));
      if (err) return toast(err);
      closeSheet();
      render();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.name === 'txn-filter') {
      ui.filter = e.target.value;
      render();
    } else if (e.target.dataset.budget) {
      store.setBudgets({ [e.target.dataset.budget]: parseAmount(e.target.value) });
    } else if (e.target.id === 'import-file' && e.target.files[0]) {
      importJSON(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.rateInput) updateRateHints();
  });

  // Close the sheet when tapping the backdrop.
  $sheet.addEventListener('click', (e) => {
    if (e.target === $sheet) closeSheet();
  });

  // ---------- start ----------

  function showProblem(message) {
    $view.innerHTML = `<div class="card"><h2>Can't open the shared budget</h2><p class="small">${esc(message)}</p></div>`;
  }

  async function boot() {
    const inClaude = window.claude && typeof window.claude.use === 'function';
    if (!inClaude) {
      store = window.BudgetStore.createLocal(C, window.FAMILY_SETUP);
      // Lets the installed app open without a connection.
      if ('serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    } else {
      render(); // loading state
      const db = await window.claude.use('db');
      if (!db) return showProblem('Make sure you are signed in to Claude, then reload this page.');
      user = await window.claude.use('user');
      downloads = await window.claude.use('downloads');
      const meId = user ? await user.id() : null;
      store = window.BudgetStore.createShared(C, db, meId);
    }
    state = store.state;
    store.onChange(render);
    store.onError(toast);
    render();
    if (store.setupAdded && state.transactions.length) {
      toast(`Added ${store.setupAdded} new item${store.setupAdded === 1 ? '' : 's'} from your family setup`);
    }
  }

  boot();
})();
