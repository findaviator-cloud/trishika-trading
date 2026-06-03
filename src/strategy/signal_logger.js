import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.resolve('logs');
const SIGNAL_LOG = path.join(LOGS_DIR, 'signals_history.jsonl');

export function logSignal(symbol, sig, candle) {
  if (sig.direction === 0) return;
  const record = {
    ts:            new Date().toISOString(),
    symbol,
    signal:        sig.signal,
    confidence:    sig.confidence,
    entry_price:   candle.close,
    stop_price:    sig.stopPrice ?? null,
    donchian_high: sig.donchianHigh ?? null,
    donchian_low:  sig.donchianLow  ?? null,
    atr:           sig.atr ?? null,
    sma:           sig.sma ?? null,
    reason:        sig.reason ?? '',
  };
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(SIGNAL_LOG, JSON.stringify(record) + '\n', 'utf8');
  } catch(e) {
    console.warn('[SIGNAL_LOGGER] disk write failed:', e.message);
  }
  console.log(`[SIGNAL_LOG] ${record.ts} | ${symbol} | ${sig.signal} | entry=${candle.close} | stop=${sig.stopPrice}`);
}
