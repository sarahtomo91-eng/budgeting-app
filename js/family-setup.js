/*
 * Our family's regular costs and budgets.
 *
 * These are loaded into the app automatically. Each entry is added once
 * (by its id): if you later change or delete it in the app, it stays the
 * way you left it. To add something new, add an entry with a new id and it
 * appears the next time the app is opened.
 *
 * months: which months a cost is due (1 = Jan … 12 = Dec). Leave it out for
 * costs paid every month. School terms start in Jan, May and Sep.
 * budgets: monthly amounts in USD per category, for spending that varies.
 * walletId on a category: how it's usually paid – picking the category when
 * adding a payment selects that wallet.
 * changes: one-off corrections for phones that already have the items
 * above. Give each a new id; it is applied once.
 */
(function (root) {
  const TERMS = [1, 5, 9];
  const WEEKS_PER_MONTH = 52 / 12;

  const FAMILY_SETUP = {
    categories: [
      { id: 'fuel_me', name: 'Fuel – my car', icon: '⛽', walletId: 'usd_card' },
      { id: 'fuel_husband', name: "Fuel – husband's car", icon: '⛽', walletId: 'usd_card' },
      { id: 'water', name: 'Water', icon: '💧', walletId: 'usd_cash' },
      { id: 'baby', name: 'Nappies & baby', icon: '👶', walletId: 'usd_card' },
      { id: 'fitness', name: 'Gym & fitness', icon: '🏋️', walletId: 'usd_card' },
      { id: 'bread_milk', name: 'Bread & milk delivery', icon: '🥛', walletId: 'usd_cash' },
      { id: 'runner_sa', name: 'Runner – South Africa', icon: '🚚', walletId: 'usd_cash' },
      { id: 'runner_uk', name: 'Runner – UK', icon: '📮', walletId: 'gbp_card' },
    ],

    recurring: [
      { id: 'wifi', name: 'WiFi', amount: 220, walletId: 'usd_card', categoryId: 'comms', dayOfMonth: 1 },
      { id: 'staff_wages', name: 'Staff wages', amount: 1200, walletId: 'usd_cash', categoryId: 'staff', dayOfMonth: 25 },
      { id: 'dstv', name: 'DStv', amount: 100, walletId: 'usd_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'gym', name: 'Gym membership', amount: 120, walletId: 'usd_card', categoryId: 'fitness', dayOfMonth: 1 },

      // Subscriptions on the GBP card (typical UK prices – adjust in the app)
      { id: 'spotify', name: 'Spotify', amount: 12.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'expressvpn', name: 'ExpressVPN', amount: 9.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'chatgpt', name: 'ChatGPT', amount: 20, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'netflix', name: 'Netflix', amount: 12.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'apple_tv', name: 'Apple TV+', amount: 9.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'amazon_prime', name: 'Amazon Prime', amount: 8.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },
      { id: 'canva', name: 'Canva', amount: 10.99, walletId: 'gbp_card', categoryId: 'subscriptions', dayOfMonth: 1 },

      { id: 'school_hugo', name: 'School fees – Hugo', amount: 1800, walletId: 'usd_cash', categoryId: 'school', dayOfMonth: 5, months: TERMS },
      { id: 'swim_hugo', name: 'Swimming – Hugo', amount: 120, walletId: 'usd_cash', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
      { id: 'swim_toby', name: 'Swimming – Toby', amount: 120, walletId: 'usd_cash', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
      { id: 'jumpstart_hugo', name: 'Jumpstart – Hugo', amount: 120, walletId: 'usd_cash', categoryId: 'kids', dayOfMonth: 5, months: TERMS },
    ],

    budgets: {
      // Every-month bills (match the regular costs above)
      comms: 220,
      staff: 1200,
      subscriptions: 215, // DStv $100 + ~£86 of GBP subscriptions
      fitness: 120,
      // Day-to-day spending
      groceries: Math.round(350 * WEEKS_PER_MONTH), // ~$350 a week
      water: Math.round(150 * WEEKS_PER_MONTH), // ~$150 a week
      bread_milk: Math.round(32 * WEEKS_PER_MONTH), // ~$32 a week
      fuel_me: 250,
      fuel_husband: 250, // placeholder – update once known
      baby: 300,
    },

    changes: [
      {
        id: '2026-10-how-we-pay',
        recurring: {
          school_hugo: { walletId: 'usd_cash' },
          swim_hugo: { walletId: 'usd_cash' },
          swim_toby: { walletId: 'usd_cash' },
          jumpstart_hugo: { walletId: 'usd_cash' },
        },
        categories: {
          groceries: { walletId: 'usd_card' },
          fuel_me: { walletId: 'usd_card' },
          fuel_husband: { walletId: 'usd_card' },
          baby: { walletId: 'usd_card' },
          water: { walletId: 'usd_cash' },
          staff: { walletId: 'usd_cash' },
          import_costs: { name: 'Import duty & shipping' },
        },
      },
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = FAMILY_SETUP;
  else root.FAMILY_SETUP = FAMILY_SETUP;
})(typeof self !== 'undefined' ? self : this);
