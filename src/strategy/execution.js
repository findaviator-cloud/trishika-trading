/**
 * execution.js
 * Local paper execution engine for Trishika Trading.
 *
 * Reads two env flags on every call (so you can flip them without restart):
 *   EXECUTION_ENABLED=false  → log EXECUTION_SKIPPED, never write fills
 *   EXECUTION_ENABLED=true   → honour EXECUTION_MODE
 *   EXECUTION_MODE=paper     → append to logs/execution_paper.jsonl
 *   EXECUTION_MODE=live      → reserved; throws until a live adapter is wired
 *
 * API:
 *   const result = await routeOrder({ symbol, side, qty, entry_price,
 *                                     stop_price, ts, meta });
 *   result: { ok: bool, mode: string, fill: object|null, reason: string|null }
 *
 * Fill record written to execution_paper.jsonl:
 *   { ts, symbol, side, qty, fill_price, stop_price, slippage_pct,
 *     equity_before, equity_after, mode, meta }
 *
 * Slippage model (paper):
 *   BUY  fill = entry_price * (1 + SLIPPAGE_PCT)
 *   SELL fill = entry_price * (1 - SLIPPAGE_PCT)
 *   Default SLIPPAGE_PCT = 0.0005 (0.05% — conservative for daily bars)
 */

import fs   from 'fs';
import path from 'path';
import { sendAlert } from './alert.js';

const LOGS_DIR       = path.resolve('logs');
const PAPER_LOG      = path.join(LOGS_DIR, 'execution_paper.jsonl');
const SLIPPAGE_PCT   = 0.0005;

// Internal paper equity tracker (mirrors monitor state independently)
let paperEquity = 1000.0;

function readFlags() {
  return {
    enabled: (process.env.EXECUTION_ENABLED ?? 'false').toLowerCase() === 'true',
    mode:    (process.env.EXECUTION_MODE    ?? 'paper').toLowerCase(),
  };
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function appendPaperLog(record) {
  ensureLogsDir();
  fs.appendFileSync(PAPER_LOG, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * routeOrder({ symbol, side, qty, entry_price, stop_price, ts, meta })
 *
 * symbol      — 'ETH' | 'SOL' | ...
 * side        — 'BUY' | 'SELL'
 * qty         — units of asset (pass 1.0 for ATR-sized — paper engine records it)
 * entry_price — signal price (last close or next-bar open estimate)
 * stop_price  — current ATR stop level (for record-keeping)
 * ts          — ISO timestamp of signal
 * meta        — arbitrary object (strategy config, signal confidence, etc.)
 */
export async function routeOrder({
  symbol, side, qty = 1.0, entry_price, stop_price = null, ts, meta = {}
}) {
  const { enabled, mode } = readFlags();
  const tag = `[EXEC/${symbol}/${side}]`;

  // ── KILL-SWITCH ────────────────────────────────────────────────────────────
  if (!enabled) {
    const msg = `${tag} EXECUTION_SKIPPED — kill-switch is OFF`;
    console.log(`⏸  ${msg}`);
    sendAlert({ level: 'INFO', type: 'EXECUTION_SKIPPED',
      message: msg,
      payload: { symbol, side, qty, entry_price, stop_price, ts, meta }
    }).catch(() => {});
    return { ok: false, mode: 'disabled', fill: null, reason: 'kill-switch' };
  }

  // ── PAPER MODE ─────────────────────────────────────────────────────────────
  if (mode === 'paper') {
    const slippage   = side === 'BUY' ? SLIPPAGE_PCT : -SLIPPAGE_PCT;
    const fill_price = +(entry_price * (1 + slippage)).toFixed(6);
    const cost_pct   = side === 'BUY'
      ? fill_price / entry_price - 1.0
      : entry_price / fill_price - 1.0;
    const equity_before = +paperEquity.toFixed(4);
    // Simple full-notional paper PnL (sizing handled upstream via risk_pct)
    paperEquity = +(paperEquity * (1 + cost_pct)).toFixed(4);
    const equity_after = paperEquity;

    const fill = {
      ts, symbol, side, qty,
      fill_price, entry_price, stop_price,
      slippage_pct: +(slippage * 100).toFixed(4),
      equity_before, equity_after,
      mode: 'paper',
      meta,
    };

    appendPaperLog(fill);

    const msg = `${tag} PAPER fill @ ${fill_price}  slippage=${(slippage*100).toFixed(3)}%  equity ${equity_before} → ${equity_after}`;
    console.log(`📝 ${msg}`);
    sendAlert({ level: 'INFO', type: 'EXECUTION_PAPER',
      message: msg, payload: fill
    }).catch(() => {});

    return { ok: true, mode: 'paper', fill, reason: null };
  }

  // ── LIVE MODE — reserved ───────────────────────────────────────────────────
  if (mode === 'live') {
    const msg = `${tag} LIVE execution not yet implemented — set EXECUTION_MODE=paper`;
    console.error(`🚫 ${msg}`);
    sendAlert({ level: 'ERROR', type: 'EXECUTION_LIVE_NOT_IMPLEMENTED',
      message: msg, payload: { symbol, side }
    }).catch(() => {});
    return { ok: false, mode: 'live', fill: null, reason: 'not-implemented' };
  }

  // Unknown mode
  const msg = `${tag} Unknown EXECUTION_MODE="${mode}"`;
  console.error(`🚫 ${msg}`);
  return { ok: false, mode, fill: null, reason: `unknown-mode:${mode}` };
}

/** paperEquitySnapshot() — returns current paper equity for health checks */
export function paperEquitySnapshot() {
  return { paper_equity: paperEquity, paper_log: PAPER_LOG };
}
