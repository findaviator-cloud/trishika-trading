/**
 * scripts/backtest-variant-b.js
 *
 * Phase 4 — Variant B: 4H Donchian + completed-1D EMA(200) filter.
 * Identical engine to backtest-baseline-4h.js in every respect EXCEPT:
 *   entries additionally require price to be on the correct side of the
 *   EMA(200) computed from the most recently FULLY-COMPLETED 1D candle
 *   as of the entry bar's timestamp (spec Section 3 — never use the
 *   in-progress daily candle).
 *
 * Same exit rule, same slippage model, same capital model as A — only the
 * entry gate differs, per spec Section 4 (fees/slippage/execution must be
 * identical across A and B for a fair comparison).
 *
 * Usage:
 *   node scripts/backtest-variant-b.js                # all symbols
 *   node scripts/backtest-variant-b.js --symbol=BTC    # one symbol
 */
import fs from 'fs';
import path from 'path';
import { donchianSignal } from '../src/strategy/donchian.js';

const DATA_4H_DIR = path.resolve('data/historical-4h');
const DATA_1D_DIR = path.resolve('data/historical-1d');
const OUT_DIR      = path.resolve('data/backtest-results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const SLIPPAGE_PCT = 0.0005;
const EMA_LEN = 200; // locked — no parameter sweep, see spec Section 3

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

// ── EMA(200) series, precomputed once per symbol over the daily candles ───
function computeEmaSeries(dailyCandles, len) {
  const closes = dailyCandles.map(c => c.close);
  const emaArr = new Array(closes.length).fill(null);
  if (closes.length < len) return emaArr;

  const k = 2 / (len + 1);
  // seed with SMA of first `len` closes
  let ema = closes.slice(0, len).reduce((a, b) => a + b, 0) / len;
  emaArr[len - 1] = ema;
  for (let i = len; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    emaArr[i] = ema;
  }
  return emaArr;
}

// given a 4H bar's timestamp, find the EMA(200) value from the most
// recently FULLY-COMPLETED 1D candle strictly before this timestamp
function makeEmaLookup(dailyCandles, emaSeries) {
  // dailyCandles[i].time = UTC day start. A day is "fully completed" once
  // its own day-window has fully elapsed, i.e. at/after time + 24h.
  return function lookupEma(barTimeMs) {
    let idx = -1;
    for (let i = 0; i < dailyCandles.length; i++) {
      const dayCompletionTime = dailyCandles[i].time + 24 * 3_600_000;
      if (dayCompletionTime <= barTimeMs) idx = i;
      else break;
    }
    if (idx === -1 || emaSeries[idx] === null) return null;
    return { ema: emaSeries[idx], asOfDay: dailyCandles[idx].time };
  };
}

// ─────────────────────────────────────────────────────────────────────────
function runBacktest(sym, candles4h, dailyCandles, opts) {
  const minBars = Math.max(opts.donchianLen, opts.atrLen, opts.smaLen) + 2;
  if (candles4h.length < minBars + 1) {
    return { sym, status: 'INSUFFICIENT_4H_DATA', bars: candles4h.length, needed: minBars + 1 };
  }
  if (dailyCandles.length < EMA_LEN) {
    return { sym, status: 'INSUFFICIENT_1D_DATA_FOR_EMA', days: dailyCandles.length, needed: EMA_LEN };
  }

  const emaSeries = computeEmaSeries(dailyCandles, EMA_LEN);
  const lookupEma = makeEmaLookup(dailyCandles, emaSeries);

  const trades = [];
  let position = null;
  let emaBlockedCount = 0; // how many otherwise-valid entries the filter blocked

  for (let i = minBars; i < candles4h.length; i++) {
    const window = candles4h.slice(0, i + 1);
    const sig = donchianSignal(window, opts);
    const bar = candles4h[i];

    if (position) {
      const stopHit = position.direction === 1
        ? bar.low <= position.stopPrice
        : bar.high >= position.stopPrice;
      const oppositeSignal =
        (position.direction === 1 && sig.signal === 'SHORT') ||
        (position.direction === -1 && sig.signal === 'LONG');

      if (stopHit) {
        trades.push(closeTrade(position, position.stopPrice, bar.time, 'STOP'));
        position = null;
      } else if (oppositeSignal) {
        trades.push(closeTrade(position, sig.price, bar.time, 'REVERSAL'));
        position = null;
        // reversal entry also must pass the EMA filter
        const emaInfo = lookupEma(bar.time);
        const passesFilter = emaInfo && (
          (sig.direction === 1 && bar.close > emaInfo.ema) ||
          (sig.direction === -1 && bar.close < emaInfo.ema)
        );
        if (passesFilter) {
          position = {
            direction: sig.direction, entryPrice: sig.price,
            entryTime: bar.time, stopPrice: sig.stopPrice, entryIdx: i,
          };
        } else if (emaInfo) {
          emaBlockedCount++;
        }
      }
      continue;
    }

    if (sig.signal === 'LONG' || sig.signal === 'SHORT') {
      const emaInfo = lookupEma(bar.time);
      if (!emaInfo) continue; // no completed daily EMA yet — skip, don't guess

      const passesFilter =
        (sig.direction === 1 && bar.close > emaInfo.ema) ||
        (sig.direction === -1 && bar.close < emaInfo.ema);

      if (passesFilter) {
        position = {
          direction: sig.direction, entryPrice: sig.price,
          entryTime: bar.time, stopPrice: sig.stopPrice, entryIdx: i,
        };
      } else {
        emaBlockedCount++;
      }
    }
  }

  return { sym, status: 'OK', trades, emaBlockedCount };
}

function closeTrade(position, exitPrice, exitTime, exitReason) {
  const grossPnlPct = position.direction === 1
    ? exitPrice / position.entryPrice - 1
    : position.entryPrice / exitPrice - 1;

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
    entryTime: position.entryTime, exitTime,
    entryPrice: position.entryPrice, exitPrice, exitReason,
    grossPnlPct, netPnlPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────
function computeMetrics(trades) {
  if (trades.length === 0) return { tradeCount: 0 };

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
    for (const v of curve) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, (peak - v) / peak); }
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
  console.log('Variant B: 4H Donchian + completed-1D EMA(200) filter\n');
  const allResults = {};

  for (const [group, { symbols, opts }] of Object.entries(SYMBOL_GROUPS)) {
    console.log(`=== ${group.toUpperCase()} ===`);
    allResults[group] = {};

    for (const sym of symbols) {
      if (onlySymbol && sym !== onlySymbol) continue;

      const file4h = path.join(DATA_4H_DIR, `${sym}_4h.json`);
      const file1d = path.join(DATA_1D_DIR, `${sym}_1d.json`);
      if (!fs.existsSync(file4h) || !fs.existsSync(file1d)) {
        console.log(`  ❌ ${sym}: missing 4H or 1D data file`);
        continue;
      }
      const candles4h = JSON.parse(fs.readFileSync(file4h, 'utf8'));
      const dailyCandles = JSON.parse(fs.readFileSync(file1d, 'utf8'));
      const result = runBacktest(sym, candles4h, dailyCandles, opts);

      if (result.status !== 'OK') {
        console.log(`  ❌ ${sym}: ${result.status}`);
        continue;
      }

      const metrics = computeMetrics(result.trades);
      allResults[group][sym] = { metrics, trades: result.trades, emaBlockedCount: result.emaBlockedCount };

      if (metrics.tradeCount === 0) {
        console.log(`  ⚠️  ${sym}: 0 trades (EMA-blocked: ${result.emaBlockedCount})`);
        continue;
      }

      console.log(
        `  ✅ ${sym.padEnd(10)} trades=${metrics.tradeCount}  winRate=${metrics.winRate}%  ` +
        `net=${metrics.netReturnPct}%  (gross=${metrics.grossReturnPct}%)  ` +
        `maxDD=${metrics.netMaxDrawdownPct}%  PF=${metrics.netProfitFactor}  ` +
        `emaBlocked=${result.emaBlockedCount}`
      );
    }
    console.log('');
  }

  const outFile = path.join(OUT_DIR, 'variant-b-4h-ema-results.json');
  fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`Full results saved → ${outFile}`);
}

main();
