# AgriFair workflows: orders, payments, delivery and accounts

This is the reference for how an order moves from checkout to completion, how its money is tracked, who may do what, and how seller accounts are approved. The rules live in two backend files: `backend/src/services/orderRules.js` (pure rules, unit-tested) and `backend/src/services/orderWorkflow.js` (the one place every role's actions go through). If a rule changes, change it there and here together.

## The seller-order

A checkout writes one database row per product line. The lines **one seller** fulfils from **one checkout** (same `groupId`, same `sellerId`) are one order to that seller, to the buyer and to the rider. They are confirmed, packed, shipped, delivered, paid, cancelled and completed together. A basket from two shops is two seller-orders, each handled by its own shop. Analytics count orders the same way (see `ANALYTICS.md`).

Every change is a conditional database update on the value it expects to replace. Two people acting at the same moment cannot both win, and a double click acts once.

## Two separate statuses

| | Field | Values |
|---|---|---|
| Where the rice is | `status` | pending → confirmed → processing → shipped → delivered → completed, or cancelled |
| Where the money is | `paymentStatus` | unpaid, proof_sent, paid, rejected, refund_due, refunded |

The web order page shows both side by side, and the actions offered depend on both.

### Delivery status transitions

| From | To | Who | Conditions |
|---|---|---|---|
| pending | confirmed | seller | GCash and PayMongo must be **paid**; no open cancellation request; enough stock (deducted now) |
| pending, confirmed, processing | cancelled | seller (reason required), or buyer directly while pending and unpaid | stock returned exactly once; payment moves to refund_due if money or a receipt came in |
| confirmed | processing | seller | |
| processing | shipped | seller, or the rider ("Picked up. Start delivery") | a rider who **accepted**, or a named courier with a tracking number |
| shipped | delivered | the rider ("Mark as delivered"), or the seller for a courier delivery | photo at the door; for cash on delivery, the cash collected |
| delivered | completed | buyer ("I received my order"); seller after 3 days; the system after 7 days | paid; no open cancellation request; no open problem |

Out for delivery (`shipped`) and later cannot be cancelled. After delivery the buyer uses **Report a problem**.

### Payment transitions

| From | To | How |
|---|---|---|
| unpaid | paid | PayMongo confirms (webhook or the app's check), or the rider's cash matches the amount due, or the seller's audited cash correction |
| unpaid | proof_sent | buyer uploads a GCash receipt at checkout |
| proof_sent | paid / rejected | seller checks their own GCash app (reference number required to accept) |
| rejected | proof_sent | buyer sends a new receipt |
| proof_sent, paid | refund_due | the order is cancelled (or PayMongo paid on a page left open after cancelling) |
| refund_due | refunded | seller records the refund (amount, GCash reference or note) |

Nothing else is allowed: paid never goes back to unpaid or rejected, and a refund is never skipped. Every change is appended to `paymentHistory` with its kind (review, resubmit, paymongo, cod, correction, cancellation, refund), amount, reference, note and who did it.

## Paying

- **Cash on delivery.** The rider enters the cash collected when marking the order delivered. If it matches the amount due to the centavo, the order is paid. If not, it stays unpaid, the seller is notified, and the order cannot complete until the seller records a correction with a reason. The rider's figure stays in the history beside the correction.
- **GCash (direct to the seller).** Only to a shop whose GCash payout a Super Admin **verified**; otherwise checkout refuses it. One shop per GCash checkout. The receipt and its 10–16 digit reference number come with the order; a reference already used on another order is refused. The seller confirms against their own GCash history. If the money is not there, the buyer is told why and can send a new receipt.
- **PayMongo (sandbox).** Never marked paid by a seller or by the client. Only PayMongo's own answer counts, and the amount it collected must equal the order total. See `DEPLOYMENT.md` §5.

## Cancelling

- **Pending and unpaid:** the buyer's cancel button cancels at once.
- **Anything else before shipping** (a receipt sent, paid, or the seller already confirmed): the button sends a **cancellation request**. The seller approves it (order cancelled, stock returned, payment becomes refund_due) or declines with a note the buyer sees. While a request is open the order cannot be confirmed or completed.
- **Seller cancels:** with a reason. Paid orders become refund_due.
- **Refund:** the seller sends the money back and records it; the buyer is notified with the amount and reference.

## Delivery by a rider

1. The seller assigns one of their own active riders (confirmed or processing orders only). The rider is notified.
2. The rider **accepts** or **declines with a reason**. A decline returns the order to the seller, who is notified and chooses someone else. The order cannot go out until a rider accepts.
3. When the order is packed, the rider taps **Picked up. Start delivery** (the order goes out for delivery; the buyer is notified).
4. In the app the rider sees the map with the road route (OSRM, OpenStreetMap data) to the next stop and can open **Google Maps** for turn-by-turn navigation. If location is refused or there is no signal, the map shows the shop and the door and the written address; the straight line is labelled as such.
5. At the door: take the **photo** (saved straight away), enter the **cash collected** for cash on delivery, then **Mark as delivered**. A dropped connection is retried, and pressing again after it went through returns the delivered order rather than an error.
6. The rider and the buyer can message each other only about that delivery, and only while it is open.

A seller can also send an order with an outside courier (name and tracking number) and mark it delivered with their own photo (and the cash collected).

## Completion

- The buyer's **I received my order** completes it at once.
- The seller may complete it 3 days after delivery.
- **Automatically after 7 days** when it has a delivery photo, is paid, and has no open cancellation request or problem. The API runs this on start and hourly; a GitHub Actions schedule also calls `POST /api/jobs/auto-complete` with the `CRON_SECRET` header (see `DEPLOYMENT.md` §6). Running it twice is harmless.
- **Report a problem** (buyer, delivered orders): pauses completion until the seller resolves it with a note the buyer sees.

## Stock

- Checked when the item goes in the cart, again at checkout (no reservation), and deducted when the seller confirms. If stock ran out in between, confirming is refused and nothing changes; the seller restocks or cancels.
- Returned exactly once on cancellation: the flag that says stock was taken is cleared in the same conditional update that decides who returns it.
- Only the sack sizes the seller lists can be bought (1 kg when they list none). A listing taken down, a size no longer sold, or a closed shop shows in the cart as not buyable.

## Accounts and apps

| Role | Signs in to | Notes |
|---|---|---|
| Buyer | phone app | signs up as a buyer (the role must be chosen; nobody is made a seller by default) |
| Seller | website | limited account until approved |
| Rider | phone app or the web rider page | created by their seller; activates by emailed link |
| Super Admin | website | |

The sign-in token records the app it was issued to, and the API refuses it from a role that does not belong there. Buyer pages and the cart are buyer-only; seller tools require an approved seller.

### Seller application

1. A new seller signs up on the website and signs in to a **limited account**: only the Account page, with a checklist.
2. They fill in the kind of seller and business name, upload at least one permit (DTI, BIR, Mayor's permit…), optionally set up GCash, and press **Submit for review**. Super Admins are notified.
3. A Super Admin verifies a permit (Credentials) and **approves**. Approval is refused for an unsubmitted application or one without a verified permit. GCash is not required to open the shop; without it buyers pay cash on delivery or online.
4. Or the Super Admin **rejects** with a reason. The seller sees it, fixes the application and submits again.
5. Sellers approved before this flow existed stay active.

### Suspending and deactivating

- **Suspend** stops sign-in at once (every request re-checks the account) and hides a seller's products; **Reinstate** reverses it.
- **Deactivate** replaces deleting. The account is signed out and cannot sign in, a seller's shop disappears, and everything it is named on (orders, reviews, chats, audit log) is kept. It can be reactivated. A Super Admin cannot deactivate or suspend themselves, the last active Super Admin cannot be deactivated, and an account with deliveries in progress cannot be deactivated until they are finished.
- The edit form cannot change an account's status; that goes through the buttons above, each with its own checks.

## Messages

| Between | Allowed |
|---|---|
| Buyer and seller | yes |
| Seller and their own riders | yes |
| Rider and buyer | only about a delivery assigned to that rider, in a thread tied to that order, while it is open |
| Super Admin and anyone | yes (support) |
| Anyone else | no |

A seller still applying cannot message customers. Order events are also written into the buyer–seller thread as quiet system messages.

## Notifications

Every notification goes through `backend/src/services/notify.js`, which writes the link for the app its reader uses: `/client?tab=orders&order=<id>` for sellers, `/orders/<groupId>` and `/messages/<id>` for buyers (opened in the app), `/rider?order=<id>` for riders, `/superadmin?tab=users` for seller applications. Who hears about what:

- Seller: new order, buyer cancelled or asked to cancel, new GCash receipt, PayMongo payment, cash mismatch, rider accepted or declined, reported problem, auto-completion, low stock, application approved or rejected.
- Buyer: every status change, payment accepted or not found, cancellation declined, refund recorded, problem resolved.
- Rider: new assignment, unassigned or reassigned, order cancelled.
- Super Admin: a seller application submitted.

## Tests

```bash
cd backend
npm test                                                         # rules (no database)
MONGO_TEST_URI=mongodb://127.0.0.1:27017/agrifair_test npm test  # adds the HTTP workflow tests
```

`test/workflow.integration.test.js` drives the real routes against a throwaway database (`<name>_workflow`, dropped before and after) and covers the flows above: pack sizes, verified GCash, idempotent checkout, cancel vs request, receipt rejection and resubmission, stock deducted once and returned once, refunds, rider accept/decline/start/proof/deliver with retries, cash mismatch and correction, auto-complete, PayMongo amount and duplicate checks, role-per-app sign-in, chat rules, the seller application, deactivation, and refunds in analytics. Never point it at production.
