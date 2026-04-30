import fs from 'fs';
import path from 'path';

const SIGNALS_DIR = './signals';
const DATA_DIR = './data';
const DEFAULT_SYMBOL = 'BTC_USD';
const DEFAULT_INTERVAL = '1h';

function backtest() {
  const signalFiles = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
  const results = [];

  for (const file of signalFiles) {
    const raw = fs.readFileSync(path.join(SIGNALS_DIR, file), 'utf8');
    const signal = JSON.parse(raw);

    const symbol = DEFAULT_SYMBOL;       // because JSON lacks symbol
    const interval = DEFAULT_INTERVAL;   // because JSON lacks timeframe
    const csvPath = path.join(DATA_DIR, 'BTCUSDT_1h.csv');

    if (!fs.existsSync(csvPath)) {
      console.warn(`Missing candles file: ${csvPath}, skipping.`);
      continue;
    }

    const lines = fs.readFileSync(csvPath, 'utf8')
      .split('\n')
      .slice(1)
      .filter(l => l.trim());

    const candles = lines.map(line => {
      const [ts, o, h, l, c] = line.split(',');
      return { ts: Number(ts), close: Number(c) };
    });

    if (!candles.length) continue;

    const dirStr = (signal.signal || '').toUpperCase();
    const dir = dirStr === 'LONG' ? 1 : dirStr === 'SHORT' ? -1 : 0;

    if (dir === 0) {
      results.push({
        Symbol: symbol,
        Signal: dirStr || 'NEUTRAL',
        ROI: '0.00%',
        Entry: candles[0].close,
        Exit: candles.at(-1).close
      });
      continue;
    }

    const entry = candles[0].close;
    const exit = candles.at(-1).close;
    const pnlPerc = ((exit - entry) / entry) * dir;

    results.push({
      Symbol: symbol,
      Signal: dirStr,
      ROI: (pnlPerc * 100).toFixed(2) + '%',
      Entry: entry,
      Exit: exit
    });
  }

  console.table(results);
}

backtest();
