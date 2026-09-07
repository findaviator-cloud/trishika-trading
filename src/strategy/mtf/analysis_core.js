const DAY_MS = 86_400_000;

export const MTF_SYMBOLS = Object.freeze([
  { key: 'BTC_USD', market: 'CRYPTO', providerSymbol: 'BTC/USD', display: 'BTC/USD' },
  { key: 'ETH_USD', market: 'CRYPTO', providerSymbol: 'ETH/USD', display: 'ETH/USD' },
  { key: 'SOL_USD', market: 'CRYPTO', providerSymbol: 'SOL/USD', display: 'SOL/USD' },
  { key: 'BNB_USD', market: 'CRYPTO', providerSymbol: 'BNB/USD', display: 'BNB/USD' },
  { key: 'EUR_USD', market: 'FOREX', providerSymbol: 'EUR/USD', display: 'EUR/USD' },
  { key: 'XAU_USD', market: 'FOREX', providerSymbol: 'XAU/USD', display: 'XAU/USD' },
]);

export const MTF_TIMEFRAMES = Object.freeze([
  { key: '1h', providerInterval: '1h', outputSize: 260, minBars: 221 },
  { key: '4h', providerInterval: '4h', outputSize: 260, minBars: 221 },
  { key: '1d', providerInterval: '1day', outputSize: 260, minBars: 221 },
]);

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeCandles(values) {
  if (!Array.isArray(values)) return [];

  const candles = values
    .map((row) => {
      const open = num(row.open);
      const high = num(row.high);
      const low = num(row.low);
      const close = num(row.close);
      const timeMs = Date.parse(`${row.datetime ?? row.date ?? ''}Z`);

      if (
        !Number.isFinite(timeMs) ||
        open === null ||
        high === null ||
        low === null ||
        close === null ||
        high < low
      ) return null;

      return {
        timeMs,
        open,
        high,
        low,
        close,
        volume: num(row.volume),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeMs - b.timeMs);

  const deduped = [];
  for (const candle of candles) {
    if (!deduped.length || deduped[deduped.length - 1].timeMs !== candle.timeMs) {
      deduped.push(candle);
    }
  }

  return deduped;
}

export function dropIncompleteCandle(candles, timeframe, nowMs = Date.now()) {
  if (!candles.length) return [];

  const last = candles[candles.length - 1];
  const bucketMs = timeframe === '1h'
    ? 3_600_000
    : timeframe === '4h'
      ? 14_400_000
      : DAY_MS;

  const currentBucket = Math.floor(nowMs / bucketMs) * bucketMs;
  const lastBucket = Math.floor(last.timeMs / bucketMs) * bucketMs;

  return lastBucket >= currentBucket ? candles.slice(0, -1) : candles.slice();
}

function sma(values, length) {
  if (values.length < length) return null;
  const tail = values.slice(-length);
  return tail.reduce((sum, value) => sum + value, 0) / length;
}

function atr(candles, length = 14) {
  if (candles.length < length + 1) return null;

  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }

  return sma(ranges, length);
}

function donchian(candles, length = 20) {
  if (candles.length < length + 1) return null;

  const lookback = candles.slice(-(length + 1), -1);
  return {
    high: Math.max(...lookback.map((candle) => candle.high)),
    low: Math.min(...lookback.map((candle) => candle.low)),
  };
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function analyzeTimeframe({ symbol, timeframe, candles, source, nowMs = Date.now() }) {
  const completed = dropIncompleteCandle(candles, timeframe, nowMs);
  const last = completed[completed.length - 1];
  const closes = completed.map((candle) => candle.close);
  const channel = donchian(completed, 20);
  const atrValue = atr(completed, 14);
  const sma200 = sma(closes, 200);

  if (!last || !channel || atrValue === null || sma200 === null) {
    return {
      meta: {
        schemaVersion: 1,
        market: symbol.market,
        symbol: symbol.display,
        key: symbol.key,
        timeframe,
        generatedAtUtc: new Date(nowMs).toISOString(),
        candleClosedAtUtc: last ? new Date(last.timeMs).toISOString() : null,
        source,
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false,
        dataQuality: 'INSUFFICIENT_HISTORY',
      },
      signal: {
        bias: 'NEUTRAL',
        direction: 0,
        confidence: 0,
        reason: `Insufficient completed candle history for ${timeframe} analysis.`,
        stopPrice: null,
      },
      price: { last: last ? round(last.close) : null },
      indicators: {},
    };
  }

  let bias = 'NEUTRAL';
  let direction = 0;
  let reason = `No breakout. Donchian range [${round(channel.low)}, ${round(channel.high)}].`;
  let stopPrice = null;
  let confidence = 40;

  if (last.close > channel.high) {
    bias = 'LONG_BIAS';
    direction = 1;
    confidence = last.close > sma200 ? 72 : 60;
    stopPrice = last.close - (2 * atrValue);
    reason = `Closed above Donchian high ${round(channel.high)}.`;
  } else if (last.close < channel.low) {
    bias = 'SHORT_BIAS';
    direction = -1;
    confidence = last.close < sma200 ? 72 : 60;
    stopPrice = last.close + (2 * atrValue);
    reason = `Closed below Donchian low ${round(channel.low)}.`;
  }

  const candleAgeMs = Math.max(0, nowMs - last.timeMs);
  const maxFreshMs = timeframe === '1h'
    ? 3 * 3_600_000
    : timeframe === '4h'
      ? 3 * 14_400_000
      : 3 * DAY_MS;

  const dataQuality = candleAgeMs > maxFreshMs ? 'STALE' : 'OK';

  return {
    meta: {
      schemaVersion: 1,
      market: symbol.market,
      symbol: symbol.display,
      key: symbol.key,
      timeframe,
      generatedAtUtc: new Date(nowMs).toISOString(),
      candleClosedAtUtc: new Date(last.timeMs).toISOString(),
      source,
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false,
      dataQuality,
    },
    price: {
      last: round(last.close),
      atr: round(atrValue),
    },
    signal: {
      bias,
      direction,
      confidence,
      reason,
      stopPrice: round(stopPrice),
    },
    indicators: {
      donchianHigh: round(channel.high),
      donchianLow: round(channel.low),
      atr: round(atrValue),
      sma200: round(sma200),
      trendContext: last.close > sma200 ? 'ABOVE_SMA200' : 'BELOW_SMA200',
    },
  };
}

export function buildSummary({ symbol, snapshots, nowMs = Date.now() }) {
  const ordered = ['1h', '4h', '1d'];
  const items = ordered
    .map((timeframe) => snapshots[timeframe])
    .filter(Boolean);

  const longCount = items.filter((item) => item.signal?.bias === 'LONG_BIAS').length;
  const shortCount = items.filter((item) => item.signal?.bias === 'SHORT_BIAS').length;
  const nonNeutralCount = longCount + shortCount;
  const quality = items.every((item) => item.meta?.dataQuality === 'OK')
    ? 'OK'
    : items.some((item) => item.meta?.dataQuality === 'STALE')
      ? 'STALE'
      : 'PARTIAL';

  let alignment = 'NEUTRAL';
  if (longCount === ordered.length) alignment = 'BULLISH_ALIGNMENT';
  else if (shortCount === ordered.length) alignment = 'BEARISH_ALIGNMENT';
  else if (nonNeutralCount > 0) alignment = 'MIXED';

  return {
    meta: {
      schemaVersion: 1,
      market: symbol.market,
      symbol: symbol.display,
      key: symbol.key,
      generatedAtUtc: new Date(nowMs).toISOString(),
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false,
      dataQuality: quality,
    },
    summary: {
      alignment,
      longBiasCount: longCount,
      shortBiasCount: shortCount,
      neutralCount: ordered.length - nonNeutralCount,
      reason: alignment === 'BULLISH_ALIGNMENT'
        ? 'All monitored timeframes show LONG_BIAS.'
        : alignment === 'BEARISH_ALIGNMENT'
          ? 'All monitored timeframes show SHORT_BIAS.'
          : alignment === 'MIXED'
            ? 'Timeframes disagree or only part of the stack has a directional bias.'
            : 'No monitored timeframe has a directional breakout bias.',
    },
    timeframes: Object.fromEntries(
      ordered.map((timeframe) => {
        const item = snapshots[timeframe];
        return [timeframe, item
          ? {
              bias: item.signal?.bias ?? 'NEUTRAL',
              confidence: item.signal?.confidence ?? 0,
              dataQuality: item.meta?.dataQuality ?? 'N_A',
              candleClosedAtUtc: item.meta?.candleClosedAtUtc ?? null,
            }
          : {
              bias: 'NEUTRAL',
              confidence: 0,
              dataQuality: 'N_A',
              candleClosedAtUtc: null,
            }];
      }),
    ),
  };
}
