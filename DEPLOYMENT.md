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

The app does not look for a server: the API URL is compiled into it. Build it once the API is live. You need Flutter and the Android SDK on your computer.

```powershell
cd mobile
powershell -ExecutionPolicy Bypass -File tool\build_release_apk.ps1 https://<your-service>.onrender.com/api
```

On macOS or Linux: `./tool/build_release_apk.sh https://<your-service>.onrender.com/api`

The script builds a release APK and copies it to `frontend/public/downloads/AgriFair.apk`. Commit and push it, and Vercel serves the new build from the website's download button.

Rebuild the APK whenever the API URL changes. The current `AgriFair.apk` in the repository was built before hosting, so replace it.

## Checklist after deploying

- [ ] `https://<api>/api` answers.
- [ ] The website loads and you can sign in. If you see a CORS error, `CORS_ORIGINS` doesn't exactly match the Vercel URL: it must be `https`, with no trailing slash.
- [ ] Signing up sends an OTP email.
- [ ] The APK downloaded from the website signs in and shows products.
- [ ] A rider's activation email links to the Vercel site (`APP_URL`).
