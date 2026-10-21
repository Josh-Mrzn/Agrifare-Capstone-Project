# AgriFair analytics: definitions and design

This is the reference for every number on the analytics pages, in the downloadable reports and in the emailed PDFs. All of them come from one module, `backend/src/analytics/metrics.js`. The dashboards, the exports and the emails call the same functions, so they always agree. If a definition changes, change it in that module and in this document together.

## Where things live

| Piece | File |
|---|---|
| Date ranges, comparisons, buckets | `backend/src/analytics/period.js` |
| Metric definitions | `backend/src/analytics/metrics.js` |
| Inventory analytics | `backend/src/analytics/inventory.js` |
| Written findings ("insights") | `backend/src/analytics/insights.js` |
| Database reads, scoped and filtered | `backend/src/analytics/data.js` |
| Sections for the seller and Super Admin pages | `backend/src/analytics/service.js` |
| Report contents | `backend/src/analytics/reports.js` |
| CSV / XLSX / PDF writers | `backend/src/analytics/exporters.js` |
| HTTP routes (`/api/analytics`) | `backend/src/routes/analyticsRoutes.js` |
| Charts, KPIs, filters, tables | `frontend/src/components/analytics/` |

## Time

- **Time zone.** Everything is calculated in Philippine time (UTC+8). "Today", "October" and "the week of Oct 6" mean the same thing on the server and in the browser.
- **Ranges are half-open: `[start, end)`.** A day runs from midnight to the next midnight. An order at 23:59 belongs to that day, one at 00:00 to the next, and no order is counted in two adjacent periods.
- **Presets:**
  - Today
  - Last 7, 30 or 90 days. These include today.
  - Last 6 or 12 months
  - Year to date
  - Custom, with both the start and end date included. A custom range can cover at most three years.
- **Comparison:**
  - *Previous period* has the same number of days and ends where the selected period starts.
  - *Same period last year* moves both ends back twelve months.
  - *None* turns comparisons off.
- **Grouping:**
  - **Automatic:**
    - up to 31 days → by day
    - up to 120 days → by week
    - up to 2 years → by month
    - longer → by quarter
  - Weeks start on Monday.
  - The group that is still running is marked "so far". It is left out of best/worst comparisons, because its total is still growing.
- **Which date an order uses.** An order belongs to the period in which it was **placed** (`orderDate`). This was already the app's rule. As a result, a period's sales can still rise after it ends, as its orders are completed.

## Orders and sales

- **Order.** One checkout counts as one order *per seller*. A cart with two products from one shop is stored as two rows that share a `groupId`; that is one order, not two. A cart split across two shops counts as one order for each shop, so seller figures add up to the marketplace totals. (Before this revamp each row was counted as its own order, which understated the average order value of multi-item carts.)
- **Sales.** The sum of `total` on **completed** order rows.
  - Delivered orders the buyer has not yet confirmed are not sales yet.
  - Cancelled orders never count.
  - Sales include the delivery fee. "Rice sales" (used for price per kg) leaves it out.
  - Cancelled orders are excluded from sales whether or not they were paid. Money returned on them is reported separately as refunds (below).
- **Order value placed** (Super Admin). The `total` of every order placed in the period except cancelled ones, whatever stage it is at.
- **Completed orders.** Distinct orders with a completed line.
- **In progress.** pending, confirmed, preparing, out for delivery, delivered.
- **Average order value.** Sales ÷ completed orders. Shown as "—" when there are no completed orders, never as ₱0 or NaN.
- **Completion rate.** Completed ÷ (completed + cancelled) orders placed in the period. Orders still in progress are left out of both sides, as before.
- **Cancellation rate.** Cancelled ÷ all orders placed in the period.
- **Order to completed.** The time from placing the order to its recorded completion, as an average and a median. Orders completed before the status history existed are left out rather than guessed.
- **Quantities.** Sacks are always counted together with their size: 3 × 25 kg is 75 kg. Kilograms are the common unit for adding sizes together. Product tables keep each pack size on its own row.
- **Price per kg.** Rice amount actually charged ÷ kilograms, using the prices on the orders, never today's list price.
- **Share.** A product's, variety's or seller's sales ÷ total sales for the same period and filters.
- **Refunded.** Money the seller recorded as returned to buyers, on orders placed in the period (`paymentStatus` refunded, `refund.amount`). Shown on the Sales pages with what is **still to refund**: money received on cancelled orders and not yet returned (`refund_due`). See `WORKFLOW.md` for how an order gets there.

## Changes and comparisons

- **Change.** Current minus comparison, as an absolute amount and a percentage.
- **No baseline.** When the comparison value is zero, no percentage is shown. The page says why instead: "None in previous 30 days, so no % change".
- **Rates.** Percentages such as the completion rate change in **percentage points** (pts).
- **Small samples.** When either period has fewer than 5 orders, the written finding says so, because a few orders move a percentage a lot.

## Buyers

- **Buyer.** A buyer account. Orders a seller typed in for a walk-in customer have no account, so those buyers are matched by name (case-insensitive).
- **Unique buyers.** Buyers with at least one completed order in the period.
- **New.** Their first completed order (with this seller, or anywhere on the marketplace) falls inside the period.
- **Returning.** They completed an order before the period started, and again inside it.
- **Repeat purchase rate.** Buyers with **2 or more** completed orders in the period ÷ unique buyers in the period.
- **Orders per buyer.** Completed orders ÷ unique buyers.
- **High value.** The top fifth of buyers by completed spend in the period. Only shown when there are at least 5 buyers.
- **Lapsed.** They have completed orders on record, none of them in the **60 days** before the period ends. The threshold is `INACTIVE_DAYS` in `metrics.js`, and the API accepts `inactiveDays` (14–365).
- **Privacy.** Buyer tables and exports contain names and order figures only, never phone numbers or addresses. Marketplace (Super Admin) exports contain no buyer names at all.

## Inventory

Inventory figures come **only** from the stock movement log: restock, sale, return, adjustment and damage. Each logged movement records the change in kilograms and the stock level left after it.

- **Sold, restocked, returned, adjusted.** The sums of logged movements of each kind in the period.
- **Stock at the start of a period.** The level left by the last movement before it. When no movement was logged before the period, it is unknown, not zero.
- **Sell-through.** Sold ÷ (sold + stock at the end of the period).
- **Days of stock left.**
  - The sales rate is kilograms sold over the last 30 days, per day.
  - It is shown only once the product has at least **14 days** of logged history.
  - Days left = stock on hand ÷ that rate.
  - Products with less history show "—".
- **Low stock.** At or below the warning level set on the product. **Sold out** means 0 kg.
- **Recorded stock level chart.** Plots only the logged points. It draws nothing in between and never rebuilds history from today's stock.
- **Not shown: stock value.** AgriFair stores selling prices but not what the stock cost, so there is no reliable valuation.
- **Known gap.** Stock typed in when a product is first listed is not logged as a movement. History before a product's first logged restock or sale is therefore unknown. The inventory page says so.

## Written findings

The findings are fixed rules applied to the numbers above. No language model or external service is involved.

- Every finding states its figures and the comparison period, so it can be checked against the chart.
- They describe what changed, never why it changed.
- They are never forecasts. The seasons view says how many months of history it rests on:
  - under 12 months is "too short to call seasonal"
  - one year shows one cycle
  - two or more years is enough to plan around

## Access

- **Sellers:** `/api/analytics/seller/*`. The seller id always comes from the signed-in account; a `sellerId` in the request is ignored.
- **Super Admin:** `/api/analytics/platform/*` requires the `superadmin` role. `/api/analytics/platform/sellers/:id/*` shows one seller exactly as that seller sees it, after checking the id belongs to a seller account.
- **Input checking:** filters are checked against known values (`ORDER_STATUSES`, `RICE_VARIETIES`, valid product ids). Anything unknown is dropped before a query is built. Bad dates return a 400 error.
- **Exports:** CSV and XLSX text cells that start with `= + - @` are prefixed with an apostrophe, so they cannot run as spreadsheet formulas. Files are sent with `Cache-Control: private, no-store`.

## Not available yet

- **Geographic breakdowns.** An order stores a free-text delivery address. The structured province and city live on the buyer's saved addresses and are not copied onto orders. Any breakdown by place would be a guess, so there is none.
- **Seasonality claims.** These need at least two years of completed sales to mean anything. Until then the page says how short the history is.

## The seller's Analytics page

One page with **Daily** (last 14 days), **Weekly** (last 12 weeks, Monday to Sunday), **Monthly** (last 12 months) and **Yearly** (this year and the two before), each ending today, and an optional rice variety. It comes from `GET /api/analytics/seller/dashboard` and shows:

- **Earnings this month:** completed sales in the current calendar month, against last month, whatever view is chosen.
- **Total sales, total sold (kg), completed orders, average order value:** for the selected view, against the same number of days just before it.
- **Repeat buyers:** buyers with 2 or more completed orders in the view, out of all buyers in it.
- **Sales trend, share per variety, best-selling rice (product and pack size), top 5 buyers, and up to 4 written findings.**
- **Reports and exports** (CSV, XLSX, PDF, email) for exactly the dates of the view.

The figures use the definitions above, so they match the reports: the tests check the dashboard against the Sales section for the same dates. A Super Admin sees the same page for one seller.

## The Super Admin's Analytics page

The same four views for the whole marketplace, from `GET /api/analytics/platform/dashboard`:

- **Marketplace sales and completed orders:** against the same number of days just before.
- **Sellers with sales:** approved sellers with at least one completed sale in the view, out of all approved sellers.
- **New accounts:** buyers and sellers who signed up in the view (riders and admins are left out).
- **Pending applications:** submitted and waiting now. **Rejected applications:** decided in the view.
- **Charts:** marketplace sales, applications by status (all time), new accounts by bucket, top sellers (click one to see their best-selling rice), and pending applications with Approve and Reject (approval needs a verified permit, as on the Users page).

## One source

The seller dashboard, the Super Admin overview figure and a seller's page in the Super Admin portal read these same sections. The older per-seller and platform figures (`/api/admin/orders/analytics`, `/orders/breakdown`, `/api/superadmin/users/:id/analytics`, `/analytics/revenue`, `/analytics/businesses`) were removed, so no page can show a second, different "sales" number.

## Tests

```bash
cd backend
npm test                                                         # unit tests (no database)
MONGO_TEST_URI=mongodb://127.0.0.1:27017/agrifair_test npm test  # adds the database tests
```

The database tests create and **drop** the database you give them, so point them only at a throwaway one, never at production. They cover:

- seller isolation and role checks
- marketplace totals reconciling with the seller table
- empty shops
- buyer classification
- filters
- inventory
- exports matching the dashboard
