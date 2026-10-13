# Family Budget

A simple budgeting app for a family in Zimbabwe that pays in several currencies
and several ways: USD cash, USD card, GBP card, ZAR card and ZAR cash (ZiG is
supported too). Every payment is entered in the currency it was actually paid
in, and the app converts everything to **USD** so you can see what you're
really spending each month.

## How it works

- **Wallets** – one per way you pay (USD cash, GBP card, ZAR card…). Each has
  a currency. Add an opening balance to track how much cash is in the house.
- **Exchange rates** – stored as "1 USD = x GBP/ZAR/ZiG" with a date. Each
  payment uses the rate in effect on its date, so updating today's rate never
  changes last month's totals. If the bank charged a different rate, type the
  actual USD value on that payment. GBP and ZAR can be fetched online.
- **Add a payment (+)** – amount, wallet, category. The USD equivalent shows as
  you type. The last wallet and category used are remembered.
- **Move / exchange** – drawing USD cash from a card, or buying rand with
  pounds before a trip to South Africa. It isn't counted as spending, but it
  updates both wallets and shows the rate you actually got.
- **Monthly costs** – regular bills (staff wages, school fees, rent, DStv,
  Netflix) with the wallet they're paid from and the day they're due. Tap
  **Pay** to record one. The overview shows what is still due this month
  **per wallet** and how much more cash you need to have on hand.
- **Budget** – a monthly USD amount per category, with what your fixed costs
  already add up to and what you've spent.
- **Overview** – total spent in USD, budget left, spending split by wallet
  and currency, cash vs card, and spending by category.
- **Export** – CSV per month or for everything; JSON backup and restore.

Categories are set up for local life (generator/solar, domestic staff,
contractors, South Africa shopping, cross-border transport & duty…) and
can be edited in Settings.

## Running it

It's plain HTML/JS with no build step. Open `index.html` in a browser, or
serve the folder (`npm start`, then visit http://localhost:8080). To use it on
your phones, host the folder somewhere (e.g. GitHub Pages) and use "Add to
Home screen".

Data is stored **only in the browser on that device** (localStorage). Use
*Settings → Download backup* regularly. A backup can be restored on another
device, but phones don't sync with each other yet.

## Development

```
npm test   # unit tests for the currency / budget logic (js/core.js)
```

- `js/core.js` – all calculations (rates, conversions, balances, monthly
  summaries, budgets, fixed-cost status, CSV). No DOM, so it's tested in Node.
- `js/app.js` – the UI.
- `css/styles.css` – mobile-first styles, light and dark mode.
