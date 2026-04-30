import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./data/trades.db');

const query = `
  SELECT 
    s.symbol, 
    s.timeframe, 
    s.final_signal AS signal,
    t.pnl,
    t.result,
    t.closed_at AS closed_at
  FROM signals s
  JOIN trades t ON s.id = t.signal_id
  ORDER BY t.closed_at ASC
`;

db.all(query, [], (err, rows) => {
  if (err) throw err;

  const stats = {};

  rows.forEach(row => {
    const key = `${row.symbol}_${row.timeframe}`;
    if (!stats[key]) {
      stats[key] = { trades: 0, wins: 0, pnl: 0, equity: 1000, peak: 1000, maxDD: 0 };
    }

    const s = stats[key];
    s.trades++;
    if (row.result === 'WIN') s.wins++;

    s.pnl += row.pnl;
    s.equity += row.pnl;

    if (s.equity > s.peak) s.peak = s.equity;
    const dd = (s.peak - s.equity) / s.peak;
    if (dd > s.maxDD) s.maxDD = dd;
  });

  const finalReport = Object.keys(stats).map(key => ({
    Pair: key,
    Trades: stats[key].trades,
    WinRate: ((stats[key].wins / stats[key].trades) * 100).toFixed(2) + '%',
    TotalPnL: stats[key].pnl.toFixed(2),
    ROI: (((stats[key].equity - 1000) / 1000) * 100).toFixed(2) + '%',
    MaxDD: (stats[key].maxDD * 100).toFixed(2) + '%'
  }));

  console.table(finalReport);
  db.close();
});
