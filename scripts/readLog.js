#!/usr/bin/env node
// scripts/readLog.js
// CLI tool to query and replay signal logs
//
// Usage:
//   node scripts/readLog.js                        # last 20 entries
//   node scripts/readLog.js --symbol BTCUSDT       # filter by symbol
//   node scripts/readLog.js --signal BUY           # filter by final signal
//   node scripts/readLog.js --fallback pinescript  # only fallback rows
//   node scripts/readLog.js --tail 50              # last N entries
//   node scripts/readLog.js --stats                # summary stats
//   node scripts/readLog.js --since 2025-01-01     # entries after date

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const LOG_FILE = path.resolve(__dirname, '../logs/signals.jsonl');

// ── helpers ──────────────────────────────────────────────────────────────────

function loadLines() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error('No log file found at', LOG_FILE);
    process.exit(1);
  }
  return fs.readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tail: 20 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol')   opts.symbol   = args[++i]?.toUpperCase();
    if (args[i] === '--signal')   opts.signal   = args[++i]?.toUpperCase();
    if (args[i] === '--fallback') opts.fallback  = args[++i];
    if (args[i] === '--tail')     opts.tail      = parseInt(args[++i], 10);
    if (args[i] === '--stats')    opts.stats     = true;
    if (args[i] === '--since')    opts.since     = new Date(args[++i]);
    if (args[i] === '--full')     opts.full      = true;  // dump entire JSON
  }
  return opts;
}

// ── stats mode ───────────────────────────────────────────────────────────────

function printStats(rows) {
  const total = rows.length;
  const bySignal   = {};
  const byFallback = {};
  const bySymbol   = {};
  let timedOutModels = {};

  for (const r of rows) {
    const sig = r.finalSignal?.signal ?? 'UNKNOWN';
    bySignal[sig]   = (bySignal[sig]   ?? 0) + 1;
    const fb = r.fallback ?? 'none';
    byFallback[fb]  = (byFallback[fb]  ?? 0) + 1;
    bySymbol[r.symbol] = (bySymbol[r.symbol] ?? 0) + 1;

    for (const v of (r.expertVotes ?? [])) {
      if (v.timedOut) {
        timedOutModels[v.model] = (timedOutModels[v.model] ?? 0) + 1;
      }
    }
  }

  console.log('\n══════════════ SIGNAL LOG STATS ══════════════');
  console.log(`Total entries : ${total}`);
  if (total === 0) return;

  const first = rows[0].ts;
  const last  = rows[rows.length - 1].ts;
  console.log(`Date range    : ${first}  →  ${last}`);

  console.log('\n── Final signal distribution ──');
  for (const [k, v] of Object.entries(bySignal))
    console.log(`  ${k.padEnd(12)} ${v}  (${(v/total*100).toFixed(1)}%)`);

  console.log('\n── Fallback usage ──');
  for (const [k, v] of Object.entries(byFallback))
    console.log(`  ${k.padEnd(16)} ${v}  (${(v/total*100).toFixed(1)}%)`);

  console.log('\n── Calls per symbol ──');
  for (const [k, v] of Object.entries(bySymbol))
    console.log(`  ${k.padEnd(16)} ${v}`);

  if (Object.keys(timedOutModels).length) {
    console.log('\n── Model timeout counts ──');
    for (const [k, v] of Object.entries(timedOutModels))
      console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log('═══════════════════════════════════════════════\n');
}

// ── row printer ──────────────────────────────────────────────────────────────

function printRow(r, full) {
  if (full) { console.log(JSON.stringify(r, null, 2)); return; }

  const sig  = r.finalSignal?.signal     ?? '?';
  const conf = r.finalSignal?.confidence ?? '?';
  const fb   = r.fallback ? `[fallback:${r.fallback}]` : '';
  const votes = (r.expertVotes ?? [])
    .map(v => `${v.model}:${v.signal ?? (v.timedOut ? 'TIMEOUT' : '?')}`)
    .join('  ');

  console.log(`${r.ts}  ${r.symbol}/${r.interval}  → ${sig} (${conf})  ${fb}`);
  console.log(`  votes   : ${votes || 'none'}`);

  const ind = r.indicators ?? {};
  console.log(
    `  RSI=${ind.rsi?.toFixed(1) ?? '-'}  EMA9/21=${ind.ema9?.toFixed(1) ?? '-'}/${ind.ema21?.toFixed(1) ?? '-'}` +
    `  ATR=${ind.atr?.toFixed(4) ?? '-'}  regime=${ind.regime ?? '-'}  session=${ind.session ?? '-'}`
  );
  if (r.finalSignal?.reason)
    console.log(`  reason  : ${r.finalSignal.reason}`);
  console.log();
}

// ── main ─────────────────────────────────────────────────────────────────────

(function main() {
  const opts = parseArgs();
  let rows   = loadLines();

  // filters
  if (opts.symbol)   rows = rows.filter(r => r.symbol   === opts.symbol);
  if (opts.signal)   rows = rows.filter(r => r.finalSignal?.signal === opts.signal);
  if (opts.fallback) rows = rows.filter(r => (r.fallback ?? 'none') === opts.fallback);
  if (opts.since)    rows = rows.filter(r => new Date(r.ts) >= opts.since);

  if (opts.stats) { printStats(rows); return; }

  // tail
  const slice = rows.slice(-opts.tail);
  console.log(`\nShowing ${slice.length} of ${rows.length} matching entries\n`);
  for (const r of slice) printRow(r, opts.full);
})();
