/**
 * live_signal_writer.js
 * Runs Donchian strategy on closed candles and writes to signals_live/.
 *
 * Two pipelines:
 *   1. Hourly (called on every closed candle from CandleEngine)
 *      - BTC, ETH, SOL, BNB
 *      - smaLen: 100, donchianLen: 30, atrMult: 2.0
 *
 *   2. Daily ETH (called on schedule via refreshDailyETH)
 *      - fetches last 300 daily bars from Binance REST
 *      - smaLen: 100, donchianLen: 20, atrMult: 2.0
 *      - writes signals_live/ETH_USD_1d.json
 *
 * Validated config:
 *   hourly:  short-only edge on ETH/BNB/SOL in bear regime (Nov 2025–Apr 2026)
 *   daily:   ls_sma100 profitable on 100% of combos on ETH full-cycle (Jul 2023–Apr 2026)
 */

import fs      from 'fs';
import path    from 'path';
import https   from 'https';
import { donchianSignal } from './donchian.js';

const SIGNALS_DIR = path.resolve('signals_live');

// ── hourly symbol → file mapping ──────────────────────────────────────────────
const SYMBOL_FILE = {
  'BTC': 'BTC_USD.json',
  'ETH': 'ETH_USD.json',
  'SOL': 'SOL_USD.json',
  'BNB': 'BNB_USD.json',
};

const SOL_DAILY_FILE = 'SOL_USD_1d.json';

// ── validated configs ─────────────────────────────────────────────────────────
const HOURLY_OPTS = {
  donchianLen: 30,
  atrLen:      14,
  atrMult:     2.0,
  smaLen:      100,   // updated: ls_sma100 dominates on full-cycle daily data
  allowLong:   true,
  allowShort:  true,
};

const DAILY_ETH_OPTS = {
  donchianLen: 20,
  atrLen:      14,
  atrMult:     2.0,
  smaLen:      100,   // ls_sma100 validated: ETH daily mean_eq=2549, 100% profitable combos
  allowLong:   true,
  allowShort:  true,
};

// ── shared write helper ───────────────────────────────────────────────────────
function writeSignalFile(filename, symbol, timeframe, sig, lastCandle) {
  const payload = {
    meta: {
      symbol,
      timeframe,
      strategy:  'Donchian-ATR',
      asOf:      new Date().toISOString(),
    },
    price: {
      last: lastCandle.close,
      atr:  sig.atr ?? null,
    },
    signal: {
      action:     sig.signal,
      direction:  sig.direction,
      confidence: sig.confidence,
      stopPrice:  sig.stopPrice,
      reason:     sig.reason,
    },
    indicators: {
      donchianHigh: sig.donchianHigh ?? null,
      donchianLow:  sig.donchianLow  ?? null,
      atr:          sig.atr          ?? null,
      sma:          sig.sma          ?? null,
      regime:       sig.direction ===  1 ? 'Bullish-Breakout'
                  : sig.direction === -1 ? 'Bearish-Breakdown'
                  : 'Ranging',
    },
  };

  if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SIGNALS_DIR, filename), JSON.stringify(payload, null, 2), 'utf8');

  if (sig.direction !== 0) {
    console.log(`[DONCHIAN] ${symbol}/${timeframe} → ${sig.signal}  `+
                `conf=${sig.confidence}  stop=${sig.stopPrice}  ${sig.reason}`);
  }
}

// ── hourly writer (called from CandleEngine on candle close) ──────────────────
export function writeDonchianSignal(symbol, candles) {
  try {
    const file = SYMBOL_FILE[symbol];
    if (!file) { console.warn(`[DONCHIAN] No file mapping for symbol: ${symbol}`); return; }
    const sig = donchianSignal(candles, HOURLY_OPTS);
    writeSignalFile(file, `${symbol}/USD`, '1h', sig, candles[candles.length - 1]);
  } catch (err) {
    console.error(`[DONCHIAN WRITER] ${symbol}:`, err.message);
  }
}

// ── Binance REST fetch (daily bars) ──────────────────────────────────────────
function fetchBinanceKlines(symbol, interval, limit) {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const rows = JSON.parse(data).map(r => ({
            time:   r[0],
            open:   parseFloat(r[1]),
            high:   parseFloat(r[2]),
            low:    parseFloat(r[3]),
            close:  parseFloat(r[4]),
            volume: parseFloat(r[5]),
          }));
          resolve(rows);
        } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Binance fetch timeout')));
  });
}

// ── daily SOL refresh (short_only, validated 67% OOS profit rate) ──────────────
export async function refreshDailySOL() {
  try {
    const candles = await fetchBinanceKlines('SOLUSDT', '1d', 300);
    if (candles.length < 130) {
      console.warn(`[DONCHIAN DAILY] SOL: Not enough bars: ${candles.length}`);
      return;
    }
    const sig = donchianSignal(candles, {
      donchianLen: 20, atrLen: 14, atrMult: 2.0,
      smaLen: 200,        // sma not used (allowShort only)
      allowLong: false, allowShort: true,
    });
    writeSignalFile(SOL_DAILY_FILE, 'SOL/USD', '1d', sig, candles[candles.length - 1]);
  } catch (err) {
    console.error('[DONCHIAN DAILY SOL]', err.message);
  }
}

// ── daily ETH refresh (call on schedule, e.g. every hour) ────────────────────
export async function refreshDailyETH() {
  try {
    // fetch 300 daily bars — enough for smaLen=100 + donchianLen=20 + warmup
    const candles = await fetchBinanceKlines('ETHUSDT', '1d', 300);
    if (candles.length < 130) {
      console.warn(`[DONCHIAN DAILY] Not enough bars: ${candles.length}`);
      return;
    }
    const sig = donchianSignal(candles, DAILY_ETH_OPTS);
    writeSignalFile('ETH_USD_1d.json', 'ETH/USD', '1d', sig, candles[candles.length - 1]);
  } catch (err) {
    console.error('[DONCHIAN DAILY ETH]', err.message);
  }
}
