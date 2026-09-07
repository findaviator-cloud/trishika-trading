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
 * Daily candles are fetched from Binance's public REST endpoint (no API
 * key, no shared rate-limit risk with the production Twelve Data key —
 * same source already used for backtesting, see scripts/fetch-historical.js).
 *
 * EMA(200) uses only FULLY COMPLETED daily candles — the in-progress
 * "today" candle is always dropped before computing, matching the
 * backtest's locked rule (spec Section 3: never use the in-progress
 * daily candle).
 */
import https from 'https';

const EMA_LEN = 200; // locked, no parameter sweep — spec Section 3

// symbol -> Binance pair + whether confirmation is enabled for it
const CONFIRMATION_CONFIG = {
  BTC: { pair: 'BTCUSDT', enabled: true, note: null },
  BNB: {
    pair: 'BNBUSDT', enabled: true,
    note: 'Cost-fragile: improvement over baseline shrinks and can turn negative under 3x higher slippage/fees — use tight risk limits.',
  },
  ETH: {
    pair: 'ETHUSDT', enabled: true,
    note: 'Historical tail-risk observed on large trend-reversal trades (backtest Fold 02) — verify manually before sizing up.',
  },
  SOL: {
    pair: 'SOLUSDT', enabled: false,
    note: 'Backtest evidence does not support this filter for SOL — confirmation suppressed.',
  },
};

// Explicit, always-present safety flag in every signal payload — this
// tool NEVER executes trades on its own. See backtest-spec.md Section 15.
export const AUTOMATION_ALLOWED = false;

const cache = new Map(); // symbol -> { ema, asOfDayUTC, fetchedAt, refreshing }
const DAY_MS = 86_400_000;

function fetchBinanceDailyKlines(pair, limit = 250) {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=${limit}`;
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const rows = JSON.parse(data);
          if (!Array.isArray(rows)) return reject(new Error('Unexpected Binance response'));
          resolve(rows.map(r => ({ time: r[0], close: parseFloat(r[4]) })));
        } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Binance daily klines fetch timeout')));
  });
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
 * Only re-fetches once per UTC calendar day (EMA(200) daily doesn't
 * change intraday, no need to hit Binance more often than that).
 */
export function triggerEmaRefresh(symbol) {
  const cfg = CONFIRMATION_CONFIG[symbol];
  if (!cfg || !cfg.enabled) return;

  const todayUTC = Math.floor(Date.now() / DAY_MS);
  const entry = cache.get(symbol);
  if (entry && entry.asOfDayUTC === todayUTC) return; // already fresh for today
  if (entry && entry.refreshing) return; // already in flight

  cache.set(symbol, { ...(entry ?? {}), refreshing: true });

  fetchBinanceDailyKlines(cfg.pair)
    .then(candles => {
      // drop the last candle — it's today's still-forming day, never use it
      const completed = candles.slice(0, -1);
      const closes = completed.map(c => c.close);
      const ema = calcEma(closes, EMA_LEN);
      cache.set(symbol, { ema, asOfDayUTC: todayUTC, fetchedAt: Date.now(), refreshing: false });
      console.log(`[EMA_CONFIRMATION] ${symbol} refreshed — EMA(200)=${ema?.toFixed(2) ?? 'n/a'}`);
    })
    .catch(err => {
      console.error(`[EMA_CONFIRMATION] ${symbol} refresh failed:`, err.message);
      const prev = cache.get(symbol) ?? {};
      cache.set(symbol, { ...prev, refreshing: false });
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
    return { label: 'N/A', note: cfg?.note ?? 'Not evaluated for this symbol.', ema: null };
  }

  const entry = cache.get(symbol);
  if (!entry || entry.ema == null) {
    return { label: 'N/A', note: 'EMA(200) not yet available — refreshing.', ema: null };
  }

  if (direction === 0) {
    return { label: 'N/A', note: cfg.note, ema: +entry.ema.toFixed(2) };
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
