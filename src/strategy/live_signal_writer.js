/**
 * live_signal_writer.js
 * Analysis-only Donchian writer for closed candles.
 * No order routing, execution, or live-capital action is authorized here.
 */

import fs from 'fs';
import path from 'path';
import { donchianSignal } from './donchian.js';
import { setSignal, addToHistory } from './signal_store.js';
import { logSignal } from './signal_logger.js';
import {
  triggerEmaRefresh,
  getEmaConfirmation,
  AUTOMATION_ALLOWED
} from './ema_confirmation.js';
import { fetchTwelveDataJson } from '../services/twelve_data_rate_limiter.js';
import { CONFIG } from '../config/index.js';

const SIGNALS_DIR = path.resolve('signals_live');

const SYMBOL_FILE = {
  BTC: 'BTC_USD.json',
  ETH: 'ETH_USD.json',
  SOL: 'SOL_USD.json',
  BNB: 'BNB_USD.json',
  EUR_USD: 'EUR_USD.json',
  XAU_USD: 'XAU_USD.json',
  NIFTY: 'NIFTY.json',
  BANKNIFTY: 'BANKNIFTY.json',
  RELIANCE: 'RELIANCE.json',
  TCS: 'TCS.json',
  INFY: 'INFY.json',
  HDFCBANK: 'HDFCBANK.json',
  ICICIBANK: 'ICICIBANK.json',
  SBIN: 'SBIN.json',
  BHARTIARTL: 'BHARTIARTL.json',
  ITC: 'ITC.json',
  WIPRO: 'WIPRO.json',
  HCLTECH: 'HCLTECH.json',
  AXISBANK: 'AXISBANK.json',
  KOTAKBANK: 'KOTAKBANK.json',
  LT: 'LT.json',
  ONGC: 'ONGC.json',
  TATAMOTORS: 'TATAMOTORS.json',
  BAJFINANCE: 'BAJFINANCE.json',
  MARUTI: 'MARUTI.json',
  ADANIENT: 'ADANIENT.json'
};

const SOL_DAILY_FILE = 'SOL_USD_1d.json';

const HOURLY_OPTS = {
  donchianLen: 30,
  atrLen: 14,
  atrMult: 2.0,
  smaLen: 100,
  allowLong: true,
  allowShort: true
};

const FNO_OPTS = {
  donchianLen: 30,
  atrLen: 14,
  atrMult: 2.0,
  smaLen: 50,
  allowLong: true,
  allowShort: true
};

const DAILY_ETH_OPTS = {
  donchianLen: 20,
  atrLen: 14,
  atrMult: 2.0,
  smaLen: 100,
  allowLong: true,
  allowShort: true
};

function writeSignalFile(filename, symbol, timeframe, sig, lastCandle) {
  const payload = {
    meta: {
      symbol,
      timeframe,
      strategy: 'Donchian-ATR',
      asOf: new Date().toISOString(),
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false
    },
    price: {
      last: lastCandle.close,
      atr: sig.atr ?? null
    },
    signal: {
      action: sig.signal,
      direction: sig.direction,
      confidence: sig.confidence,
      stopPrice: sig.stopPrice,
      reason: sig.reason,
      emaConfirmation: sig.emaConfirmation ?? 'N/A',
      emaConfirmationNote: sig.emaConfirmationNote ?? null,
      ema200Daily: sig.ema200Daily ?? null,
      automationAllowed: false
    },
    indicators: {
      donchianHigh: sig.donchianHigh ?? null,
      donchianLow: sig.donchianLow ?? null,
      atr: sig.atr ?? null,
      sma: sig.sma ?? null,
      regime:
        sig.direction === 1
          ? 'Bullish-Breakout'
          : sig.direction === -1
            ? 'Bearish-Breakdown'
            : 'Ranging'
    }
  };

  setSignal(filename, payload);

  try {
    if (!fs.existsSync(SIGNALS_DIR)) {
      fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    }

    fs.writeFileSync(
      path.join(SIGNALS_DIR, filename),
      JSON.stringify(payload, null, 2),
      'utf8'
    );
  } catch {
    // Runtime signal-file writes are optional on ephemeral deployments.
  }

  console.log(
    `[DONCHIAN] ${symbol}/${timeframe} → ${sig.signal} conf=${sig.confidence} — ${sig.reason}`
  );

  if (sig.direction !== 0) {
    console.log(
      `[DONCHIAN] ${symbol}/${timeframe} → ${sig.signal}  conf=${sig.confidence}  stop=${sig.stopPrice}  ${sig.reason}`
    );
  }
}

async function fetchTwelveDataKlines(symbol, limit) {
  const key = CONFIG.twelveKey;

  if (!key) {
    throw new Error('Twelve Data key is not configured.');
  }

  const sym = encodeURIComponent(symbol);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${limit}&apikey=${key}`;

  const parsed = await fetchTwelveDataJson(url);

  if (!Array.isArray(parsed.values)) {
    throw new Error('Twelve Data response did not contain daily candle values.');
  }

  return parsed.values.reverse().map((r) => ({
    time: new Date(r.datetime).getTime(),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: 0
  }));
}

const FNO_SYMBOLS_SET = new Set([
  'NIFTY',
  'BANKNIFTY',
  'RELIANCE',
  'TCS',
  'INFY',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'BHARTIARTL',
  'ITC',
  'WIPRO',
  'HCLTECH',
  'AXISBANK',
  'KOTAKBANK',
  'LT',
  'ONGC',
  'TATAMOTORS',
  'BAJFINANCE',
  'MARUTI',
  'ADANIENT'
]);

export function writeDonchianSignal(symbol, candles) {
  try {
    const file = SYMBOL_FILE[symbol];

    if (!file) {
      console.warn(`[DONCHIAN] No file mapping for symbol: ${symbol}`);
      return;
    }

    const opts = FNO_SYMBOLS_SET.has(symbol) ? FNO_OPTS : HOURLY_OPTS;
    const sig = donchianSignal(candles, opts);

    // Informational-only crypto EMA overlay; it never changes Donchian direction.
    triggerEmaRefresh(symbol);

    const emaInfo = getEmaConfirmation(
      symbol,
      sig.direction,
      candles[candles.length - 1].close
    );

    sig.emaConfirmation = emaInfo.label;
    sig.emaConfirmationNote = emaInfo.note;
    sig.ema200Daily = emaInfo.ema;

    writeSignalFile(
      file,
      `${symbol}/USD`,
      '1h',
      sig,
      candles[candles.length - 1]
    );

    logSignal(symbol, sig, candles[candles.length - 1]);

    const source = FNO_SYMBOLS_SET.has(symbol) ? 'FNO' : 'CRYPTO/FOREX';

    addToHistory(
      symbol,
      sig.signal,
      candles[candles.length - 1].close,
      sig.stopPrice,
      sig.confidence,
      sig.reason,
      source
    );
  } catch (error) {
    console.error(`[DONCHIAN WRITER] ${symbol}:`, error.message);
  }
}

export async function refreshDailySOL() {
  try {
    const candles = await fetchTwelveDataKlines('SOL/USD', 300);

    if (candles.length < 130) {
      console.warn(`[DONCHIAN DAILY] SOL: Not enough bars: ${candles.length}`);
      return;
    }

    const sig = donchianSignal(candles, {
      donchianLen: 20,
      atrLen: 14,
      atrMult: 2.0,
      smaLen: 200,
      allowLong: false,
      allowShort: true
    });

    writeSignalFile(
      SOL_DAILY_FILE,
      'SOL/USD',
      '1d',
      sig,
      candles[candles.length - 1]
    );

    addToHistory(
      'SOL/USD',
      sig.signal,
      candles[candles.length - 1].close,
      sig.stopPrice,
      sig.confidence,
      sig.reason,
      'CRYPTO-DAILY'
    );
  } catch (error) {
    console.error('[DONCHIAN DAILY SOL]', error.message);
  }
}

export async function refreshDailyETH() {
  try {
    const candles = await fetchTwelveDataKlines('ETH/USD', 300);

    if (candles.length < 130) {
      console.warn(`[DONCHIAN DAILY] ETH: Not enough bars: ${candles.length}`);
      return;
    }

    const sig = donchianSignal(candles, DAILY_ETH_OPTS);

    writeSignalFile(
      'ETH_USD_1d.json',
      'ETH/USD',
      '1d',
      sig,
      candles[candles.length - 1]
    );

    addToHistory(
      'ETH/USD',
      sig.signal,
      candles[candles.length - 1].close,
      sig.stopPrice,
      sig.confidence,
      sig.reason,
      'CRYPTO-DAILY'
    );
  } catch (error) {
    console.error('[DONCHIAN DAILY ETH]', error.message);
  }
}
