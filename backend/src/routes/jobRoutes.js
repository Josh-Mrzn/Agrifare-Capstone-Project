import express from 'express';
import crypto from 'crypto';
import { runAutoComplete } from '../jobs/autoComplete.js';

const router = express.Router();

/**
 * For a scheduler outside the server (GitHub Actions, cron-job.org) to wake
 * the job when the host was asleep. Needs the CRON_SECRET in the
 * `x-cron-secret` header; without CRON_SECRET set on the server the route
 * does not exist.
 */
function cronOnly(req, res, next) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return res.status(404).json({ message: 'Not found' });
  const given = Buffer.from(String(req.get('x-cron-secret') || ''));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  return next();
}

router.post('/auto-complete', cronOnly, async (req, res) => {
  res.json(await runAutoComplete());
});

export default router;
