// Angel One history bootstrap (research-only, no orders, executionAllowed=false).
// Loads recent 5-minute candles, aggregates them to the engine's candle size
// (CANDLE_MS, default 20 min) and hands them to CandleEngine.loadCandles().
// A token-mismatch guard compares the last history close with the live tick price.
import { fetchAngelHistoricalCandles } from './index.js';

const FIVE_MIN_MS = 5 * 60_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const KEYS = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

const enabled = () =>
  process.env.ENABLE_ANGEL_ONE_WS === 'true' &&
  process.env.ANGEL_ONE_HISTORICAL_ENABLED === 'true';

export function istString(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

export function aggregateCandles(rows, bucketMs, nowMs = Date.now(), skipFromMs = Infinity) {
  if (!Number.isFinite(bucketMs) || bucketMs < FIVE_MIN_MS || bucketMs % FIVE_MIN_MS !== 0) {
    throw new Error(`Candle size ${bucketMs}ms is not a multiple of 5 minutes.`);
  }
  const limit = Math.min(Math.floor(nowMs / bucketMs) * bucketMs, skipFromMs);
  const map = new Map();
  for (const r of [...rows].sort((a, b) => a.time - b.time)) {
    const t = Math.floor(r.time / bucketMs) * bucketMs;
    if (t >= limit) continue; // still-forming bucket: live ticks own it
    const c = map.get(t);
    if (!c) map.set(t, { time: t, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });
    else {
      c.high = Math.max(c.high, r.high);
      c.low = Math.min(c.low, r.low);
      c.close = r.close;
      c.volume += r.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export async function loadOne(engines, key, log, { fetcher = fetchAngelHistoricalCandles, nowMs = Date.now() } = {}) {
  const engine = engines?.[key];
  if (!engine) return { key, ok: false, reason: 'no engine' };

  const live = engine.currentCandle?.close;
  if (!Number.isFinite(live) || live <= 0) {
    return { key, ok: false, retry: true, reason: 'no live tick yet (price check needs it)' };
  }

  const res = await fetcher({
    instrumentKey: key,
    interval: 'FIVE_MINUTE',
    fromdate: istString(nowMs - 21 * 86_400_000),
    todate: istString(nowMs)
  });

  const rows = res?.candles || [];
  const candles = aggregateCandles(rows, engine.candleMs, nowMs, engine.currentCandle?.time);
  if (candles.length < 5) return { key, ok: false, reason: `only ${candles.length} candles returned` };

  const last = candles[candles.length - 1].close;
  const diff = Math.abs(last - live) / live;
  if (diff > 0.05) {
    log.warn(`[ANGEL/HISTORY] ${key} REJECTED: history close ${last} vs live ${live} (${(diff * 100).toFixed(1)}% apart) — token/segment looks wrong.`);
    return { key, ok: false, reason: 'price mismatch' };
  }

  engine.loadCandles(candles);
  log.info(`[ANGEL/HISTORY] ${key} loaded ${engine.candles.length} candles (${engine.candleMs / 60000}m), last close ${last}. Research only.`);
  return { key, ok: true, count: engine.candles.length };
}

export function startAngelHistoryLoader(engines, log = console, { firstDelayMs = 60_000, refreshMs = 4 * 3_600_000 } = {}) {
  if (!enabled()) {
    log.info('[ANGEL/HISTORY] Disabled (needs ENABLE_ANGEL_ONE_WS=true and ANGEL_ONE_HISTORICAL_ENABLED=true).');
    return;
  }

  async function cycle(attempt = 1) {
    const retry = [];
    for (const key of KEYS) {
      try {
        const r = await loadOne(engines, key, log);
        if (r.retry) retry.push(key);
        else if (!r.ok) log.warn(`[ANGEL/HISTORY] ${key} not loaded: ${r.reason}`);
      } catch (e) {
        log.warn(`[ANGEL/HISTORY] ${key} failed: ${e.message}`);
        if (/cooldown|rate/i.test(e.message)) break; // do not hammer Angel
      }
    }
    if (retry.length && attempt < 5) setTimeout(() => cycle(attempt + 1), 90_000);
  }

  setTimeout(() => void cycle(), firstDelayMs);
  setInterval(() => void cycle(), refreshMs);
}
