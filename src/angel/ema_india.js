// India daily EMA(200) overlay for NIFTY / BANKNIFTY / SENSEX (informational only).
// Same logic as crypto: only COMPLETED daily candles, EMA(200), ALIGNED / CONFLICTING / N/A.
// NOT backtest-validated for India -> labelled UNVALIDATED. Never affects signals/execution.
import { fetchAngelHistoricalCandles } from './index.js';

export const INDIA_EMA_SYMBOLS = new Set(['NIFTY', 'BANKNIFTY', 'SENSEX']);
const EMA_LEN = 200;
const IST_MS = 5.5 * 3_600_000;
const NOTE = 'UNVALIDATED for India (no backtest depth) — informational daily-trend label only; do not treat as extra edge.';
const cache = new Map(); // symbol -> { ema, istDay, errorNote, refreshing }

export function calcEma(closes, len = EMA_LEN) {
  if (closes.length < len) return null;
  const k = 2 / (len + 1);
  let ema = closes.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

export function istDay(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
const istStr = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 16).replace('T', ' ');

// Drop today's bar unless the session is over (>= 16:00 IST).
export function completedDaily(rows, nowMs = Date.now()) {
  const today = istDay(nowMs);
  const mins = new Date(nowMs + IST_MS).getUTCHours() * 60 + new Date(nowMs + IST_MS).getUTCMinutes();
  return [...rows].sort((a, b) => a.time - b.time)
    .filter((r) => istDay(r.time) < today || (istDay(r.time) === today && mins >= 16 * 60));
}

export async function refreshIndiaEma(symbol, livePrice, log = console, { fetcher = fetchAngelHistoricalCandles, nowMs = Date.now(), onUpdated } = {}) {
  if (!INDIA_EMA_SYMBOLS.has(symbol)) return { ok: false, reason: 'not india' };
  const prev = cache.get(symbol) ?? {};
  if (prev.istDay === istDay(nowMs) && prev.ema != null) return { ok: true, cached: true };
  if (prev.refreshing) return { ok: false, reason: 'busy' };
  cache.set(symbol, { ...prev, refreshing: true });
  try {
    const res = await fetcher({ instrumentKey: symbol, interval: 'ONE_DAY', fromdate: istStr(nowMs - 430 * 86_400_000), todate: istStr(nowMs) });
    const done = completedDaily(res?.candles || [], nowMs);
    const ema = calcEma(done.map((c) => c.close));
    if (ema == null) throw new Error(`only ${done.length} completed daily bars (need ${EMA_LEN})`);
    const lastClose = done[done.length - 1].close;
    if (Number.isFinite(livePrice) && livePrice > 0 && Math.abs(lastClose - livePrice) / livePrice > 0.08) {
      throw new Error(`daily close ${lastClose} vs live ${livePrice} too far apart — token looks wrong`);
    }
    cache.set(symbol, { ema, istDay: istDay(nowMs), errorNote: null, refreshing: false });
    log.info(`[EMA_CONFIRMATION] ${symbol} (India) refreshed — EMA(200)=${ema.toFixed(2)} from ${done.length} daily bars. UNVALIDATED overlay.`);
    if (onUpdated) onUpdated();
    return { ok: true, ema };
  } catch (e) {
    cache.set(symbol, { ...prev, refreshing: false, errorNote: `EMA(200) unavailable: ${e.message}` });
    log.warn(`[EMA_CONFIRMATION] ${symbol} (India) failed: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

export function getIndiaEmaConfirmation(symbol, direction, price) {
  const e = cache.get(symbol);
  if (!e || e.ema == null) return { label: 'N/A', note: e?.errorNote ?? 'EMA(200) not yet available — refreshing.', ema: null };
  const ema = +e.ema.toFixed(2);
  if (direction === 0) return { label: 'N/A', note: NOTE, ema };
  const aligned = direction === 1 ? price > e.ema : price < e.ema;
  return { label: aligned ? 'ALIGNED' : 'CONFLICTING', note: NOTE, ema };
}
