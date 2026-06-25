// In-memory signal store — replaces disk-based signals_live/
const store = new Map();

// ── 24-hour Signal History ──
const signalHistory = [];
const HISTORY_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

export function setSignal(filename, payload) {
  store.set(filename, { ...payload, _updatedAt: Date.now() });
}

export function getSignal(filename) {
  return store.get(filename) ?? null;
}

export function getAllSignals() {
  return Object.fromEntries(store);
}

// Add signal to 24-hour history
export function addToHistory(symbol, action, entry, stop, confidence, reason, source) {
  if (!action || action === 'NEUTRAL') return;
  const now = Date.now();
  // Clean old entries (older than 24h)
  while (signalHistory.length > 0 && now - signalHistory[0].ts > HISTORY_TTL) {
    signalHistory.shift();
  }
  signalHistory.push({
    ts: now,
    time: new Date(now).toISOString(),
    symbol,
    action,
    entry,
    stop,
    confidence,
    reason: reason || '',
    source: source || 'unknown'
  });
}

// Get last 24 hours history
export function getHistory() {
  const now = Date.now();
  return signalHistory.filter(s => now - s.ts <= HISTORY_TTL);
}
