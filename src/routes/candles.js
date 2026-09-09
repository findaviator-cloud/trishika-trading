import express from 'express';
import {
  normalizeLiveSymbol
} from '../candle/index.js';
import { getSignal } from '../strategy/signal_store.js';

const router = express.Router();

const SIGNAL_FILE = Object.freeze({
  BTC: 'BTC_USD.json',
  ETH: 'ETH_USD.json',
  SOL: 'SOL_USD.json',
  BNB: 'BNB_USD.json',
  EUR_USD: 'EUR_USD.json',
  XAU_USD: 'XAU_USD.json',
  NIFTY: 'NIFTY.json',
  BANKNIFTY: 'BANKNIFTY.json',
  SENSEX: 'SENSEX.json'
});

let engines = null;

export function setCandleRouteEngines(nextEngines) {
  engines = nextEngines;
}

function toAnalysis(payload) {
  if (!payload) return null;

  return {
    signal: payload.signal?.action ?? 'NEUTRAL',
    confidence: payload.signal?.confidence ?? 0,
    reason: payload.signal?.reason ?? '',
    stopPrice: payload.signal?.stopPrice ?? null,
    direction: payload.signal?.direction ?? 0,
    _source: 'Donchian-ATR',
    timestamp: payload.meta?.asOf
      ? new Date(payload.meta.asOf).getTime()
      : null,
    indicators: payload.indicators ?? {},
    price: payload.price ?? null,
    meta: payload.meta ?? null
  };
}

router.get('/:symbol', (req, res) => {
  const requestedSymbol = String(req.params.symbol ?? '');
  const symbol = normalizeLiveSymbol(requestedSymbol);
  const engine = engines?.[symbol] ?? null;
  const signalFile = SIGNAL_FILE[symbol];
  const payload = signalFile ? getSignal(signalFile) : null;
  const analysis = toAnalysis(payload);

  return res.json({
    symbol,
    requestedSymbol,
    source: engine?.source ?? null,
    candleMs: engine?.candleMs ?? null,
    current: engine?.currentCandle ?? null,
    candles: Array.isArray(engine?.candles) ? engine.candles : [],
    analysis,
    indicators: analysis?.indicators ?? {},
    available: Boolean(engine),
    candleCount: Array.isArray(engine?.candles)
      ? engine.candles.length
      : 0
  });
});

export default router;
