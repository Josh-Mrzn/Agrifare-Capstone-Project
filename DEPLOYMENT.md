# Deploying AgriFair

| Part | Host | Why |
|---|---|---|
| Website (`frontend/`) | **Vercel** (free) | Static Vite build with a global CDN. `frontend/vercel.json` already handles page routes. |
| API (`backend/`) | **Render** (free) or Railway | The API is a long-running Express server. Its rate limits and email cooldowns are kept in memory, and photo uploads can reach 8 MB. Vercel functions cap request bodies at 4.5 MB and do not keep memory between calls, so the API should not run there. |
| Database and uploads | **MongoDB Atlas** M0 (free) | Uploads are stored in GridFS inside the same database, so they survive restarts. |
| Android app | APK served by the website | Built with your API's URL baked in (step 4). |

Do the steps in this order: you need the database URL before the API, the API's URL before the website and the app, and the website's URL before the API's CORS setting.

## 1. Database: MongoDB Atlas

1. Create a free M0 cluster.
2. Under **Database Access**, add a user with a password.
3. Under **Network Access**, allow `0.0.0.0/0`. Render's free tier has no fixed IP address.
4. Copy the connection string, e.g. `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/agrifair`.

## 2. API: Render

1. On render.com: **New → Blueprint**, then pick this repository. The blueprint is in `render.yaml`.
2. Fill in the values Render asks for:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `APP_URL` | your Vercel URL, e.g. `https://agrifair.vercel.app` (fill this in after step 3) |
   | `CORS_ORIGINS` | the same Vercel URL. Separate several with commas. |
   | `VERCEL_PROJECT` | optional: your Vercel project name, to also allow its preview deployments |
   | `BREVO_API_KEY`, `MAIL_FROM` | email for OTP codes (see `backend/.env.example`) |

   `JWT_SECRET` is generated for you.
3. When the deploy finishes, open `https://<your-service>.onrender.com/api`. It should answer `API is running...`.

**Free-tier sleep:** Render's free tier sleeps after 15 minutes without traffic, and the first request afterwards takes about a minute. The app gives up on a request after 20 seconds. To keep the API awake, add a free monitor at cron-job.org or UptimeRobot that opens `https://<your-service>.onrender.com/test` every 10 minutes. The alternative is a paid instance.

**Railway** also works: `railway.toml` and `backend/Dockerfile` are already set up. Use the same variables.

## 3. Website: Vercel

1. On vercel.com: **Add New → Project**, then import this repository.
2. Set **Root Directory** to `frontend`. The framework (Vite) is detected automatically.
3. Add one environment variable: `VITE_API_URL` = `https://<your-service>.onrender.com/api`.
4. Deploy. Then return to Render and set `APP_URL` and `CORS_ORIGINS` to the Vercel URL. Render redeploys on its own.

## 4. Android app

The app does not look for a server: the API URL is compiled into it.

**Easiest: GitHub builds it.** `.github/workflows/build-apk.yml` builds the APK against `https://agrifair-api.onrender.com/api` whenever `mobile/` changes on `main`, and commits it to `frontend/public/downloads/AgriFair.apk`. To rebuild by hand, or for a different API URL, open GitHub → **Actions** → **Build Android APK** → **Run workflow**.

**Or build on your computer.** You need Flutter and the Android SDK.

```powershell
cd mobile
powershell -ExecutionPolicy Bypass -File tool\build_release_apk.ps1 https://<your-service>.onrender.com/api
```

On macOS or Linux: `./tool/build_release_apk.sh https://<your-service>.onrender.com/api`

The script builds a release APK and copies it to `frontend/public/downloads/AgriFair.apk`. Commit and push it, and Vercel serves the new build from the website's download button.

Rebuild the APK whenever the API URL changes. The current `AgriFair.apk` in the repository was built before hosting, so replace it.

## 5. Online payment: PayMongo sandbox (optional)

A payment gateway demo. In test mode PayMongo shows its real checkout page (GCash, Maya, card), but no money moves. Present it as **payment gateway integration (sandbox)**. Cash on delivery and paying the seller's GCash directly are the app's real payment methods.

1. Sign up at dashboard.paymongo.com. Test mode works right away; no business documents needed.
2. Go to **Developers → API Keys** and copy the **secret** test key (`sk_test_...`). Never use the public key here.
3. On Render, set `PAYMONGO_SECRET_KEY` to it. Render redeploys.
4. Optional webhook, so payments are recorded even if the buyer never returns to the app: in **Developers → Webhooks**, add `https://<your-service>.onrender.com/api/payments/paymongo/webhook` with the event `checkout_session.payment.paid`. Copy its secret (`whsk_...`) into `PAYMONGO_WEBHOOK_SECRET` on Render.

How it runs:
1. In the app, the buyer chooses **Pay online (PayMongo sandbox)** and places the order.
2. PayMongo's page opens. The buyer picks GCash or Maya and taps **Authorize Test Payment**, or pays by card with test card `4343 4343 4343 4345`, any future expiry date and any CVC.
3. PayMongo returns the buyer to `<APP_URL>/payment/done`, which sends them back to the app.
4. The app asks the server, which asks PayMongo, and the order shows **Paid**. The seller is notified and can accept it. Sellers can't accept a PayMongo order before it's paid.

Keep the secret key on Render only. It is never committed: `.env` is ignored by git, and the repository holds `PAYMONGO_SECRET_KEY=` empty in `.env.example`. If a key was ever pasted somewhere public, regenerate it in **Developers → API Keys**. Before going live, switch to live keys only after PayMongo approves the business, and test again.

What the server guarantees:
- A PayMongo order is marked paid only by PayMongo's own answer (the app's check, or the signed webhook), never by the seller and never by the client.
- The amount PayMongo collected must equal the order total, or the order stays unpaid and the seller is told.
- Paying twice (the webhook and the app's check arriving together) records it once. Opening a new payment page expires the old one.
- Paid on a page left open after the order was cancelled: recorded, and marked as a refund owed.

## 6. Automatic completion (scheduled job)

A delivered order closes itself **7 days after delivery** when it has a delivery photo, is paid, and has no open cancellation request or reported problem. The API runs this on start and every hour. A free Render instance sleeps when idle, so a GitHub Actions schedule (`.github/workflows/auto-complete.yml`) also wakes it once a day:

1. On Render, `CRON_SECRET` is generated by the blueprint (or set any long random value yourself).
2. In GitHub, **Settings → Secrets and variables → Actions**, add `API_URL` (`https://<your-service>.onrender.com`, no trailing slash) and `CRON_SECRET` (the same value).
3. Run it once from the **Actions** tab (**Run workflow**) to check: it prints `{"checked":…,"completed":…}`.

Without the two secrets the workflow skips itself; the hourly run inside the API still works while the instance is awake.

## Checklist after deploying

- [ ] `https://<api>/api` answers.
- [ ] The website loads and you can sign in. If you see a CORS error, `CORS_ORIGINS` doesn't exactly match the Vercel URL: it must be `https`, with no trailing slash.
- [ ] Signing up sends an OTP email.
- [ ] The APK downloaded from the website signs in and shows products.
- [ ] A rider's activation email links to the Vercel site (`APP_URL`).
- [ ] A new seller can sign in on the website, sees only their application, and the shop opens after a Super Admin verifies a permit and approves it.
- [ ] The **Auto-complete delivered orders** workflow runs green from the Actions tab.
