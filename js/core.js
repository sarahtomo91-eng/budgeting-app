/*
 * Family Budget – core logic (no DOM).
 *
 * Everything is reported in one base currency (USD). Each transaction is
 * recorded in the currency of the wallet it was paid from and converted to
 * USD using the exchange rate in effect on the transaction date, unless the
 * transaction carries its own rate (e.g. the rate the bank actually charged).
 *
 * Works in the browser (window.BudgetCore) and in Node (require) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'USD';
  const STATE_VERSION = 1;

  const CURRENCIES = {
    USD: { symbol: '$', name: 'US Dollar' },
    GBP: { symbol: '£', name: 'British Pound' },
    ZAR: { symbol: 'R', name: 'South African Rand' },
    ZWG: { symbol: 'ZiG ', name: 'Zimbabwe Gold' },
  };

  const WALLET_TYPES = {
    cash: 'Cash',
    card: 'Card',
    bank: 'Bank transfer',
    mobile: 'Mobile money',
  };

  const DEFAULT_CATEGORIES = [
    { id: 'housing', name: 'Rent & housing', icon: '🏠' },
    { id: 'utilities', name: 'Electricity, water & rates', icon: '💡' },
    { id: 'power_backup', name: 'Generator, solar & gas', icon: '🔋' },
    { id: 'groceries', name: 'Groceries & household', icon: '🛒' },
    { id: 'sa_imports', name: 'South Africa shopping', icon: '🇿🇦' },
    { id: 'import_costs', name: 'Import duty & shipping', icon: '📦' },
    { id: 'staff', name: 'Domestic staff & gardener', icon: '🧹' },
    { id: 'contractors', name: 'Contractors & repairs', icon: '🔧' },
    { id: 'transport', name: 'Car service, repairs & licences', icon: '🚗' },
    { id: 'school', name: 'School fees & education', icon: '🎓' },
    { id: 'medical', name: 'Medical & medical aid', icon: '🩺' },
    { id: 'insurance', name: 'Insurance', icon: '🛡️' },
    { id: 'comms', name: 'Airtime, data & internet', icon: '📱' },
    { id: 'subscriptions', name: 'Subscriptions & TV', icon: '📺' },
    { id: 'kids', name: 'Kids & activities', icon: '🧸' },
    { id: 'eating_out', name: 'Eating out & leisure', icon: '🍽️' },
    { id: 'personal', name: 'Clothing & personal', icon: '👕' },
    { id: 'gifts', name: 'Gifts & donations', icon: '🎁' },
    { id: 'travel', name: 'Travel & holidays', icon: '✈️' },
    { id: 'fees', name: 'Bank & exchange fees', icon: '🏦' },
    { id: 'other', name: 'Other', icon: '📌' },
  ];

  const INCOME_CATEGORIES = [
    { id: 'salary', name: 'Salary', icon: '💼' },
    { id: 'business', name: 'Business / freelance', icon: '🧾' },
    { id: 'other_income', name: 'Other income', icon: '💰' },
  ];

  const DEFAULT_WALLETS = [
    { id: 'usd_cash', name: 'USD cash', currency: 'USD', type: 'cash' },
    { id: 'usd_card', name: 'USD card (local)', currency: 'USD', type: 'card' },
    { id: 'gbp_card', name: 'GBP card', currency: 'GBP', type: 'card' },
    { id: 'zar_card', name: 'ZAR card', currency: 'ZAR', type: 'card' },
    { id: 'zar_cash', name: 'ZAR cash', currency: 'ZAR', type: 'cash' },
  ];

  // Rates are stored as "units of currency per 1 USD" (e.g. ZAR: 17.5).
  // These are placeholders – the app asks the user to update them.
  const DEFAULT_RATES = { GBP: 0.75, ZAR: 17.5, ZWG: 27 };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function todayISO(d) {
    const date = d || new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function monthKey(isoDate) {
    return String(isoDate).slice(0, 7);
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function defaultState(today) {
    return {
      version: STATE_VERSION,
      baseCurrency: BASE,
      wallets: DEFAULT_WALLETS.map((w) => ({ ...w, openingBalance: 0, archived: false })),
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      incomeCategories: INCOME_CATEGORIES.map((c) => ({ ...c })),
      rates: [{ date: todayISO(today), perUSD: { ...DEFAULT_RATES }, source: 'default' }],
      transactions: [],
      recurring: [],
      budgets: {},
      setupApplied: [],
    };
  }

  /** Fill in anything missing from older / imported data. */
  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const s = { ...base, ...raw };
    for (const key of ['wallets', 'categories', 'incomeCategories', 'rates', 'transactions', 'recurring']) {
      if (!Array.isArray(s[key])) s[key] = base[key];
    }
    if (!s.budgets || typeof s.budgets !== 'object') s.budgets = {};
    if (!Array.isArray(s.setupApplied)) s.setupApplied = [];
    if (s.rates.length === 0) s.rates = base.rates;
    s.version = STATE_VERSION;
    return s;
  }

  function walletById(state, id) {
    return state.wallets.find((w) => w.id === id);
  }

  function categoryById(state, id) {
    return (
      state.categories.find((c) => c.id === id) ||
      state.incomeCategories.find((c) => c.id === id) || { id, name: id || 'Uncategorised', icon: '❔' }
    );
  }

  /** Units of `currency` per 1 USD on `date` (latest rate entry on or before date). */
  function rateOn(state, currency, date) {
    if (currency === BASE) return 1;
    const sorted = state.rates
      .filter((r) => r.perUSD && r.perUSD[currency] > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sorted.length === 0) return null;
    let chosen = sorted[0]; // fall back to the earliest known rate for old dates
    for (const r of sorted) {
      if (r.date <= date) chosen = r;
      else break;
    }
    return chosen.perUSD[currency];
  }

  function latestRates(state) {
    const out = {};
    for (const code of Object.keys(CURRENCIES)) {
      if (code !== BASE) out[code] = rateOn(state, code, '9999-12-31');
    }
    return out;
  }

  function toBase(state, amount, currency, date, overrideRate) {
    const rate = overrideRate > 0 ? overrideRate : rateOn(state, currency, date);
    if (!rate) return 0;
    return round2(amount / rate);
  }

  function txnCurrency(state, txn) {
    const w = walletById(state, txn.walletId);
    return w ? w.currency : BASE;
  }

  /** USD value of an expense or income transaction. */
  function txnBase(state, txn) {
    return toBase(state, txn.amount, txnCurrency(state, txn), txn.date, txn.rate);
  }

  function walletBalance(state, walletId, upToDate) {
    const w = walletById(state, walletId);
    let bal = Number((w && w.openingBalance) || 0);
    for (const t of state.transactions) {
      if (upToDate && t.date > upToDate) continue;
      if (t.type === 'expense' && t.walletId === walletId) bal -= t.amount;
      else if (t.type === 'income' && t.walletId === walletId) bal += t.amount;
      else if (t.type === 'transfer') {
        if (t.walletId === walletId) bal -= t.amount;
        if (t.toWalletId === walletId) bal += t.toAmount;
      }
    }
    return round2(bal);
  }

  function transactionsInMonth(state, month) {
    return state.transactions
      .filter((t) => monthKey(t.date) === month)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  }

  function monthSummary(state, month) {
    const summary = {
      month,
      spent: 0,
      income: 0,
      byCategory: {},
      byWallet: {},
      byCurrency: {},
      byPaymentType: {},
      count: 0,
    };
    for (const t of transactionsInMonth(state, month)) {
      if (t.type !== 'expense' && t.type !== 'income') continue;
      const usd = txnBase(state, t);
      if (t.type === 'income') {
        summary.income = round2(summary.income + usd);
        continue;
      }
      summary.count++;
      summary.spent = round2(summary.spent + usd);
      summary.byCategory[t.categoryId] = round2((summary.byCategory[t.categoryId] || 0) + usd);

      const w = walletById(state, t.walletId) || { currency: BASE, type: 'cash' };
      const bw = summary.byWallet[t.walletId] || (summary.byWallet[t.walletId] = { native: 0, usd: 0 });
      bw.native = round2(bw.native + t.amount);
      bw.usd = round2(bw.usd + usd);

      const bc = summary.byCurrency[w.currency] || (summary.byCurrency[w.currency] = { native: 0, usd: 0 });
      bc.native = round2(bc.native + t.amount);
      bc.usd = round2(bc.usd + usd);

      summary.byPaymentType[w.type] = round2((summary.byPaymentType[w.type] || 0) + usd);
    }
    return summary;
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** True when the item is paid every month (no specific months chosen). */
  function isMonthly(item) {
    return !Array.isArray(item.months) || item.months.length === 0 || item.months.length === 12;
  }

  function isDueInMonth(item, month) {
    if (item.active === false) return false;
    if (isMonthly(item)) return true;
    return item.months.includes(Number(month.slice(5, 7)));
  }

  function frequencyLabel(item) {
    if (isMonthly(item)) return 'Monthly';
    const m = [...item.months].sort((a, b) => a - b);
    const names = m.map((n) => MONTH_NAMES[n - 1]).join(', ');
    return m.length === 1 ? `Yearly (${names})` : `${m.length}× a year (${names})`;
  }

  /** Total yearly cost of all active regular costs, in USD at today's rates. */
  function annualFixed(state) {
    let total = 0;
    for (const r of state.recurring) {
      if (r.active === false) continue;
      const times = isMonthly(r) ? 12 : r.months.length;
      total += recurringBase(state, r, '9999-12') * times;
    }
    return { total: round2(total), monthlyAverage: round2(total / 12) };
  }

  /** Monthly USD amount a recurring item is expected to cost. */
  function recurringBase(state, item, month) {
    const w = walletById(state, item.walletId);
    const date = `${month}-01`;
    return toBase(state, item.amount, w ? w.currency : BASE, date);
  }

  /** Fixed monthly costs and whether each has been paid in `month`. */
  function recurringStatus(state, month, today) {
    const now = today || todayISO();
    return state.recurring
      .filter((r) => isDueInMonth(r, month))
      .map((item) => {
        const day = Math.min(Math.max(1, Number(item.dayOfMonth) || 1), daysInMonth(month));
        const dueDate = `${month}-${String(day).padStart(2, '0')}`;
        const payments = state.transactions.filter(
          // forMonth marks a late (or early) payment for another month's bill.
          (t) => t.recurringId === item.id && (t.forMonth || monthKey(t.date)) === month
        );
        const paid = payments.length > 0;
        return {
          item,
          dueDate,
          paid,
          payments,
          overdue: !paid && dueDate < now,
          expectedUsd: recurringBase(state, item, month),
        };
      })
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  }

  /**
   * For each wallet: how much is still due this month from fixed costs,
   * what's in the wallet now, and any shortfall. This answers
   * "how much USD cash do we need to have on hand?"
   */
  function cashNeeds(state, month, today) {
    const needs = {};
    for (const s of recurringStatus(state, month, today)) {
      if (s.paid) continue;
      const id = s.item.walletId;
      needs[id] = round2((needs[id] || 0) + Number(s.item.amount));
    }
    return Object.keys(needs).map((walletId) => {
      const balance = walletBalance(state, walletId);
      const due = needs[walletId];
      return { walletId, due, balance, shortfall: round2(Math.max(0, due - balance)) };
    });
  }

  /** Budget vs actual per category for `month` (all in USD). */
  function budgetReport(state, month) {
    const summary = monthSummary(state, month);
    // fixed: everything due this month; fixedMonthly: only the every-month
    // items; seasonal: items due only in some months (e.g. termly school
    // fees), which are added on top of the regular budget in those months.
    const fixedByCat = {};
    const monthlyByCat = {};
    const seasonalByCat = {};
    for (const r of state.recurring) {
      if (!isDueInMonth(r, month)) continue;
      const v = recurringBase(state, r, month);
      fixedByCat[r.categoryId] = round2((fixedByCat[r.categoryId] || 0) + v);
      const bucket = isMonthly(r) ? monthlyByCat : seasonalByCat;
      bucket[r.categoryId] = round2((bucket[r.categoryId] || 0) + v);
    }
    const rows = state.categories.map((c) => {
      const regular = Number(state.budgets[c.id] || 0);
      const seasonal = seasonalByCat[c.id] || 0;
      const budget = round2(regular + seasonal);
      const fixed = fixedByCat[c.id] || 0;
      const spent = summary.byCategory[c.id] || 0;
      return { category: c, regular, seasonal, budget, fixed, fixedMonthly: monthlyByCat[c.id] || 0, spent, remaining: round2(budget - spent) };
    });
    // Spending in categories that were since deleted still needs to show up.
    for (const id of Object.keys(summary.byCategory)) {
      if (!state.categories.some((c) => c.id === id)) {
        rows.push({ category: categoryById(state, id), regular: 0, seasonal: 0, budget: 0, fixed: 0, fixedMonthly: 0, spent: summary.byCategory[id], remaining: -summary.byCategory[id] });
      }
    }
    const totalBudget = round2(rows.reduce((a, r) => a + r.budget, 0));
    return { rows, totalBudget, totalSpent: summary.spent, summary };
  }

  /**
   * Merge a predefined family setup (categories, regular costs, budgets)
   * into the state. Each item is applied once, keyed by id, so items the
   * family later edits or deletes are left alone, while new items added to
   * the setup appear on the next load.
   */
  function applySetup(state, setup) {
    if (!setup) return 0;
    const done = new Set(state.setupApplied || []);
    let added = 0;
    for (const c of setup.categories || []) {
      const key = 'category:' + c.id;
      if (done.has(key)) continue;
      if (!state.categories.some((x) => x.id === c.id)) state.categories.push({ ...c });
      done.add(key);
      added++;
    }
    for (const r of setup.recurring || []) {
      const key = 'recurring:' + r.id;
      if (done.has(key)) continue;
      if (!state.recurring.some((x) => x.id === r.id)) state.recurring.push({ active: true, ...r });
      done.add(key);
      added++;
    }
    for (const [cat, amount] of Object.entries(setup.budgets || {})) {
      const key = 'budget:' + cat;
      if (done.has(key)) continue;
      if (!state.budgets[cat]) state.budgets[cat] = amount;
      done.add(key);
      added++;
    }
    // One-off corrections to items that may already be on the phone,
    // e.g. changing how something is paid.
    for (const change of setup.changes || []) {
      const key = 'change:' + change.id;
      if (done.has(key)) continue;
      for (const [id, patch] of Object.entries(change.recurring || {})) {
        const r = state.recurring.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
      }
      for (const [id, patch] of Object.entries(change.categories || {})) {
        const c = state.categories.find((x) => x.id === id);
        if (c) Object.assign(c, patch);
      }
      done.add(key);
      added++;
    }
    state.setupApplied = [...done];
    return added;
  }

  function formatMoney(amount, currency, opts) {
    const cur = CURRENCIES[currency] || { symbol: currency + ' ' };
    const n = Number(amount) || 0;
    const digits = opts && opts.whole ? 0 : 2;
    const body = Math.abs(n).toLocaleString('en-GB', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return (n < 0 ? '-' : '') + cur.symbol + body;
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(state, month) {
    const header = ['Date', 'Type', 'Description', 'Category', 'Wallet', 'Currency', 'Amount', 'USD value', 'Rate (per USD)', 'To wallet', 'To amount'];
    const list = (month ? transactionsInMonth(state, month) : [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1)));
    const lines = [header.join(',')];
    for (const t of list) {
      const w = walletById(state, t.walletId);
      const cur = w ? w.currency : '';
      const to = t.toWalletId ? walletById(state, t.toWalletId) : null;
      const rate = t.rate > 0 ? t.rate : rateOn(state, cur, t.date);
      lines.push([
        t.date,
        t.type,
        t.note || '',
        t.type === 'transfer' ? '' : categoryById(state, t.categoryId).name,
        w ? w.name : '',
        cur,
        t.amount,
        t.type === 'transfer' ? '' : txnBase(state, t),
        rate || '',
        to ? to.name : '',
        t.type === 'transfer' ? t.toAmount : '',
      ].map(csvEscape).join(','));
    }
    return lines.join('\n');
  }

  return {
    BASE,
    CURRENCIES,
    WALLET_TYPES,
    DEFAULT_CATEGORIES,
    uid,
    round2,
    todayISO,
    monthKey,
    shiftMonth,
    daysInMonth,
    defaultState,
    normalizeState,
    walletById,
    categoryById,
    rateOn,
    latestRates,
    toBase,
    txnCurrency,
    txnBase,
    walletBalance,
    transactionsInMonth,
    monthSummary,
    recurringStatus,
    recurringBase,
    MONTH_NAMES,
    isMonthly,
    isDueInMonth,
    frequencyLabel,
    annualFixed,
    applySetup,
    cashNeeds,
    budgetReport,
    formatMoney,
    toCSV,
  };
});
