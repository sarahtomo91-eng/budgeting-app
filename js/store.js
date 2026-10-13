/*
 * Where the budget is kept.
 *
 * Two stores with the same methods:
 * - local: this browser only (localStorage). Used on GitHub Pages / file.
 * - shared: the Claude artifact database, so everyone the budget is shared
 *   with sees each other's entries live. One document per entry, so two
 *   people adding at the same time never overwrite each other.
 *
 * `store.state` has the same shape everywhere (see core.js defaultState);
 * the UI reads it and calls the put/delete methods to change things.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'family-budget-v1';

  function listeners() {
    const fns = [];
    return {
      on: (fn) => fns.push(fn),
      emit: (...args) => fns.forEach((fn) => fn(...args)),
    };
  }

  function upsert(list, item, key) {
    const k = key || 'id';
    const i = list.findIndex((x) => x[k] === item[k]);
    if (i >= 0) list[i] = item;
    else list.push(item);
  }

  // ---------- local ----------

  function createLocal(C, setup) {
    let state;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? C.normalizeState(JSON.parse(raw)) : C.defaultState();
    } catch (e) {
      state = C.defaultState();
    }
    const changed = listeners();
    const failed = listeners();
    const setupAdded = C.applySetup(state, setup);

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        failed.emit('Could not save – browser storage is full or blocked');
      }
      changed.emit();
    }
    if (setupAdded) save();

    const remove = (key, id, field) => {
      state[key] = state[key].filter((x) => x[field || 'id'] !== id);
      save();
    };

    return {
      shared: false,
      ready: true,
      state,
      setupAdded,
      onChange: changed.on,
      onError: failed.on,
      putTxn: (t) => { upsert(state.transactions, t); save(); },
      deleteTxn: (id) => remove('transactions', id),
      putRecurring: (r) => { upsert(state.recurring, r); save(); },
      deleteRecurring: (id) => remove('recurring', id),
      putWallet: (w) => { upsert(state.wallets, w); save(); },
      deleteWallet: (id) => remove('wallets', id),
      putCategory: (c) => { upsert(state.categories, c); save(); },
      deleteCategory: (id) => {
        state.categories = state.categories.filter((c) => c.id !== id);
        delete state.budgets[id];
        save();
      },
      putRate: (entry) => {
        upsert(state.rates, entry, 'date');
        // The placeholder rates are no longer needed once real ones exist.
        if (state.rates.length > 1) state.rates = state.rates.filter((r) => r.source !== 'default');
        save();
      },
      deleteRate: (date) => remove('rates', date, 'date'),
      setBudgets: (patch) => {
        for (const [cat, v] of Object.entries(patch)) {
          if (v > 0) state.budgets[cat] = v;
          else delete state.budgets[cat];
        }
        save();
      },
      replaceAll: (next) => {
        const fresh = C.normalizeState(next);
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, fresh);
        save();
      },
    };
  }

  // ---------- shared (Claude artifact db) ----------

  function createShared(C, db, meId) {
    const defaults = C.defaultState();
    const state = C.defaultState();
    state.recurring = [];
    state.transactions = [];
    const changed = listeners();
    const failed = listeners();
    const raw = { wallets: [], categories: [], recurring: [], txns: [], rates: [], budgets: [] };
    const pending = new Set(Object.keys(raw));
    const store = { shared: true, ready: false, state, meId, setupAdded: 0, onChange: changed.on, onError: failed.on };

    // Defaults (wallets, categories) come from the code; a document with the
    // same id overrides them, and `deleted: true` hides one.
    function mergeWithDefaults(defs, docs) {
      const byId = new Map();
      defs.forEach((d, i) => byId.set(d.id, { order: i, ...d }));
      for (const d of docs) byId.set(d.id, { ...(byId.get(d.id) || { order: 1000 }), ...d });
      return [...byId.values()]
        .filter((x) => !x.deleted)
        .sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
    }

    function rebuild() {
      state.wallets = mergeWithDefaults(defaults.wallets, raw.wallets);
      state.categories = mergeWithDefaults(defaults.categories, raw.categories);
      state.recurring = raw.recurring.filter((r) => !r.deleted);
      state.transactions = raw.txns;
      state.rates = raw.rates.length ? raw.rates : defaults.rates;
      state.budgets = {};
      for (const b of raw.budgets) if (b.amount > 0) state.budgets[b.id] = b.amount;
    }

    function plain(snapDocs) {
      return snapDocs.map((d) => ({ ...d.data(), id: d.id }));
    }

    function listen(name, ref, apply) {
      ref.onSnapshot(
        (snap) => {
          apply(snap);
          pending.delete(name);
          if (!pending.size) {
            store.ready = true;
            rebuild();
            changed.emit();
          }
        },
        (err) => failed.emit(err && err.code === 'revoked'
          ? 'Access to the shared budget was removed.'
          : 'Lost the connection to the shared budget. Reload to reconnect.')
      );
    }

    for (const coll of ['wallets', 'categories', 'recurring', 'txns']) {
      listen(coll, db.collection(coll), (snap) => { raw[coll] = plain(snap.docs); });
    }
    listen('rates', db.collection('rates'), (snap) => {
      raw.rates = plain(snap.docs).map((r) => ({ ...r, date: r.date || r.id }));
    });
    // One document per category (budgets/<categoryId> = {amount}), so two
    // people changing different budgets never overwrite each other.
    listen('budgets', db.collection('budgets'), (snap) => { raw.budgets = plain(snap.docs); });

    // One write at a time per document, in the order they were made.
    const queues = {};
    function write(path, fn) {
      const prev = queues[path] || Promise.resolve();
      const next = prev.then(fn).catch((err) => {
        const code = err && err.code;
        failed.emit(code === 'invalid_argument'
          ? "You can look at this budget but not change it. Ask the person who shared it to give you edit access."
          : code === 'quota_exceeded'
            ? 'The shared budget is full. Delete some old entries to add new ones.'
            : 'Could not save that change. Check your connection and try again.');
      });
      queues[path] = next;
      return next;
    }

    function clean(obj) {
      const out = {};
      for (const [k, v] of Object.entries(obj)) if (v !== undefined && k !== 'id') out[k] = v;
      return out;
    }

    const put = (coll, item) => write(`${coll}/${item.id}`, () => db.doc(`${coll}/${item.id}`).set(clean(item)));
    const del = (coll, id) => write(`${coll}/${id}`, () => db.doc(`${coll}/${id}`).delete());
    const hide = (coll, id) => write(`${coll}/${id}`, () => db.doc(`${coll}/${id}`).set({ deleted: true }));

    Object.assign(store, {
      putTxn: (t) => put('txns', t),
      deleteTxn: (id) => del('txns', id),
      putRecurring: (r) => put('recurring', r),
      deleteRecurring: (id) => del('recurring', id),
      putWallet: (w) => put('wallets', w),
      deleteWallet: (id) => hide('wallets', id),
      putCategory: (c) => put('categories', c),
      deleteCategory: (id) => hide('categories', id),
      putRate: (entry) => write(`rates/${entry.date}`, () => db.doc(`rates/${entry.date}`).set(clean(entry))),
      deleteRate: (date) => del('rates', date),
      setBudgets: (patch) => {
        for (const [cat, v] of Object.entries(patch)) {
          write(`budgets/${cat}`, () => (v > 0 ? db.doc(`budgets/${cat}`).set({ amount: v }) : db.doc(`budgets/${cat}`).delete()));
        }
      },
      replaceAll: null,
    });
    return store;
  }

  const api = { createLocal, createShared };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BudgetStore = api;
})(typeof self !== 'undefined' ? self : this);
