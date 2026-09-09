'use strict';

/**
 * EMA_CONFIRMATION Circuit Breaker
 * -----------------------------------------------------------------------
 * Purpose: Binance ko baar-baar failing EMA confirmation calls bhejna band
 * karta hai jab tak ek cooldown window (default 4 hours) na guzar jaaye.
 * Yeh sirf bandwidth/rate-limit waste rokta hai — koi trading/execution
 * logic yahan nahi hai, sirf read-only confirmation calls ke liye hai.
 *
 * State in-memory rehta hai (per running process). Agar aap multiple
 * instances/restarts ke across state persist karna chahte hain, isko
 * ek JSON file (jaise data/ema-circuit-state.json) mein persist kar sakte
 * hain — neeche optional persistence hooks diye hain.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// ---- Configuration (env override-able) ----------------------------------
const FAILURE_THRESHOLD = parseInt(process.env.EMA_CB_FAILURE_THRESHOLD || '2', 10); // kitni consecutive failures ke baad trip ho
const BLOCK_DURATION_MS = parseInt(
  process.env.EMA_CB_BLOCK_DURATION_MS || String(4 * 60 * 60 * 1000), // default 4 hours
  10
);
const STATE_FILE = process.env.EMA_CB_STATE_FILE || null; // e.g. 'data/ema-circuit-state.json' — optional persistence

// ---- In-memory state: symbol -> { failCount, blockedUntil, lastError } --
let state = new Map();

// ---- Optional persistence (safe no-ops if STATE_FILE not set) -----------
function loadState() {
  if (!STATE_FILE) return;
  try {
    const filePath = path.resolve(STATE_FILE);
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = new Map(Object.entries(raw));
    }
  } catch (err) {
    console.warn('[EMA_CIRCUIT_BREAKER] Failed to load state, starting fresh:', err.message);
  }
}

function saveState() {
  if (!STATE_FILE) return;
  try {
    const filePath = path.resolve(STATE_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const obj = Object.fromEntries(state);
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn('[EMA_CIRCUIT_BREAKER] Failed to save state:', err.message);
  }
}

loadState();

// ---- Core API -------------------------------------------------------------

/**
 * Call karne se PEHLE yeh check karein. Agar true, toh Binance call skip
 * karke seedha return kar dein (no request sent at all).
 */
function isBlocked(symbol) {
  const entry = state.get(symbol);
  if (!entry || !entry.blockedUntil) return false;

  const now = Date.now();
  if (now < entry.blockedUntil) {
    return true;
  }

  // Cooldown khatam ho chuka — block hata dein, lekin fail count reset
  // taaki agla single fail dubara turant trip na kare (half-open state).
  entry.blockedUntil = null;
  entry.failCount = 0;
  state.set(symbol, entry);
  saveState();
  return false;
}

/**
 * Kitna time bacha hai block khatam hone mein (ms). UI/log ke liye useful.
 */
function getRemainingBlockMs(symbol) {
  const entry = state.get(symbol);
  if (!entry || !entry.blockedUntil) return 0;
  return Math.max(0, entry.blockedUntil - Date.now());
}

/**
 * Jab Binance call fail ho, isko call karein.
 */
function recordFailure(symbol, errorMessage) {
  const entry = state.get(symbol) || { failCount: 0, blockedUntil: null, lastError: null };
  entry.failCount += 1;
  entry.lastError = errorMessage || 'unknown error';

  if (entry.failCount >= FAILURE_THRESHOLD) {
    entry.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    console.warn(
      `[EMA_CIRCUIT_BREAKER] ${symbol}: ${entry.failCount} consecutive failures — ` +
      `blocking EMA_CONFIRMATION calls for ${(BLOCK_DURATION_MS / 3600000).toFixed(1)}h`
    );
  }

  state.set(symbol, entry);
  saveState();
}

/**
 * Jab Binance call succeed ho jaaye, isko call karein — state reset ho jaata hai.
 */
function recordSuccess(symbol) {
  if (state.has(symbol)) {
    state.set(symbol, { failCount: 0, blockedUntil: null, lastError: null });
    saveState();
  }
}

module.exports = {
  isBlocked,
  getRemainingBlockMs,
  recordFailure,
  recordSuccess,
};
