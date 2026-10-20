import path from 'path';
import express from 'express';
import { notFoundHandler, errorHandler } from './middleware/errorMiddleware.js';
import routes from './routes/index.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import chatRoutes from './routes/chatRoutes.js';
import paymongoWebhook from './routes/paymongoWebhook.js';
import jobRoutes from './routes/jobRoutes.js';
import { findStored, sendStored } from './middleware/multerMiddleware.js';
import { isVercelOrigin } from './utils/corsOrigins.js';

/**
 * The Express app, without a database connection or a listening port, so the
 * tests can drive it directly. src/index.js connects and listens.
 */
const app = express();
// The host (Render, Railway) puts one proxy in front of the app. Without this every request looks
// like it came from that proxy, so the rate limiters counted all users as one
// and five code requests from anyone locked everyone out for 15 minutes.
app.set('trust proxy', 1);

// ====================== CORS (PUT FIRST) ======================
// Vite falls back to 5174, 5175, ... when its default port is taken, so pinning a
// single origin here silently breaks the app with an opaque "cannot reach server".
// Allow any loopback origin in development; use CORS_ORIGINS in production.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isLoopbackOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

// The laptop's own address on home/school Wi-Fi, so the web app opened from a
// phone during development can reach the API. Development only, like loopback.
const isPrivateLanOrigin = (origin) =>
  /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin);

export const corsOrigin = (origin, callback) => {
  // Same-origin / curl / mobile apps send no Origin header.
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (isVercelOrigin(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== 'production'
    && (isLoopbackOrigin(origin) || isPrivateLanOrigin(origin))) {
    return callback(null, true);
  }
  console.warn('[cors] blocked origin:', origin);
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
};

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  // Lets the web app read the file name of a downloaded report.
  exposedHeaders: ['Content-Disposition'],
}));
app.get('/test', (req, res) => res.send('Server is alive!'));

// ====================== MIDDLEWARE ======================
// Before express.json(): the webhook signature covers the raw body.
app.use('/api/payments/paymongo/webhook', paymongoWebhook);
app.use(express.json());
app.use(cookieParser());
// Public uploads (product photos, avatars). Credentials are in the private
// bucket and reachable only through the authenticated /api/files route.
// Names are random and never reused, so browsers may cache them for good.
app.get('/uploads/media/:filename', async (req, res, next) => {
  try {
    const file = await findStored('media', path.basename(req.params.filename));
    if (!file) return res.status(404).end();
    sendStored('media', file, res, 'public, max-age=31536000, immutable');
  } catch (err) {
    next(err);
  }
});

// ====================== ROUTES ======================
app.use('/api', routes);
app.use('/api/jobs', jobRoutes);
app.use('/api/chat', chatRoutes);

// ====================== ERRORS ======================
// Must sit after every route: Express matches these only once nothing else has.
app.use('/api', notFoundHandler);
app.use(errorHandler);

export default app;
