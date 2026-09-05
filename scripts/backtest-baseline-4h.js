/**
 * scripts/backtest-baseline-4h.js
 *
 * Phase 2 — Variant A: 4H-only baseline backtest. No EMA filter.
 *
 * Imports the REAL production donchianSignal() directly from
 * src/strategy/donchian.js — not a copy — so the entry logic can never
 * drift from what's actually running in production.
 *
 * Exit rule: see backtest-spec.md Section 2.1 (explicit assumption, since
 * production has no automated exit logic to reproduce):
 *   exit on stop-hit OR opposite-signal, whichever comes first.
 *   Same-bar conflict → stop-hit takes priority (conservative).
 *
 * Capital model: fixed-capital-per-trade, compounding per-symbol equity
 * curve — matches execution.js's paper-equity pattern (the only concrete
 * production precedent for capital handling). Documented assumption.
 *
 * Slippage: same model as execution.js — 0.05% unfavorable on both entry
 * and exit fills. Gross (no slippage) AND net (with slippage) results are
 * both reported per spec Section 6.
 *
 * Usage:
 *   node scripts/backtest-baseline-4h.js                # all symbols
 *   node scripts/backtest-baseline-4h.js --symbol=BTC    # one symbol
 */
import fs from 'fs';
import path from 'path';
import { donchianSignal } from '../src/strategy/donchian.js';

const DATA_DIR = path.resolve('data/historical-4h');
const OUT_DIR  = path.resolve('data/backtest-results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const SLIPPAGE_PCT = 0.0005; // matches execution.js

// ── exact production configs, verified against live_signal_writer.js ──────
const HOURLY_OPTS = { donchianLen: 30, atrLen: 14, atrMult: 2.0, smaLen: 100, allowLong: true, allowShort: true };
const FNO_OPTS    = { donchianLen: 30, atrLen: 14, atrMult: 2.0, smaLen: 50,  allowLong: true, allowShort: true };

const SYMBOL_GROUPS = {
  crypto: { symbols: ['BTC', 'ETH', 'SOL', 'BNB'],            opts: HOURLY_OPTS },
  forex:  { symbols: ['EUR_USD', 'XAU_USD'],                   opts: HOURLY_OPTS },
  fno:    { symbols: [
    'NIFTY','BANKNIFTY','RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','SBIN',
    'BHARTIARTL','ITC','WIPRO','HCLTECH','AXISBANK','KOTAKBANK','LT','ONGC',
    'BAJFINANCE','MARUTI','ADANIENT',
  ], opts: FNO_OPTS },
};

const args = process.argv.slice(2);
const symbolArg = args.find(a => a.startsWith('--symbol='));
const onlySymbol = symbolArg ? symbolArg.split('=')[1] : null;

// ─────────────────────────────────────────────────────────────────────────
function runBacktest(sym, candles, opts) {
  const minBars = Math.max(opts.donchianLen, opts.atrLen, opts.smaLen) + 2;
  if (candles.length < minBars + 1) {
    return { sym, status: 'INSUFFICIENT_DATA', bars: candles.length, needed: minBars + 1 };
  }

  const trades = [];
  let position = null; // { direction, entryPrice, entryTime, stopPrice, entryIdx }

  for (let i = minBars; i < candles.length; i++) {
    const window = candles.slice(0, i + 1); // donchianSignal uses candles[len-1] as curr, [len-2] as prev
    const sig = donchianSignal(window, opts);
    const bar = candles[i];

    if (position) {
      // 1. stop-hit check (this bar's high/low)
      const stopHit = position.direction === 1
        ? bar.low <= position.stopPrice
        : bar.high >= position.stopPrice;

      // 2. opposite-signal check (fresh breakout in opposite direction)
      const oppositeSignal =
        (position.direction === 1 && sig.signal === 'SHORT') ||
        (position.direction === -1 && sig.signal === 'LONG');

      if (stopHit) {
        // conservative: stop-hit wins same-bar conflicts
        trades.push(closeTrade(position, position.stopPrice, bar.time, 'STOP'));
        position = null;
        // opposite signal (if any) not acted on this bar — will need to
        // re-trigger on a later bar per the locked exit-rule assumption
      } else if (oppositeSignal) {
        trades.push(closeTrade(position, sig.price, bar.time, 'REVERSAL'));
        position = null;
        // open the new opposite position immediately at this same bar's open
        position = {
          direction: sig.direction,
          entryPrice: sig.price,
          entryTime: bar.time,
          stopPrice: sig.stopPrice,
          entryIdx: i,
        };
      }
      continue;
    }

    // no open position — check for fresh entry
    if (sig.signal === 'LONG' || sig.signal === 'SHORT') {
      position = {
        direction: sig.direction,
        entryPrice: sig.price,
        entryTime: bar.time,
        stopPrice: sig.stopPrice,
        entryIdx: i,
      };
    }
  }

  return { sym, status: 'OK', trades, barsUsed: candles.length - minBars };
}

function closeTrade(position, exitPrice, exitTime, exitReason) {
  const grossPnlPct = position.direction === 1
    ? exitPrice / position.entryPrice - 1
    : position.entryPrice / exitPrice - 1;

  // net: apply slippage unfavorably on both entry and exit fills
  const entryFill = position.direction === 1
    ? position.entryPrice * (1 + SLIPPAGE_PCT)
    : position.entryPrice * (1 - SLIPPAGE_PCT);
  const exitFill = position.direction === 1
    ? exitPrice * (1 - SLIPPAGE_PCT)
    : exitPrice * (1 + SLIPPAGE_PCT);
  const netPnlPct = position.direction === 1
    ? exitFill / entryFill - 1
    : entryFill / exitFill - 1;

  return {
    direction: position.direction === 1 ? 'LONG' : 'SHORT',
    entryTime: position.entryTime,
    exitTime,
    entryPrice: position.entryPrice,
    exitPrice,
    exitReason,
    grossPnlPct,
    netPnlPct,
    holdingBars: null, // filled by caller if needed
  };
}

// ─────────────────────────────────────────────────────────────────────────
function computeMetrics(trades) {
  if (trades.length === 0) {
    return { tradeCount: 0 };
  }

  const gross = trades.map(t => t.grossPnlPct);
  const net   = trades.map(t => t.netPnlPct);

  function equityCurve(pnls) {
    let equity = 1.0;
    const curve = [equity];
    for (const p of pnls) { equity *= (1 + p); curve.push(equity); }
    return curve;
  }
  function maxDrawdown(curve) {
    let peak = curve[0], maxDd = 0;
    for (const v of curve) {
      peak = Math.max(peak, v);
      maxDd = Math.max(maxDd, (peak - v) / peak);
    }
    return maxDd;
  }
  function profitFactor(pnls) {
    const wins = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const losses = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
    return losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;
  }
  function maxLosingStreak(pnls) {
    let cur = 0, max = 0;
    for (const p of pnls) { if (p < 0) { cur++; max = Math.max(max, cur); } else cur = 0; }
    return max;
  }

  const grossCurve = equityCurve(gross);
  const netCurve   = equityCurve(net);
  const wins = trades.filter(t => t.netPnlPct > 0).length;

  return {
    tradeCount: trades.length,
    winRate: +(wins / trades.length * 100).toFixed(2),
    grossReturnPct: +((grossCurve.at(-1) - 1) * 100).toFixed(2),
    netReturnPct: +((netCurve.at(-1) - 1) * 100).toFixed(2),
    grossMaxDrawdownPct: +(maxDrawdown(grossCurve) * 100).toFixed(2),
    netMaxDrawdownPct: +(maxDrawdown(netCurve) * 100).toFixed(2),
    grossProfitFactor: +profitFactor(gross).toFixed(3),
    netProfitFactor: +profitFactor(net).toFixed(3),
    expectancyPctNet: +(net.reduce((s, p) => s + p, 0) / trades.length * 100).toFixed(4),
    maxLosingStreak: maxLosingStreak(net),
    exitReasons: {
      STOP: trades.filter(t => t.exitReason === 'STOP').length,
      REVERSAL: trades.filter(t => t.exitReason === 'REVERSAL').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
function main() {
  console.log('Baseline (Variant A) 4H Donchian backtest — no EMA filter\n');
  const allResults = {};

  for (const [group, { symbols, opts }] of Object.entries(SYMBOL_GROUPS)) {
    console.log(`=== ${group.toUpperCase()} ===`);
    allResults[group] = {};

    for (const sym of symbols) {
      if (onlySymbol && sym !== onlySymbol) continue;

      const file = path.join(DATA_DIR, `${sym}_4h.json`);
      if (!fs.existsSync(file)) {
        console.log(`  ❌ ${sym}: no 4H data file — run resample-4h.js first`);
        continue;
      }
      const candles = JSON.parse(fs.readFileSync(file, 'utf8'));
      const result = runBacktest(sym, candles, opts);

      if (result.status !== 'OK') {
        console.log(`  ❌ ${sym}: ${result.status} (${result.bars}/${result.needed} bars)`);
        continue;
      }

      const metrics = computeMetrics(result.trades);
      allResults[group][sym] = { metrics, trades: result.trades };

      if (metrics.tradeCount === 0) {
        console.log(`  ⚠️  ${sym}: 0 trades generated (data may be too short for warm-up)`);
        continue;
      }

      console.log(
        `  ✅ ${sym.padEnd(10)} trades=${metrics.tradeCount}  winRate=${metrics.winRate}%  ` +
        `net=${metrics.netReturnPct}%  (gross=${metrics.grossReturnPct}%)  ` +
        `maxDD=${metrics.netMaxDrawdownPct}%  PF=${metrics.netProfitFactor}  ` +
        `expectancy=${metrics.expectancyPctNet}%/trade`
      );
    }
    console.log('');
  }

  const outFile = path.join(OUT_DIR, 'baseline-4h-results.json');
  fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`Full results (incl. per-trade detail) saved → ${outFile}`);
}

main();
