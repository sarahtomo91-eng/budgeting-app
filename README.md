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
  you type. Each category can have a usual wallet (Settings → Categories), so
  picking “Groceries” selects the USD card and “Water” selects USD cash.
- **Move / exchange** – drawing USD cash from a card, or buying rand with
  pounds before a trip to South Africa. It isn't counted as spending, but it
  updates both wallets and shows the rate you actually got.
- **Regular costs** – bills paid every month (staff wages, WiFi, DStv) or only
  in some months (termly school fees, swimming), with the wallet they're paid
  from and the day they're due. Tap **Pay** to record one. A yearly view shows
  the average to put aside each month. The overview shows what is still due this month
  **per wallet** and how much more cash you need to have on hand.
- **Budget** – a monthly USD amount per category (with a per-week figure),
  what your regular costs already add up to and what you've spent. Termly
  costs are added to the budget in the months they're due.
- **Overview** – total spent in USD, budget left, spending split by wallet
  and currency, cash vs card, and spending by category.
- **Export** – CSV per month or for everything; JSON backup and restore.

Categories are set up for local life (generator/solar, domestic staff,
contractors, South Africa shopping, cross-border transport & duty…) and
can be edited in Settings.

## Our family setup

`js/family-setup.js` holds our regular costs and budgets. They load into the
app automatically. Each entry is added once: changes made in the app are
kept, and new entries added to the file appear the next time the app opens.

## Running it

It's plain HTML/JS with no build step. Open `index.html` in a browser, or
serve the folder (`npm start`, then visit http://localhost:8080).

**On your phones (GitHub Pages):**

1. On GitHub, open the repository → **Settings** → **Pages**.
2. Under *Build and deployment*, set **Source** to *Deploy from a branch*,
   pick the branch the app is on and the **/ (root)** folder, then **Save**.
3. After a minute or two the app is live at
   https://sarahtomo91-eng.github.io/budgeting-app/
4. Open that link on each phone and choose **Add to Home screen** (Safari:
   Share button; Chrome: ⋮ menu). Once opened, it also works offline.

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
