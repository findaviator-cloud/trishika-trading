import fs      from 'fs';
import path    from 'path';
import https   from 'https';
import http    from 'http';
import { URL } from 'url';
import {
  portfolioGate,
  openPosition,
  closePosition,
  portfolioSnapshot,
} from './portfolio.js';
import { sendAlert } from './alert.js';
import { routeOrder, paperEquitySnapshot } from './execution.js';

const SIGNALS_DIR = path.resolve('signals_live');
const LOGS_DIR    = path.resolve('logs');
const MONITOR_LOG = path.join(LOGS_DIR, 'monitor.jsonl');
const TRADE_LOG   = path.join(LOGS_DIR, 'donchian_trades.jsonl');

const THRESHOLDS = {
  staleSignalMs:   2.5 * 60 * 60 * 1000,
  maxDdAlert:      0.007,
  minWinRateAlert: 0.20,
  winRateWindow:   10,
  maxFlipsPerDay:  6,
};

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;

const state = {
  lastSignal:  null,
  lastRegime:  null,
  equity:      1000.0,
  peakEquity:  1000.0,
  trades:      [],
  flipsToday:  0,
  flipsDate:   null,
};

function logEvent(level, code, message, data = {}) {
  const record = { ts: new Date().toISOString(), level, code, message, ...data };
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(MONITOR_LOG, JSON.stringify(record) + '\n', 'utf8');
  const prefix = level === 'ALERT' ? '🚨' : level === 'WARN' ? '⚠️ ' : 'ℹ️ ';
  console.log(`${prefix} [MONITOR/${code}] ${message}`);
  if (level === 'ALERT' && WEBHOOK_URL) {
    sendWebhook(`${prefix} *${code}*: ${message}`).catch(() => {});
  }
}

async function sendWebhook(text) {
  try {
    const u    = new URL(WEBHOOK_URL);
    const body = JSON.stringify({ text });
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const lib = u.protocol === 'https:' ? https : http;
    await new Promise((res, rej) => {
      const req = lib.request(opts, r => { r.resume(); r.on('end', res); });
      req.on('error', rej);
      req.write(body);
      req.end();
    });
  } catch (e) {
    console.error('[MONITOR] Webhook failed:', e.message);
  }
}

function appendTradeLog(record) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(TRADE_LOG, JSON.stringify(record) + '\n', 'utf8');
}

function rollingWinRate(trades, window) {
  if (trades.length < window) return null;
  const wins = trades.slice(-window).filter(t => t.pnl_pct > 0).length;
  return wins / window;
}

function currentDrawdown(equity, peak) {
  return peak > 0 ? (peak - equity) / peak : 0;
}

function checkFreshness() {
  const file = path.join(SIGNALS_DIR, 'ETH_USD_1d.json');
  if (!fs.existsSync(file)) {
    logEvent('ALERT', 'SIGNAL_FILE_MISSING', 'ETH_USD_1d.json not found in signals_live/');
    sendAlert({ level: 'ERROR', type: 'SIGNAL_FILE_MISSING',
      message: 'ETH_USD_1d.json not found in signals_live/',
      payload: {} }).catch(() => {});
    return null;
  }
  const ageMs  = Date.now() - fs.statSync(file).mtimeMs;
  const ageMin = Math.round(ageMs / 60000);
  if (ageMs > THRESHOLDS.staleSignalMs) {
    logEvent('ALERT', 'SIGNAL_STALE',
      `ETH daily signal is ${ageMin}min old (threshold: ${THRESHOLDS.staleSignalMs/60000}min)`,
      { age_min: ageMin });
    sendAlert({ level: 'WARN', type: 'SIGNAL_STALE',
      message: `ETH daily signal is ${ageMin}min old`,
      payload: { age_min: ageMin, threshold_min: THRESHOLDS.staleSignalMs/60000 } }).catch(() => {});
  } else {
    logEvent('INFO', 'SIGNAL_FRESH', `ETH daily signal age: ${ageMin}min`);
  }

  // SOL daily freshness
  const solFile = path.join(SIGNALS_DIR, 'SOL_USD_1d.json');
  if (!fs.existsSync(solFile)) {
    logEvent('ALERT', 'SIGNAL_FILE_MISSING', 'SOL_USD_1d.json not found in signals_live/');
    sendAlert({ level: 'ERROR', type: 'SIGNAL_FILE_MISSING',
      message: 'SOL_USD_1d.json not found in signals_live/',
      payload: {} }).catch(() => {});
  } else {
    const solAgeMs  = Date.now() - fs.statSync(solFile).mtimeMs;
    const solAgeMin = Math.round(solAgeMs / 60000);
    if (solAgeMs > THRESHOLDS.staleSignalMs) {
      logEvent('ALERT', 'SIGNAL_STALE',
        `SOL daily signal is ${solAgeMin}min old (threshold: ${THRESHOLDS.staleSignalMs/60000}min)`,
        { age_min: solAgeMin });
      sendAlert({ level: 'WARN', type: 'SIGNAL_STALE',
        message: `SOL daily signal is ${solAgeMin}min old`,
        payload: { age_min: solAgeMin, threshold_min: THRESHOLDS.staleSignalMs/60000 } }).catch(() => {});
    } else {
      logEvent('INFO', 'SIGNAL_FRESH', `SOL daily signal age: ${solAgeMin}min`);
    }
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkRegime(signal) {
  const regime = signal?.indicators?.regime ?? 'unknown';
  const action = signal?.signal?.action    ?? 'NEUTRAL';
  if (state.lastRegime !== null && state.lastRegime !== regime) {
    logEvent('INFO', 'REGIME_CHANGE',
      `Regime changed: ${state.lastRegime} → ${regime}  signal=${action}`);
  }
  state.lastRegime = regime;
  return { regime, action };
}

function checkFlips(action) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.flipsDate !== today) { state.flipsDate = today; state.flipsToday = 0; }
  if (state.lastSignal !== null && state.lastSignal !== action) {
    state.flipsToday++;
    logEvent('INFO', 'SIGNAL_FLIP',
      `Signal flipped: ${state.lastSignal} → ${action}  (flips today: ${state.flipsToday})`);
    if (state.flipsToday > THRESHOLDS.maxFlipsPerDay) {
      logEvent('ALERT', 'TURNOVER_ANOMALY',
        `${state.flipsToday} signal flips today exceeds threshold — possible data issue`,
        { flips: state.flipsToday });
    }
  }
  state.lastSignal = action;
}

function checkDrawdown() {
  const dd = currentDrawdown(state.equity, state.peakEquity);
  if (dd > THRESHOLDS.maxDdAlert) {
    logEvent('ALERT', 'DRAWDOWN_BREACH',
      `Equity drawdown ${(dd*100).toFixed(2)}% exceeds alert threshold ${THRESHOLDS.maxDdAlert*100}%`,
      { equity: state.equity, peak: state.peakEquity, dd_pct: +(dd*100).toFixed(3) });
    sendAlert({ level: 'ERROR', type: 'DRAWDOWN_BREACH',
      message: `Equity drawdown ${(dd*100).toFixed(2)}% exceeds threshold`,
      payload: { equity: state.equity, peak: state.peakEquity, dd_pct: +(dd*100).toFixed(3) } }).catch(() => {});
  }
}

function checkWinRate() {
  const wr = rollingWinRate(state.trades, THRESHOLDS.winRateWindow);
  if (wr === null) return;
  if (wr < THRESHOLDS.minWinRateAlert) {
    logEvent('ALERT', 'WIN_RATE_DRIFT',
      `Rolling ${THRESHOLDS.winRateWindow}-trade WR ${(wr*100).toFixed(1)}% below alert threshold`,
      { win_rate: +(wr*100).toFixed(1), trades: state.trades.length });
  } else {
    logEvent('INFO', 'WIN_RATE_OK',
      `Rolling ${THRESHOLDS.winRateWindow}-trade WR: ${(wr*100).toFixed(1)}%`);
  }
}

export function runMonitorCycle() {
  try {
    const signal = checkFreshness();
    if (!signal) return;
    const { regime, action } = checkRegime(signal);
    checkFlips(action);

    // Portfolio gate — runs on every active (non-NEUTRAL) signal
    if (action !== 'NEUTRAL') {
      const gate = portfolioGate({
        symbol: signal.meta?.symbol ?? 'ETH',
        risk_pct: 0.005,
        equity:   state.equity,
      });
      if (!gate.allowed) {
        logEvent('WARN', 'PORTFOLIO_LIMIT_BREACH',
          `Entry blocked for ${gate.payload.symbol}: ${gate.reason}`,
          gate.payload);
        sendAlert({ level: 'WARN', type: 'PORTFOLIO_LIMIT_BREACH',
          message: `Entry blocked for ${gate.payload.symbol}: ${gate.reason}`,
          payload: gate.payload }).catch(() => {});
      } else if (gate.reason !== 'SYMBOL_ALREADY_OPEN') {
        logEvent('INFO', 'PORTFOLIO_GATE_PASS',
          `Entry permitted for ${gate.payload.symbol}`,
          gate.payload);
      }
    }
    const snap = portfolioSnapshot(state.equity);
    const execSnap = paperEquitySnapshot();
    logEvent('INFO', 'MONITOR_CYCLE', 'Cycle complete', {
      action,
      regime,
      confidence:    signal.signal?.confidence ?? 0,
      stop_price:    signal.signal?.stopPrice  ?? null,
      eth_price:     signal.price?.last        ?? null,
      equity:        state.equity,
      peak_equity:   state.peakEquity,
      dd_pct:        +(currentDrawdown(state.equity, state.peakEquity)*100).toFixed(3),
      trades_logged: state.trades.length,
      ...snap,
      ...execSnap,
    });
  } catch (err) {
    logEvent('ALERT', 'MONITOR_ERROR', `Monitor cycle failed: ${err.message}`);
    sendAlert({ level: 'ERROR', type: 'MONITOR_ERROR',
      message: `Monitor cycle failed: ${err.message}`,
      payload: { stack: err.stack?.slice(0, 300) } }).catch(() => {});
  }
}

export function recordTrade({ entry_price, exit_price, direction, ts, symbol = 'ETH' }) {
  closePosition(symbol);
  const pnl_pct = direction === 1
    ? exit_price / entry_price - 1.0
    : entry_price / exit_price - 1.0;
  state.trades.push({ ts, pnl_pct, direction });
  state.equity    *= (1 + pnl_pct * 0.5);
  state.peakEquity = Math.max(state.peakEquity, state.equity);
  const record = { ts, entry_price, exit_price, direction, pnl_pct: +pnl_pct.toFixed(6) };
  appendTradeLog(record);
  checkDrawdown();
  checkWinRate();
  logEvent('INFO', 'TRADE_RECORDED',
    `Trade closed: ${direction===1?'LONG':'SHORT'}  entry=${entry_price}  exit=${exit_price}  pnl=${(pnl_pct*100).toFixed(2)}%`,
    record);
}
