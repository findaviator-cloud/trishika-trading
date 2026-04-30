/**
 * donchian.js
 * Pure Donchian breakout + ATR trailing stop signal.
 *
 * Config (production-validated on BTCUSDT/ETHUSDT/SOLUSDT/BNBUSDT 1h):
 *   donchianLen = 30
 *   atrLen      = 14
 *   atrMult     = 2.0
 *   smaLen      = 200  (regime gate)
 *   allowLong   = true
 *   allowShort  = true
 *
 * Returns:
 *   { signal, direction, confidence, reason, donchianHigh, donchianLow,
 *     atr, sma, price, stopPrice }
 */

// ── Wilder RMA (matches Python engine exactly) ────────────────────────────────
function rma(values, period) {
  if (values.length < period) return null;
  let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    r = (r * (period - 1) + values[i]) / period;
  }
  return r;
}

function calcATR(candles, period) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return rma(trs, period);
}

function calcSMA(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function donchianSignal(candles, opts = {}) {
  const {
    donchianLen = 30,
    atrLen      = 14,
    atrMult     = 2.0,
    smaLen      = 200,
    allowLong   = true,
    allowShort  = true,
  } = opts;

  const minBars = Math.max(donchianLen, atrLen, smaLen) + 2;
  if (!candles || candles.length < minBars) {
    return { signal: 'NEUTRAL', direction: 0, confidence: 0,
             reason: `Need ${minBars} candles, have ${candles?.length ?? 0}` };
  }

  // prev = second-to-last closed bar (last bar may be incomplete)
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  // Donchian bands (shift(1).rolling — exclude current bar)
  // shift(1).rolling(donchianLen): window of donchianLen bars ending at prev's predecessor
  const lookback = candles.slice(-(donchianLen + 2), -2);
  const donchianHigh = Math.max(...lookback.map(c => c.high));
  const donchianLow  = Math.min(...lookback.map(c => c.low));

  // ATR (Wilder RMA on true range)
  const atr = calcATR(candles.slice(0, -1), atrLen);

  // SMA regime gate
  const closes = candles.map(c => c.close);
  const sma    = calcSMA(closes.slice(0, -1), smaLen);

  if (atr === null) {
    return { signal: 'NEUTRAL', direction: 0, confidence: 0,
             reason: 'ATR not ready' };
  }

  const price      = curr.open;   // next-bar open (current bar's open)
  const aboveSMA   = sma === null || prev.close > sma;
  const belowSMA   = sma === null || prev.close < sma;

  const longBreak  = prev.high > donchianHigh;
  const shortBreak = prev.low  < donchianLow;

  const longOK  = allowLong  && longBreak  && aboveSMA;
  const shortOK = allowShort && shortBreak && belowSMA;

  if (longOK) {
    const stopPrice = price - atrMult * atr;
    return {
      signal:       'LONG',
      direction:    1,
      confidence:   72,
      reason:       `Donchian upper breakout above ${donchianHigh.toFixed(2)}, ATR stop ${stopPrice.toFixed(2)}`,
      donchianHigh, donchianLow,
      atr:          +atr.toFixed(4),
      sma:          sma ? +sma.toFixed(2) : null,
      price:        +price.toFixed(2),
      stopPrice:    +stopPrice.toFixed(2),
    };
  }

  if (shortOK) {
    const stopPrice = price + atrMult * atr;
    return {
      signal:       'SHORT',
      direction:    -1,
      confidence:   72,
      reason:       `Donchian lower breakdown below ${donchianLow.toFixed(2)}, ATR stop ${stopPrice.toFixed(2)}`,
      donchianHigh, donchianLow,
      atr:          +atr.toFixed(4),
      sma:          sma ? +sma.toFixed(2) : null,
      price:        +price.toFixed(2),
      stopPrice:    +stopPrice.toFixed(2),
    };
  }

  return {
    signal:    'NEUTRAL',
    direction: 0,
    confidence: 40,
    reason:    `No breakout. Donchian range [${donchianLow.toFixed(2)}, ${donchianHigh.toFixed(2)}]`,
    donchianHigh, donchianLow,
    atr:       +atr.toFixed(4),
    sma:       sma ? +sma.toFixed(2) : null,
    price:     +curr.close.toFixed(2),
    stopPrice: null,
  };
}
