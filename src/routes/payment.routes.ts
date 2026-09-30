import { Router } from 'express';
import * as payment from '../services/payment.service.js';

const router = Router();

/** Provider callback / test simulate — no auth (verified by provider ref + amount) */
router.post('/callback', async (req, res, next) => {
  try {
    const data = await payment.handleCallback(req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
