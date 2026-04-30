import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'trades.db');

if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    timeframe TEXT,
    timestamp_utc TEXT,
    entry REAL,
    sl REAL,
    tp REAL,
    rr REAL,
    final_signal TEXT,
    final_confidence REAL,
    ensemble_score REAL,
    regime TEXT,
    indicator_snapshot TEXT,
    candle_snapshot TEXT,
    model_votes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    signal_id TEXT,
    exit_price REAL,
    result TEXT,
    pnl REAL,
    closed_at TEXT,
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT,
    message TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function hashSignal(data) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(data))
        .digest('hex');
}

function logSignal(signal) {
    const id = hashSignal({
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        timestamp: signal.timestamp_utc
    });

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO signals
        (id, symbol, timeframe, timestamp_utc, entry, sl, tp, rr,
         final_signal, final_confidence, ensemble_score,
         regime, indicator_snapshot, candle_snapshot, model_votes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        id,
        signal.symbol,
        signal.timeframe,
        signal.timestamp_utc,
        signal.entry,
        signal.sl,
        signal.tp,
        signal.rr,
        signal.final_signal,
        signal.final_confidence,
        signal.ensemble_score,
        signal.regime,
        JSON.stringify(signal.indicators || {}),
        JSON.stringify(signal.candles || []),
        JSON.stringify(signal.model_votes || {})
    );

    return id;
}

function closeTrade(signal_id, exit_price, result, pnl) {
    const stmt = db.prepare(`
        INSERT INTO trades
        (id, signal_id, exit_price, result, pnl, closed_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        crypto.randomUUID(),
        signal_id,
        exit_price,
        result,
        pnl,
        new Date().toISOString()
    );
}

function audit(level, message) {
    db.prepare(`
        INSERT INTO audit_log (level, message)
        VALUES (?, ?)
    `).run(level, message);
}

export { logSignal, closeTrade, audit };
