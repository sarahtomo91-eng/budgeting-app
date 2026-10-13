const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

function freshState() {
  const s = C.defaultState(new Date(2026, 0, 1));
  s.rates = [
    { date: '2026-01-01', perUSD: { GBP: 0.8, ZAR: 18, ZWG: 27 } },
    { date: '2026-03-01', perUSD: { GBP: 0.75, ZAR: 17, ZWG: 26 } },
  ];
  return s;
}

test('rateOn picks the latest rate on or before the date', () => {
  const s = freshState();
  assert.equal(C.rateOn(s, 'USD', '2026-02-10'), 1);
  assert.equal(C.rateOn(s, 'ZAR', '2026-02-10'), 18);
  assert.equal(C.rateOn(s, 'ZAR', '2026-03-01'), 17);
  assert.equal(C.rateOn(s, 'ZAR', '2025-06-01'), 18, 'falls back to earliest known rate');
});

test('expenses convert to USD with date rate or own rate', () => {
  const s = freshState();
  const t1 = { type: 'expense', amount: 1800, walletId: 'zar_card', date: '2026-02-05' };
  const t2 = { type: 'expense', amount: 1800, walletId: 'zar_card', date: '2026-02-05', rate: 20 };
  const t3 = { type: 'expense', amount: 80, walletId: 'gbp_card', date: '2026-02-05' };
  assert.equal(C.txnBase(s, t1), 100);
  assert.equal(C.txnBase(s, t2), 90);
  assert.equal(C.txnBase(s, t3), 100);
});

test('monthSummary totals across currencies and payment types', () => {
  const s = freshState();
  s.transactions = [
    { id: 'a', type: 'expense', amount: 50, walletId: 'usd_cash', categoryId: 'contractors', date: '2026-02-03' },
    { id: 'b', type: 'expense', amount: 900, walletId: 'zar_cash', categoryId: 'sa_imports', date: '2026-02-04' },
    { id: 'c', type: 'expense', amount: 40, walletId: 'gbp_card', categoryId: 'subscriptions', date: '2026-02-04' },
    { id: 'd', type: 'income', amount: 1000, walletId: 'usd_card', categoryId: 'salary', date: '2026-02-01' },
    { id: 'e', type: 'transfer', amount: 200, walletId: 'usd_card', toWalletId: 'usd_cash', toAmount: 200, date: '2026-02-02' },
    { id: 'f', type: 'expense', amount: 10, walletId: 'usd_cash', categoryId: 'other', date: '2026-03-02' },
  ];
  const m = C.monthSummary(s, '2026-02');
  assert.equal(m.spent, 50 + 50 + 50);
  assert.equal(m.income, 1000);
  assert.equal(m.count, 3);
  assert.equal(m.byCategory.sa_imports, 50);
  assert.deepEqual(m.byCurrency.ZAR, { native: 900, usd: 50 });
  assert.equal(m.byPaymentType.cash, 100);
  assert.equal(m.byPaymentType.card, 50);
});

test('wallet balances include transfers', () => {
  const s = freshState();
  s.wallets.find((w) => w.id === 'usd_cash').openingBalance = 100;
  s.transactions = [
    { type: 'transfer', amount: 200, walletId: 'usd_card', toWalletId: 'usd_cash', toAmount: 200, date: '2026-02-02' },
    { type: 'expense', amount: 75.5, walletId: 'usd_cash', categoryId: 'staff', date: '2026-02-03' },
    { type: 'transfer', amount: 50, walletId: 'gbp_card', toWalletId: 'zar_cash', toAmount: 1100, date: '2026-02-03' },
  ];
  assert.equal(C.walletBalance(s, 'usd_cash'), 224.5);
  assert.equal(C.walletBalance(s, 'usd_card'), -200);
  assert.equal(C.walletBalance(s, 'zar_cash'), 1100);
  assert.equal(C.walletBalance(s, 'gbp_card'), -50);
});

test('recurring status, due dates and cash needs', () => {
  const s = freshState();
  s.recurring = [
    { id: 'r1', name: 'Gardener', amount: 150, walletId: 'usd_cash', categoryId: 'staff', dayOfMonth: 31 },
    { id: 'r2', name: 'Netflix', amount: 10, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 5 },
    { id: 'r3', name: 'Maid', amount: 200, walletId: 'usd_cash', categoryId: 'staff', dayOfMonth: 1 },
  ];
  s.wallets.find((w) => w.id === 'usd_cash').openingBalance = 120;
  s.transactions = [
    { type: 'expense', amount: 200, walletId: 'usd_cash', categoryId: 'staff', date: '2026-02-01', recurringId: 'r3' },
  ];
  const st = C.recurringStatus(s, '2026-02', '2026-02-10');
  assert.deepEqual(st.map((x) => x.item.id), ['r3', 'r2', 'r1']);
  assert.equal(st[2].dueDate, '2026-02-28', 'day clamps to month length');
  assert.equal(st[0].paid, true);
  assert.equal(st[1].overdue, true);
  assert.equal(st[2].overdue, false);

  const needs = C.cashNeeds(s, '2026-02', '2026-02-10');
  const cash = needs.find((n) => n.walletId === 'usd_cash');
  // balance = 120 - 200 = -80, still due 150 → shortfall 230
  assert.deepEqual(cash, { walletId: 'usd_cash', due: 150, balance: -80, shortfall: 230 });
});

test('budgetReport combines budgets, fixed costs and spending', () => {
  const s = freshState();
  s.budgets = { groceries: 600, staff: 350 };
  s.recurring = [{ id: 'r1', name: 'Maid', amount: 200, walletId: 'usd_cash', categoryId: 'staff', dayOfMonth: 1 }];
  s.transactions = [
    { type: 'expense', amount: 3600, walletId: 'zar_card', categoryId: 'groceries', date: '2026-02-04' },
  ];
  const r = C.budgetReport(s, '2026-02');
  const g = r.rows.find((x) => x.category.id === 'groceries');
  assert.equal(g.spent, 200);
  assert.equal(g.remaining, 400);
  assert.equal(r.rows.find((x) => x.category.id === 'staff').fixed, 200);
  assert.equal(r.totalBudget, 950);
});

test('normalizeState repairs partial data', () => {
  const s = C.normalizeState({ transactions: 'oops', budgets: null });
  assert.ok(Array.isArray(s.transactions));
  assert.ok(s.wallets.length > 0);
  assert.deepEqual(s.budgets, {});
});

test('formatMoney and CSV export', () => {
  assert.equal(C.formatMoney(1234.5, 'ZAR'), 'R1,234.50');
  assert.equal(C.formatMoney(-3, 'GBP'), '-£3.00');
  const s = freshState();
  s.transactions = [{ type: 'expense', amount: 18, walletId: 'zar_cash', categoryId: 'groceries', date: '2026-02-01', note: 'Bread, "fresh"' }];
  const csv = C.toCSV(s, '2026-02').split('\n');
  assert.equal(csv.length, 2);
  assert.match(csv[1], /"Bread, ""fresh"""/);
  assert.match(csv[1], /,1,18,/);
});
