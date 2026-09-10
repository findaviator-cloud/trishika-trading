/**
 * ema_confirmation.js
 * Informational-only completed-1D EMA(200) confirmation overlay.
 *
 * Does NOT affect entry/exit logic in donchian.js or any automated
 * execution — this only adds a label to the signal payload so a human
 * can see whether the 1H Donchian signal agrees with the daily trend.
 * See backtest-spec.md Sections 3, 9-13, 15 for the evidence behind
 * these per-symbol decisions.
 *
 *   BTC, BNB — strong OOS evidence, confirmation shown normally
 *   ETH      — evidence supports it, but with a documented tail-risk
 *              caution (Fold 02 finding — large missed reversal trades)
 *   SOL      — evidence does NOT support it — confirmation intentionally
 *              suppressed (always 'N/A')
 *   Everything else (forex, F&O) — insufficient backtest depth, 'N/A'
 *
 * Daily candles are fetched from Twelve Data through the repository-wide
 * shared limiter. EMA(200) uses only FULLY COMPLETED UTC daily candles;
 * a current UTC-day bar is excluded before computing.
 *
 * CIRCUIT BREAKER: if provider calls fail repeatedly, retries are blocked
 * for a cooldown window instead of consuming shared Twelve Data capacity
 * on every monitor cycle. See dashboard/lib/ema-confirmation-circuit-breaker.cjs.
 */
import { CONFIG } from '../config/index.js';
import { fetchTwelveDataJson } from '../services/twelve_data_rate_limiter.js';
import {
  isBlocked,
  recordFailure,
  recordSuccess,
} from '../../dashboard/lib/ema-confirmation-circuit-breaker.cjs';

const EMA_LEN = 200; // locked, no parameter sweep — spec Section 3
const DAY_MS = 86_400_000;

// Symbol -> Twelve Data pair + whether confirmation is enabled for it.
// Enabled policy and evidence notes are intentionally unchanged.
const CONFIRMATION_CONFIG = {
  BTC: { pair: 'BTC/USD', enabled: true, note: null },
  BNB: {
    pair: 'BNB/USD', enabled: true,
    note: 'Cost-fragile: improvement over baseline shrinks and can turn negative under 3x higher slippage/fees — use tight risk limits.',
  },
  ETH: {
    pair: 'ETH/USD', enabled: true,
    note: 'Historical tail-risk observed on large trend-reversal trades (backtest Fold 02) — verify manually before sizing up.',
  },
  SOL: {
    pair: 'SOL/USD', enabled: false,
    note: 'Backtest evidence does not support this filter for SOL — confirmation suppressed.',
  },
};

// Explicit, always-present safety flag in every signal payload — this
// tool NEVER executes trades on its own. See backtest-spec.md Section 15.
export const AUTOMATION_ALLOWED = false;

const cache = new Map(); // symbol -> { ema, asOfDayUTC, fetchedAt, refreshing, errorNote }

function utcDayBucketFromDateText(datetime) {
  if (typeof datetime !== 'string') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const timeMs = Date.UTC(year, month - 1, day);

  // Reject impossible calendar dates such as 2026-02-30.
  const date = new Date(timeMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timeMs;
}

async function fetchTwelveDataDailyCandles(pair, limit = 260) {
  const key = CONFIG.twelveKey;

  if (!key) {
    throw new Error('Twelve Data key is not configured.');
  }

  const symbol = encodeURIComponent(pair);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=${limit}&apikey=${key}`;

  const parsed = await fetchTwelveDataJson(url);

  if (!parsed || !Array.isArray(parsed.values)) {
    throw new Error('Twelve Data response did not contain daily candle values.');
  }

  const candles = parsed.values
    .map((row) => {
      const timeMs = utcDayBucketFromDateText(row?.datetime);
      const close = Number(row?.close);

      if (timeMs === null || !Number.isFinite(close)) return null;

      return { timeMs, close };
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

function dropIncompleteDailyCandle(candles, nowMs = Date.now()) {
  if (!candles.length) return [];

  const currentBucket = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const last = candles[candles.length - 1];
  const lastBucket = Math.floor(last.timeMs / DAY_MS) * DAY_MS;

  return lastBucket >= currentBucket ? candles.slice(0, -1) : candles;
}

function calcEma(closes, len) {
  if (closes.length < len) return null;
  const k = 2 / (len + 1);
  let ema = closes.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

/**
 * triggerEmaRefresh(symbol)
 * Fire-and-forget background refresh — NEVER blocks the caller.
 * Only re-fetches once per UTC calendar day (EMA(200) daily does not
 * change intraday when calculated from completed daily candles).
 *
 * If provider calls fail repeatedly, the circuit breaker blocks further
 * attempts for a cooldown window to avoid wasting shared API capacity.
 */
export function triggerEmaRefresh(symbol) {
  const cfg = CONFIRMATION_CONFIG[symbol];
  if (!cfg || !cfg.enabled) return;

  if (isBlocked(symbol)) return;

  const todayUTC = Math.floor(Date.now() / DAY_MS);
  const entry = cache.get(symbol);

  if (entry && entry.asOfDayUTC === todayUTC) return;
  if (entry && entry.refreshing) return;

  cache.set(symbol, { ...(entry ?? {}), refreshing: true, errorNote: null });

  fetchTwelveDataDailyCandles(cfg.pair)
    .then((candles) => {
      const completed = dropIncompleteDailyCandle(candles);
      const closes = completed.map((candle) => candle.close);
      const ema = calcEma(closes, EMA_LEN);

      if (ema === null) {
        throw new Error(
          `Insufficient completed daily close data for EMA(${EMA_LEN}): ${closes.length} valid bars.`
        );
      }

      cache.set(symbol, {
        ema,
        asOfDayUTC: todayUTC,
        fetchedAt: Date.now(),
        refreshing: false,
        errorNote: null,
      });

      recordSuccess(symbol);
      console.log(
        `[EMA_CONFIRMATION] ${symbol} refreshed — EMA(200)=${ema.toFixed(2)}`
      );
    })
    .catch((err) => {
      const message = err?.message || String(err);
      console.error(`[EMA_CONFIRMATION] ${symbol} refresh failed:`, message);

      const prev = cache.get(symbol) ?? {};
      cache.set(symbol, {
        ...prev,
        refreshing: false,
        errorNote: `EMA(200) unavailable: ${message}`,
      });

      recordFailure(symbol, message);
    });
}

/**
 * getEmaConfirmation(symbol, direction, currentPrice)
 *   direction: 1 (long-ish signal), -1 (short-ish), 0 (neutral)
 * Returns { label: 'ALIGNED' | 'CONFLICTING' | 'N/A', note, ema }
 */
export function getEmaConfirmation(symbol, direction, currentPrice) {
  const cfg = CONFIRMATION_CONFIG[symbol];

  if (!cfg || !cfg.enabled) {
    return {
      label: 'N/A',
      note: cfg?.note ?? 'Not evaluated for this symbol.',
      ema: null,
    };
  }

  const entry = cache.get(symbol);

  if (!entry || entry.ema == null) {
    return {
      label: 'N/A',
      note: entry?.errorNote ?? 'EMA(200) not yet available — refreshing.',
      ema: null,
    };
  }

  if (direction === 0) {
    return {
      label: 'N/A',
      note: cfg.note,
      ema: +entry.ema.toFixed(2),
    };
  }

  const aligned = direction === 1
    ? currentPrice > entry.ema
    : currentPrice < entry.ema;

  return {
    label: aligned ? 'ALIGNED' : 'CONFLICTING',
    note: cfg.note,
    ema: +entry.ema.toFixed(2),
  };
}
