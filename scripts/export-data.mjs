import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = './data/trades.db';
const OUTPUT_DIR = './data/candles';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.all(`SELECT DISTINCT symbol, timeframe FROM trades`, [], (err, pairs) => {
  if (err) throw err;
  pairs.forEach(({ symbol, timeframe }) => {
    const fileName = `${symbol}_${timeframe}.csv`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    const writeStream = fs.createWriteStream(filePath);
    writeStream.write('timestamp,open,high,low,close\n');
    db.each(
      `SELECT timestamp, open, high, low, close FROM trades WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC`,
      [symbol, timeframe],
      (rowErr, row) => {
        if (rowErr) throw rowErr;
        writeStream.write(`${row.timestamp},${row.open},${row.high},${row.low},${row.close}\n`);
      },
      () => {
        writeStream.end();
        console.log(`Exported: ${fileName}`);
      }
    );
  });
});
