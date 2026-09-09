import express from 'express';
import { normalizeLiveSymbol } from '../candle/index.js';
import { getSignal } from '../strategy/signal_store.js';

const router = express.Router();

const FOREX_SIGNAL_FILE = Object.freeze({
  EUR_USD: 'EUR_USD.json',
  XAU_USD: 'XAU_USD.json'
});

let engines = null;

export function setForexRouteEngines(nextEngines) {
  engines = nextEngines;
}

function buildFallback(symbol, engine) {
  return {
    symbol,
    signal: 'NEUTRAL',
    confidence: 0,
    reason: engine
      ? 'Forex/Gold history is loading or no closed-candle analysis is available yet.'
      : 'Unknown Forex/Gold symbol.',
    agent: 'System',
    _source: 'LIVE_ENGINE_PENDING',
    available: Boolean(engine),
    candleCount: Array.isArray(engine?.candles) ? engine.candles.length : 0,
    source: engine?.source ?? null,
    indicators: {
      symbol,
      regime: 'UNKNOWN',
      overallTrend: 'UNKNOWN',
      rsi: null,
      emaFast: null,
      emaSlow: null,
      atr: null,
      atrRegimeOK: null,
      volFilter: null,
      igsGrade: null,
      igsAction: 'WAIT',
      rrRatio: null,
      session: 'ACTIVE',
      price: engine?.currentCandle?.close ?? engine?.candles?.at(-1)?.close ?? null
    }
  };
}

router.get('/signal', (req, res) => {
  const symbol = normalizeLiveSymbol(req.query.symbol || 'EUR_USD');

  if (!FOREX_SIGNAL_FILE[symbol]) {
    return res.status(404).json({
      error: `Unknown Forex/Gold symbol: ${symbol}`,
      supportedSymbols: Object.keys(FOREX_SIGNAL_FILE)
    });
  }

  const engine = engines?.[symbol] ?? null;
  const payload = getSignal(FOREX_SIGNAL_FILE[symbol]);

  if (!payload) {
    return res.json(buildFallback(symbol, engine));
  }

  return res.json({
    symbol,
    signal: payload.signal?.action ?? 'NEUTRAL',
    confidence: payload.signal?.confidence ?? 0,
    reason: payload.signal?.reason ?? '',
    agent: 'System',
    _source: 'Donchian-ATR',
    available: Boolean(engine),
    candleCount: Array.isArray(engine?.candles) ? engine.candles.length : 0,
    source: engine?.source ?? null,
    price:
      engine?.currentCandle?.close ??
      engine?.candles?.at(-1)?.close ??
      payload.price?.last ??
      null,
    stopPrice: payload.signal?.stopPrice ?? null,
    direction: payload.signal?.direction ?? 0,
    indicators: payload.indicators ?? {},
    meta: payload.meta ?? null
  });
});

export default router;
