import express from 'express';
import * as paymongo from '../services/paymongoService.js';

/**
 * PayMongo's webhook. Mounted before express.json() in index.js, because the
 * signature is computed over the exact bytes PayMongo sent.
 *
 * Optional: without PAYMONGO_WEBHOOK_SECRET the app's own "check payment"
 * call is what marks orders paid.
 */
const router = express.Router();

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res, next) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!paymongo.verifySignature(raw, req.get('paymongo-signature'))) {
      return res.status(401).json({ error: 'Bad signature' });
    }

    const result = await paymongo.handleWebhook(JSON.parse(raw));
    return res.json({ received: true, ...result });
  } catch (err) {
    return next(err);
  }
});

export default router;
