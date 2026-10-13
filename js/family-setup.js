/*
 * Our family's regular costs and budgets.
 *
 * These are loaded into the app automatically. Each entry is added once
 * (by its id): if you later change or delete it in the app, it stays the
 * way you left it. To add something new, add an entry with a new id and it
 * appears the next time the app is opened.
 *
 * months: which months a cost is due (1 = Jan … 12 = Dec). Leave it out for
 * costs paid every month. School terms are assumed to start Jan, May and Sep.
 * budgets: monthly amounts in USD per category, for spending that varies.
 */
(function (root) {
  const TERMS = [1, 5, 9];
  const WEEKS_PER_MONTH = 52 / 12;

  const FAMILY_SETUP = {
    categories: [
      { id: 'fuel_me', name: 'Fuel – my car', icon: '⛽' },
      { id: 'fuel_husband', name: "Fuel – husband's car", icon: '⛽' },
      { id: 'water', name: 'Water', icon: '💧' },
      { id: 'baby', name: 'Nappies & baby', icon: '👶' },
      { id: 'fitness', name: 'Gym & fitness', icon: '🏋️' },
    ],

    recurring: [
      { id: 'wifi', name: 'WiFi', amount: 220, walletId: 'usd_card', categoryId: 'comms', dayOfMonth: 1 },
      { id: 'staff_wages', name: 'Staff wages', amount: 1200, walletId: 'usd_cash', categoryId: 'staff', dayOfMonth: 25 },
      { id: 'dstv', name: 'DStv', amount: 100, walletId: 'usd_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'gym', name: 'Gym membership', amount: 120, walletId: 'usd_card', categoryId: 'fitness', dayOfMonth: 1 },

      { id: 'school_hugo', name: 'School fees – Hugo', amount: 1800, walletId: 'usd_card', categoryId: 'school', dayOfMonth: 5, months: TERMS },
      { id: 'swim_hugo', name: 'Swimming – Hugo', amount: 120, walletId: 'usd_card', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
      { id: 'swim_toby', name: 'Swimming – Toby', amount: 120, walletId: 'usd_card', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
      { id: 'jumpstart_hugo', name: 'Jumpstart – Hugo', amount: 120, walletId: 'usd_card', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
    ],

    budgets: {
      // Every-month bills (match the regular costs above)
      comms: 220,
      staff: 1200,
      subscriptions: 100,
      fitness: 120,
      // Day-to-day spending
      groceries: Math.round(350 * WEEKS_PER_MONTH), // ~$350 a week
      water: Math.round(150 * WEEKS_PER_MONTH), // ~$150 a week
      fuel_me: 250,
      fuel_husband: 250, // placeholder – update once known
      baby: 300,
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = FAMILY_SETUP;
  else root.FAMILY_SETUP = FAMILY_SETUP;
})(typeof self !== 'undefined' ? self : this);
