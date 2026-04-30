import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./data/trades.db');

// Get all non-neutral signals that don't have a trade yet
const query = `
  SELECT s.id, s.symbol, s.entry, s.tp, s.sl, s.final_signal 
  FROM signals s
  LEFT JOIN trades t ON s.id = t.signal_id
  WHERE t.id IS NULL AND s.final_signal != 'NEUTRAL'
`;

db.all(query, [], (err, signals) => {
  if (err) throw err;
  if (!signals.length) {
    console.log('No new signals to seed.');
    db.close();
    return;
  }

  let remaining = signals.length;

  signals.forEach(sig => {
    const isWin = Math.random() > 0.45; // slight win bias for testing
    const exitPrice = isWin ? sig.tp : sig.sl;
    const pnl = isWin
      ? Math.abs(sig.tp - sig.entry)
      : -Math.abs(sig.entry - sig.sl);
    const result = isWin ? 'WIN' : 'LOSS';

    db.run(
      `INSERT INTO trades (signal_id, exit_price, result, pnl, closed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sig.id, exitPrice, result, pnl, new Date().toISOString()],
      insertErr => {
        if (insertErr) console.error('Insert error for signal', sig.id, insertErr);
        remaining--;
        if (remaining === 0) {
          console.log(`Seeded ${signals.length} synthetic trades into the DB.`);
          db.close();
        }
      }
    );
  });
});
