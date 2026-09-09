import express from 'express';
import { getAngelMarketDataState } from '../angel/index.js';

const router = express.Router();

router.get('/status', (_req, res) => {
  const state = getAngelMarketDataState();

  return res.json({
    ...state,
    meta: {
      ...state.meta,
      updatedAtUtc: new Date().toISOString()
    }
  });
});

export default router;
