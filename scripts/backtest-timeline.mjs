import fs from 'fs';
import path from 'path';

const SIGNALS_DIR = './signals_offline';
const DATA_DIR = './data';

function mapSymbolToCsv(symbol) {
  if (symbol === 'BTC_USD') return 'BTCUSDT_1h.csv';
  if (symbol === 'ETH_USD') return 'ETHUSDT_1h.csv';
  if (symbol === 'XAU_USD') return 'XAUUSDT_1h.csv';
  if (symbol === 'EUR_USD') return 'EURUSD_1h.csv'; // only if you add this CSV
  return null;
}

// Find exit candle given TP/SL and optional time-stop (in bars)
function findExitCandle(candles, direction, tpPct = 0.03, slPct = 0.01, maxBars = 48) {
  const entry = candles[0];
  const entryPrice = entry.close;
  const tpPrice = direction === 1 ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);
  const slPrice = direction === 1 ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);

  // start from bar 1 since 0 is entry
  const limit = Math.min(candles.length, maxBars + 1);
  for (let i = 1; i < limit; i++) {
    const c = candles[i];
    const high = c.high ?? c.close;
    const low  = c.low  ?? c.close;

    if (direction === 1) {
      if (high >= tpPrice) return { exit: c, reason: 'TP' };
      if (low  <= slPrice) return { exit: c, reason: 'SL' };
    } else if (direction === -1) {
      if (low  <= tpPrice) return { exit: c, reason: 'TP' };
      if (high >= slPrice) return { exit: c, reason: 'SL' };
    }
  }

  // Time stop or default to last available candle in window
  const last = candles[Math.min(limit - 1, candles.length - 1)];
  return { exit: last, reason: 'TIME/END' };
}

function runTimelineBacktest() {
  const files = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
  const results = [];

  files.forEach(file => {
    const raw = fs.readFileSync(path.join(SIGNALS_DIR, file), 'utf8');
    let sig;
    try {
      sig = JSON.parse(raw);
    } catch {
      return;
    }

    const symbol = file.replace(/\.json$/, '');
    const csvName = mapSymbolToCsv(symbol);
    if (!csvName) return;

    const csvPath = path.join(DATA_DIR, csvName);
    if (!fs.existsSync(csvPath)) return;

    const rows = fs.readFileSync(csvPath, 'utf8')
      .split('\n')
      .slice(1)
      .filter(l => l.trim());

    const candles = rows.map(r => {
      const [ts, o, h, l, c] = r.split(',');
      return {
        ts: Number(ts),
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c)
      };
    });
    if (!candles.length) return;

    const dirStr = (sig.signal || '').toUpperCase();
    const direction = dirStr === 'LONG' ? 1 : dirStr === 'SHORT' ? -1 : 0;

    const entryCandle = candles[0];

    let exitCandle = candles[candles.length - 1];
    let exitReason = 'HOLD_FULL';

    if (direction !== 0) {
      const out = findExitCandle(candles, direction, 0.03, 0.01, 48);
      exitCandle = out.exit;
      exitReason = out.reason;
    }

    const pnl = direction === 0
      ? 0
      : ((exitCandle.close - entryCandle.close) / entryCandle.close) * direction;

    results.push({
      Symbol: symbol,
      Signal: dirStr || 'NEUTRAL',
      ExitReason: exitReason,
      ROI: (pnl * 100).toFixed(2) + '%',
      Entry: entryCandle.close,
      Exit: exitCandle.close
    });
  });

  console.table(results);
}

runTimelineBacktest();
