const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const S = require('../js/store.js');

// Minimal in-memory stand-in for the artifact db: docs by path, live listeners.
function fakeDb() {
  const docs = new Map();
  const subs = new Set();
  const snapDoc = (path) => ({
    id: path.split('/').pop(),
    exists: docs.has(path),
    data: () => (docs.has(path) ? { ...docs.get(path) } : undefined),
  });
  const notify = () => setImmediate(() => subs.forEach((fn) => fn()));
  function collection(coll) {
    return {
      onSnapshot(next) {
        const fire = () => {
          const list = [...docs.keys()].filter((p) => p.split('/').length === 2 && p.startsWith(coll + '/')).map(snapDoc);
          next({ docs: list, size: list.length, empty: !list.length });
        };
        subs.add(fire); setImmediate(fire);
        return () => subs.delete(fire);
      },
    };
  }
  function doc(path) {
    return {
      onSnapshot(next) {
        const fire = () => next(snapDoc(path));
        subs.add(fire); setImmediate(fire);
        return () => subs.delete(fire);
      },
      async set(body) { docs.set(path, { ...body }); notify(); },
      async update(body) {
        if (!docs.has(path)) throw { code: 'invalid_argument' };
        docs.set(path, { ...docs.get(path), ...body }); notify();
      },
      async delete() { docs.delete(path); notify(); },
    };
  }
  return { collection, doc, docs };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test('two people see each other\'s entries through the shared store', async () => {
  const db = fakeDb();
  db.docs.set('categories/water', { name: 'Water', icon: '💧', walletId: 'usd_cash', order: 1.5 });
  db.docs.set('recurring/wifi', { name: 'WiFi', amount: 220, walletId: 'usd_card', categoryId: 'comms', dayOfMonth: 1 });
  const sarah = S.createShared(C, db, 'u_sarah');
  const husband = S.createShared(C, db, 'u_husband');
  await tick();
  assert.ok(sarah.ready && husband.ready);
  assert.equal(sarah.state.categories[2].id, 'water', 'seeded category sits in its order');
  assert.equal(sarah.state.wallets.length, 5, 'default wallets without any docs');
  assert.equal(sarah.state.recurring[0].name, 'WiFi');

  sarah.putTxn({ id: 't1', type: 'expense', amount: 40, walletId: 'usd_cash', categoryId: 'water', date: '2026-10-13', createdBy: 'u_sarah' });
  husband.putTxn({ id: 't2', type: 'expense', amount: 60, walletId: 'usd_card', categoryId: 'transport', date: '2026-10-13', createdBy: 'u_husband' });
  await tick();
  for (const who of [sarah, husband]) {
    assert.deepEqual(who.state.transactions.map((t) => t.id).sort(), ['t1', 't2']);
    assert.equal(C.monthSummary(who.state, '2026-10').spent, 100);
  }

  husband.deleteTxn('t1');
  await tick();
  assert.deepEqual(sarah.state.transactions.map((t) => t.id), ['t2']);
});

test('budgets, wallet edits, hiding defaults and rates', async () => {
  const db = fakeDb();
  const a = S.createShared(C, db, 'u_a');
  const b = S.createShared(C, db, 'u_b');
  await tick();
  assert.equal(a.state.rates[0].source, 'default', 'placeholder rates until set');

  a.setBudgets({ groceries: 1517 });
  b.setBudgets({ water: 650 }); // both before either doc exists
  await tick();
  b.setBudgets({ baby: 300 });
  await tick();
  assert.equal(a.state.budgets.groceries, 1517);
  assert.equal(a.state.budgets.baby, 300);

  const cash = { ...a.state.wallets.find((w) => w.id === 'usd_cash'), openingBalance: 500 };
  a.putWallet(cash);
  b.deleteWallet('zar_cash');
  a.putRate({ date: '2026-10-13', perUSD: { GBP: 0.75, ZAR: 17.4, ZWG: 26.7 }, source: 'manual' });
  await tick();
  assert.equal(C.walletBalance(b.state, 'usd_cash'), 500);
  assert.ok(!a.state.wallets.some((w) => w.id === 'zar_cash'));
  assert.equal(C.rateOn(b.state, 'ZAR', '2026-10-20'), 17.4);
});
