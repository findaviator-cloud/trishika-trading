import fs from 'fs';
import path from 'path';
import { sendAlert } from './alert.js';

const SIGNALS_DIR = path.resolve('signals_live');
const LOGS_DIR = path.resolve('logs');
const MONITOR_LOG = path.join(LOGS_DIR, 'monitor.jsonl');

const THRESHOLDS = {
  staleSignalMs: 2.5 * 60 * 60 * 1000,
  maxFlipsPerDay: 6
};

const state = {
  lastSignal: null,
  lastRegime: null,
  flipsToday: 0,
  flipsDate: null
};

function logEvent(level, code, message, data = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    code,
    message,
    ...data,
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };

  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  fs.appendFileSync(MONITOR_LOG, JSON.stringify(record) + '\n', 'utf8');

  const prefix = level === 'ALERT' ? '🚨' : level === 'WARN' ? '⚠️ ' : 'ℹ️ ';
  console.log(`${prefix} [MONITOR/${code}] ${message}`);

  if (level === 'ALERT' && process.env.ALERT_WEBHOOK_URL) {
    sendAlert({
      level: 'ERROR',
      type: code,
      message,
      payload: data
    }).catch(() => {});
  }
}

function checkFileFreshness(fileName, label) {
  const file = path.join(SIGNALS_DIR, fileName);

  if (!fs.existsSync(file)) {
    logEvent(
      'WARN',
      'SIGNAL_FILE_PENDING',
      `${fileName} is not available yet; startup or refresh may still be in progress.`
    );
    return null;
  }

  const ageMs = Date.now() - fs.statSync(file).mtimeMs;
  const ageMin = Math.round(ageMs / 60000);

  if (ageMs > THRESHOLDS.staleSignalMs) {
    logEvent(
      'WARN',
      'SIGNAL_STALE',
      `${label} daily signal is ${ageMin}min old (threshold: ${THRESHOLDS.staleSignalMs / 60000}min)`,
      { age_min: ageMin }
    );
  } else {
    logEvent('INFO', 'SIGNAL_FRESH', `${label} daily signal age: ${ageMin}min`);
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    logEvent('WARN', 'SIGNAL_FILE_INVALID', `${fileName} JSON could not be read: ${error.message}`);
    return null;
  }
}

function checkFlips(action) {
  const today = new Date().toISOString().slice(0, 10);

  if (state.flipsDate !== today) {
    state.flipsDate = today;
    state.flipsToday = 0;
  }

  if (state.lastSignal !== null && state.lastSignal !== action) {
    state.flipsToday += 1;

    logEvent(
      'INFO',
      'SIGNAL_FLIP',
      `Signal flipped: ${state.lastSignal} → ${action} (flips today: ${state.flipsToday})`
    );

    if (state.flipsToday > THRESHOLDS.maxFlipsPerDay) {
      logEvent(
        'WARN',
        'TURNOVER_ANOMALY',
        `${state.flipsToday} signal flips today exceeds threshold — possible data issue`,
        { flips: state.flipsToday }
      );
    }
  }

  state.lastSignal = action;
}

export function runMonitorCycle() {
  try {
    const ethSignal = checkFileFreshness('ETH_USD_1d.json', 'ETH');
    checkFileFreshness('SOL_USD_1d.json', 'SOL');

    if (!ethSignal) {
      logEvent(
        'INFO',
        'MONITOR_CYCLE',
        'Cycle complete — no ETH daily snapshot available for analysis.',
        { action: 'NEUTRAL', executionAllowed: false }
      );
      return;
    }

    const action = ethSignal.signal?.action ?? 'NEUTRAL';
    const regime = ethSignal.indicators?.regime ?? 'unknown';

    if (state.lastRegime !== null && state.lastRegime !== regime) {
      logEvent(
        'INFO',
        'REGIME_CHANGE',
        `Regime changed: ${state.lastRegime} → ${regime} signal=${action}`
      );
    }

    state.lastRegime = regime;
    checkFlips(action);

    logEvent(
      'INFO',
      'MONITOR_CYCLE',
      'Cycle complete — research monitoring only; no portfolio gate, paper trade, order routing, or execution is called.',
      {
        action,
        regime,
        confidence: ethSignal.signal?.confidence ?? 0,
        stop_price: ethSignal.signal?.stopPrice ?? null,
        eth_price: ethSignal.price?.last ?? null,
        executionAllowed: false
      }
    );
  } catch (error) {
    logEvent('WARN', 'MONITOR_ERROR', `Monitor cycle failed: ${error.message}`);
  }
}

export function recordTrade() {
  console.warn('[MONITOR] recordTrade ignored: research-only mode; no trade state is recorded.');
  return {
    recorded: false,
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };
}
