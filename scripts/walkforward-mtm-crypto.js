/**
 * scripts/walkforward-mtm-crypto.js
 *
 * Phase 5 follow-up (spec Section 11.6, item 1) — fold-boundary
 * mark-to-market accounting, crypto only.
 *
 * PROBLEM THIS SOLVES: the entry-attribution convention (Section 11.1)
 * credits a trade's ENTIRE pnl to the fold it entered in, even if the
 * trade stays open into a later fold (e.g. SOL's 2025-06-28 → 2025-07-30
 * trade, fully credited to the fold containing 06-28). This is a
 * legitimate convention, but it can distort which specific fold "caused"
 * a result. This script instead marks any open position to market AT each
 * fold boundary it crosses, splitting its pnl into per-fold segments.
 *
 * MECHANICS:
 *   For a trade spanning boundaries, split it into segments:
 *     [entryTime, boundary1) , [boundary1, boundary2) , ... [lastBoundary, exitTime]
 *   Each segment's "price change" is computed from the actual 4H candle
 *   close nearest each boundary. The true entryPrice/exitPrice and their
 *   slippage are used ONLY at the real entry and real exit — boundary
 *   marks use raw close price with NO slippage applied (they are an
 *   accounting split of a still-open position, not a real execution).
 *   This is an explicit, documented assumption — flagged per spec's
 *   "no silent improvisation" rule.
 *
 * Folds: fixed, matching the external audit (spec Section 11.1) —
 *   OOS start 2025-03-01 UTC, 9 non-overlapping 2-month folds.
 *
 * Usage: node scripts/walkforward-mtm-crypto.js
 */
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve('data/backtest-results');
const CANDLES_DIR = path.resolve('data/historical-4h');
const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB'];

const OOS_START = Date.UTC(2025, 2, 1); // 2025-03-01 UTC (month is 0-indexed)
const FOLD_COUNT = 9;
const FOLD_MONTHS = 2;

function addMonthsUTC(ms, months) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

function buildFixedFolds() {
  const folds = [];
  let start = OOS_START;
  for (let i = 0; i < FOLD_COUNT; i++) {
    const end = addMonthsUTC(start, FOLD_MONTHS);
    folds.push({ idx: i + 1, start, end });
    start = end;
  }
  return folds;
}

function loadJson(dir, filename) {
  const file = path.join(dir, filename);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// find the candle closest to (but not after) a given timestamp, for a
// mark-to-market price at a fold boundary
function priceAt(candles, timeMs) {
  let best = null;
  for (const c of candles) {
    if (c.time <= timeMs) best = c;
    else break;
  }
  return best ? best.close : null;
}

function splitTradeAcrossFolds(trade, folds, candles) {
  const segments = [];
  const boundaries = folds
    .map(f => f.start)
    .filter(b => b > trade.entryTime && b < trade.exitTime);

  const cutPoints = [trade.entryTime, ...boundaries, trade.exitTime];
  const prices = cutPoints.map((t, i) => {
    if (i === 0) return trade.entryPrice; // real entry
    if (i === cutPoints.length - 1) return trade.exitPrice; // real exit
    return priceAt(candles, t); // synthetic mark, no slippage
  });

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const segStart = cutPoints[i];
    const segEnd = cutPoints[i + 1];
    const pStart = prices[i];
    const pEnd = prices[i + 1];
    if (pStart == null || pEnd == null) continue; // missing candle data — skip segment

    const segPnlPct = trade.direction === 'LONG'
      ? pEnd / pStart - 1
      : pStart / pEnd - 1;

    // find which fold this segment's start falls into
    const fold = folds.find(f => segStart >= f.start && segStart < f.end);
    if (!fold) continue; // outside our 9 fixed folds — ignore

    segments.push({ foldIdx: fold.idx, segStart, segEnd, segPnlPct, isBoundarySplit: cutPoints.length > 2 });
  }
  return segments;
}

function foldMetrics(segments) {
  if (segments.length === 0) return { count: 0, netReturnPct: 0 };
  let equity = 1.0;
  for (const s of segments) equity *= (1 + s.segPnlPct);
  return { count: segments.length, netReturnPct: +((equity - 1) * 100).toFixed(2) };
}

function main() {
  const folds = buildFixedFolds();
  const baselineData = loadJson(RESULTS_DIR, 'baseline-4h-results.json');
  const variantBData = loadJson(RESULTS_DIR, 'variant-b-4h-ema-results.json');

  if (!baselineData || !variantBData) {
    console.error('Missing baseline or variant-b results JSON — run those backtests first.');
    process.exit(1);
  }

  console.log('Fold-boundary MARK-TO-MARKET comparison — A vs B, crypto only');
  console.log(`OOS folds: ${folds.length} × ${FOLD_MONTHS}mo, starting ${new Date(OOS_START).toISOString().slice(0,10)} UTC\n`);

  for (const sym of CRYPTO_SYMBOLS) {
    const candles = loadJson(CANDLES_DIR, `${sym}_4h.json`);
    const aTrades = baselineData.crypto?.[sym]?.trades ?? [];
    const bTrades = variantBData.crypto?.[sym]?.trades ?? [];
    if (!candles || aTrades.length === 0) { console.log(`${sym}: missing data, skipping`); continue; }

    console.log(`=== ${sym} ===`);

    const aFoldSegs = {}, bFoldSegs = {};
    for (const f of folds) { aFoldSegs[f.idx] = []; bFoldSegs[f.idx] = []; }

    let aSplitCount = 0, bSplitCount = 0;
    for (const t of aTrades) {
      const segs = splitTradeAcrossFolds(t, folds, candles);
      if (segs.length > 1) aSplitCount++;
      for (const s of segs) aFoldSegs[s.foldIdx].push(s);
    }
    for (const t of bTrades) {
      const segs = splitTradeAcrossFolds(t, folds, candles);
      if (segs.length > 1) bSplitCount++;
      for (const s of segs) bFoldSegs[s.foldIdx].push(s);
    }

    let bWinCount = 0, aWinCount = 0, comparable = 0;
    for (const f of folds) {
      const aM = foldMetrics(aFoldSegs[f.idx]);
      const bM = foldMetrics(bFoldSegs[f.idx]);
      if (aM.count === 0 && bM.count === 0) continue;
      comparable++;
      let verdict = '  → tie';
      if (bM.netReturnPct > aM.netReturnPct) { verdict = '  → B better'; bWinCount++; }
      else if (aM.netReturnPct > bM.netReturnPct) { verdict = '  → A better'; aWinCount++; }

      const label = `Fold ${String(f.idx).padStart(2,'0')} ${new Date(f.start).toISOString().slice(0,10)} → ${new Date(f.end).toISOString().slice(0,10)}`;
      console.log(`  ${label}`);
      console.log(`    A: ${String(aM.count).padStart(2)} segs, ${String(aM.netReturnPct).padStart(7)}%    B: ${String(bM.count).padStart(2)} segs, ${String(bM.netReturnPct).padStart(7)}%${verdict}`);
    }

    console.log(`  Summary: B better in ${bWinCount}/${comparable}, A better in ${aWinCount}/${comparable}`);
    console.log(`  Trades split across a boundary — A: ${aSplitCount}/${aTrades.length}, B: ${bSplitCount}/${bTrades.length}\n`);
  }

  console.log('Note: boundary marks use raw close price, no slippage (accounting split of an');
  console.log('open position, not a real execution) — this is an explicit documented assumption.');
  console.log('Compare this fold-by-fold pattern against the entry-attribution version (Section 11.2)');
  console.log('to see which folds are sensitive to the attribution convention chosen.');
}

main();
