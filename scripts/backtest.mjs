import fs from 'fs';
import path from 'path';

const SIGNALS_DIR = './signals';
const CANDLES_DIR = './data/candles';

function calcMaxDrawdown(equityCurve) {
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

async function runBacktest() {
  const signalFiles = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
  const results = [];

  for (const file of signalFiles) {
    const base = path.basename(file, '.json'); // e.g. BTC_USD
    const symbol = base;
    const timeframe = '1h'; // adjust if you later add multiple TFs per symbol

    const signalPath = path.join(SIGNALS_DIR, file);
    const candlePath = path.join(CANDLES_DIR, `${symbol}_${timeframe}.csv`);

    if (!fs.existsSync(candlePath)) {
      console.warn(`⚠️ Missing candles for ${symbol}_${timeframe}, skipping.`);
      continue;
    }

    const signalData = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
    const dirStr = (signalData.signal || '').toUpperCase();
    const direction = dirStr === 'LONG' ? 1 : dirStr === 'SHORT' ? -1 : 0;

    const candleLines = fs.readFileSync(candlePath, 'utf8')
      .split('\n')
      .slice(1)
      .filter(line => line.trim());

    const candles = candleLines.map(line => {
      const [ts, o, h, l, c] = line.split(',');
      return { timestamp: Number(ts), close: Number(c) };
    });

    if (!candles.length || direction === 0) {
      results.push({
        symbol,
        timeframe,
        direction: dirStr,
        trades: 0,
        roi: '0.00%',
        maxDrawdown: '0.00%',
        finalEquity: '1000.00'
      });
      continue;
    }

    let equity = 1000;
    const equityCurve = [equity];

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1].close;
      const curr = candles[i].close;
      const priceChange = (curr - prev) / prev;
      equity += equity * priceChange * direction;
      equityCurve.push(equity);
    }

    const maxDD = calcMaxDrawdown(equityCurve);
    const roi = (equity - 1000) / 1000;

    results.push({
      symbol,
      timeframe,
      direction: dirStr,
      trades: candles.length - 1,
      roi: (roi * 100).toFixed(2) + '%',
      maxDrawdown: (maxDD * 100).toFixed(2) + '%',
      finalEquity: equity.toFixed(2)
    });
  }

  console.table(results);
  fs.writeFileSync('./backtest_summary.json', JSON.stringify(results, null, 2));
  console.log('Summary saved to backtest_summary.json (ready for AI analysis).');
}

runBacktest();
