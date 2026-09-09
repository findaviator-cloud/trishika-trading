import express from 'express';
import cryptoRouter from './crypto.js';
import indiaRouter from './india.js';
import forexRouter, { setForexRouteEngines } from './forex.js';
import candlesRouter, { setCandleRouteEngines } from './candles.js';
import historyRouter from './history.js';
import mtfRouter from './mtf.js';
import angelRouter from './angel.js';

const router = express.Router();

export function setRouteEngines(engines) {
  setCandleRouteEngines(engines);
  setForexRouteEngines(engines);
}

router.use('/crypto', cryptoRouter);
router.use('/india', indiaRouter);
router.use('/forex', forexRouter);
router.use('/candles', candlesRouter);
router.use('/history', historyRouter);
router.use('/mtf', mtfRouter);
router.use('/angel', angelRouter);

export default router;
