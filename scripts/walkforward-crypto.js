/**
 * scripts/walkforward-crypto.js
 *
 * Phase 5 — Crypto out-of-sample calendar-window evaluation.
 *
 * Purpose:
 * Compare Variant A (baseline) and Variant B (completed daily EMA-200
 * filtered) across predefined non-overlapping two-calendar-month UTC
 * evaluation windows.
 *
 * Core methodology:
 * - Variant A and Variant B trades must come from one continuous,
 *   fully warmed causal historical backtest run.
 * - This script does NOT re-train, re-optimize, or re-warm indicators
 *   at individual fold boundaries.
 * - The EMA(200) parameter is locked. No parameter sweep is performed.
 * - The script only assigns already-computed completed trades into
 *   predefined calendar OOS windows.
 *
 * OOS start:
 * - 2025-03-01 UTC is the locked comparable OOS start date.
 * - Earlier history is used for indicator warm-up only.
 * - Periods before this date are excluded because Variant B's daily
 *   EMA(200) was not yet fully warmed and therefore not comparable.
 *
 * Attribution limitation:
 * - Trades are attributed to a window by trade ENTRY timestamp.
 * - A trade can exit after the end of its assigned window.
 * - This is trade-entry attribution analysis, NOT fold-boundary
 *   mark-to-market equity accounting.
 * - A final production-risk decision requires a separate backtest that
 *   force-closes or marks all open positions to market at every fold end.
 *
 * Input:
 *   data/backtest-results/baseline-4h-results.json
 *   data/backtest-results/variant-b-4h-ema-results.json
 *
 * Output:
 *   data/backtest-results/walkforward-crypto-results.json
 *
 * Usage:
 *   node scripts/walkforward-crypto.js
 */

import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve('data/backtest-results');

const BASELINE_FILE = 'baseline-4h-results.json';
const VARIANT_B_FILE = 'variant-b-4h-ema-results.json';

const OUTPUT_FILE = path.join(
  RESULTS_DIR,
  'walkforward-crypto-results.json'
);

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB'];

/**
 * Locked comparable OOS start:
 * 2025-03-01 UTC.
 */
const OOS_START_MS = Date.UTC(2025, 2, 1);

function loadResults(filename) {
  const file = path.join(RESULTS_DIR, filename);

  if (!fs.existsSync(file)) {
    console.error(
      `Missing ${filename} — run the corresponding backtest script first.`
    );
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcStartOfMonth(ms) {
  const date = new Date(ms);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    1
  );
}

function addUtcMonths(ms, months) {
  const date = new Date(ms);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1
  );
}

function fmtWindow(startMs, endMsExclusive) {
  return `${fmtDate(startMs)} → ${fmtDate(endMsExclusive - 1)}`;
}

function buildTwoMonthWindows(startMs, endMs) {
  const windows = [];
  let wStart = utcStartOfMonth(startMs);

  while (wStart < endMs) {
    const wEnd = addUtcMonths(wStart, 2);

    windows.push({
      wStart,
      wEnd,
      label: fmtWindow(wStart, wEnd),
    });

    wStart = wEnd;
  }

  return windows;
}

function tradesInWindowByEntry(trades, startMs, endMs) {
  return trades.filter(
    trade =>
      trade.entryTime >= startMs &&
      trade.entryTime < endMs
  );
}

function compoundReturnPct(trades) {
  let equity = 1;

  for (const trade of trades) {
    equity *= 1 + trade.netPnlPct;
  }

  return (equity - 1) * 100;
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function windowMetrics(trades) {
  if (!trades.length) {
    return {
      status: 'NO_TRADE',
      tradeCount: 0,
      netReturnPct: 0,
      winRatePct: null,
    };
  }

  const wins = trades.filter(
    trade => trade.netPnlPct > 0
  ).length;

  return {
    status: 'TRADED',
    tradeCount: trades.length,
    netReturnPct: +compoundReturnPct(trades).toFixed(2),
    winRatePct: +((wins / trades.length) * 100).toFixed(1),
  };
}

function classifyComparison(aMetrics, bMetrics) {
  if (
    aMetrics.status === 'NO_TRADE' &&
    bMetrics.status === 'NO_TRADE'
  ) {
    return 'BOTH_NO_TRADE';
  }

  if (bMetrics.netReturnPct > aMetrics.netReturnPct) {
    return 'B_BETTER';
  }

  if (aMetrics.netReturnPct > bMetrics.netReturnPct) {
    return 'A_BETTER';
  }

  return 'TIE';
}

function getOosEndMs(aTrades, bTrades) {
  const eligibleTimes = [
    ...aTrades
      .filter(trade => trade.entryTime >= OOS_START_MS)
      .map(trade => trade.entryTime),

    ...bTrades
      .filter(trade => trade.entryTime >= OOS_START_MS)
      .map(trade => trade.entryTime),
  ];

  if (!eligibleTimes.length) {
    return null;
  }

  return Math.max(...eligibleTimes) + 1;
}

function summarizeAsset(symbol, allATrades, allBTrades) {
  const aTrades = allATrades.filter(
    trade => trade.entryTime >= OOS_START_MS
  );

  const bTrades = allBTrades.filter(
    trade => trade.entryTime >= OOS_START_MS
  );

  const oosEndMs = getOosEndMs(aTrades, bTrades);

  if (!oosEndMs) {
    return {
      symbol,
      status: 'NO_TRADES_AFTER_OOS_START',
      windows: [],
      summary: null,
    };
  }

  const windows = buildTwoMonthWindows(
    OOS_START_MS,
    oosEndMs
  );

  const rows = [];

  let comparableWindows = 0;
  let aWins = 0;
  let bWins = 0;
  let ties = 0;

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index];

    const aWindowTrades = tradesInWindowByEntry(
      aTrades,
      window.wStart,
      window.wEnd
    );

    const bWindowTrades = tradesInWindowByEntry(
      bTrades,
      window.wStart,
      window.wEnd
    );

    const aMetrics = windowMetrics(aWindowTrades);
    const bMetrics = windowMetrics(bWindowTrades);
    const verdict = classifyComparison(aMetrics, bMetrics);

    if (verdict !== 'BOTH_NO_TRADE') {
      comparableWindows++;

      if (verdict === 'A_BETTER') {
        aWins++;
      } else if (verdict === 'B_BETTER') {
        bWins++;
      } else {
        ties++;
      }
    }

    rows.push({
      fold: index + 1,
      windowStart: fmtDate(window.wStart),
      windowEnd: fmtDate(window.wEnd - 1),
      label: window.label,
      variantA: aMetrics,
      variantB: bMetrics,
      differenceBMinusA: +(
        bMetrics.netReturnPct - aMetrics.netReturnPct
      ).toFixed(2),
      verdict,
    });
  }

  const validRows = rows.filter(
    row => row.verdict !== 'BOTH_NO_TRADE'
  );

  const aFoldReturns = validRows.map(
    row => row.variantA.netReturnPct
  );

  const bFoldReturns = validRows.map(
    row => row.variantB.netReturnPct
  );

  const aMedian = median(aFoldReturns);
  const bMedian = median(bFoldReturns);

  const aWorst = aFoldReturns.length
    ? Math.min(...aFoldReturns)
    : null;

  const bWorst = bFoldReturns.length
    ? Math.min(...bFoldReturns)
    : null;

  const aBest = aFoldReturns.length
    ? Math.max(...aFoldReturns)
    : null;

  const bBest = bFoldReturns.length
    ? Math.max(...bFoldReturns)
    : null;

  return {
    symbol,
    status: 'OK',
    oosStart: fmtDate(OOS_START_MS),
    attributionMethod: 'ENTRY_TIME',
    attributionLimitation:
      'Trades are assigned by entry timestamp. Returns are not force-settled or marked to market at OOS fold boundaries.',
    windows: rows,
    summary: {
      comparableWindows,
      variantAWins: aWins,
      variantBWins: bWins,
      ties,

      variantBWinRatioPct: comparableWindows > 0
        ? +((bWins / comparableWindows) * 100).toFixed(1)
        : null,

      variantAAggregatePct: +compoundReturnPct(aTrades).toFixed(2),
      variantBAggregatePct: +compoundReturnPct(bTrades).toFixed(2),

      variantAMedianFoldPct: aMedian === null
        ? null
        : +aMedian.toFixed(2),

      variantBMedianFoldPct: bMedian === null
        ? null
        : +bMedian.toFixed(2),

      medianImprovementBMinusA: (
        aMedian === null || bMedian === null
      )
        ? null
        : +(bMedian - aMedian).toFixed(2),

      variantAWorstFoldPct: aWorst === null
        ? null
        : +aWorst.toFixed(2),

      variantBWorstFoldPct: bWorst === null
        ? null
        : +bWorst.toFixed(2),

      worstFoldImprovementBMinusA: (
        aWorst === null || bWorst === null
      )
        ? null
        : +(bWorst - aWorst).toFixed(2),

      variantABestFoldPct: aBest === null
        ? null
        : +aBest.toFixed(2),

      variantBBestFoldPct: bBest === null
        ? null
        : +bBest.toFixed(2),
    },
  };
}

function formatMetrics(label, metrics) {
  if (metrics.status === 'NO_TRADE') {
    return `${label}: NO_TRADE`;
  }

  return (
    `${label}: ${String(metrics.tradeCount).padStart(2)} trades, ` +
    `${String(metrics.netReturnPct).padStart(7)}%`
  );
}

function printAsset(result) {
  console.log(`\n=== ${result.symbol} ===`);

  if (result.status !== 'OK') {
    console.log('No eligible OOS trades after the locked OOS start date.');
    return;
  }

  for (const row of result.windows) {
    if (row.verdict === 'BOTH_NO_TRADE') {
      continue;
    }

    const verdictText = {
      A_BETTER: '→ A better',
      B_BETTER: '→ B better',
      TIE: '→ Tie',
    }[row.verdict];

    console.log(
      `Fold ${String(row.fold).padStart(2)}  ${row.label}  ` +
      `${formatMetrics('A', row.variantA)}  ` +
      `${formatMetrics('B', row.variantB)}  ` +
      `${verdictText}`
    );
  }

  const s = result.summary;

  console.log(
    `Summary: B better ${s.variantBWins}/${s.comparableWindows} windows ` +
    `(${s.variantBWinRatioPct}%), A better ${s.variantAWins}/${s.comparableWindows}, ` +
    `ties ${s.ties}`
  );

  console.log(
    `Aggregate return — A: ${s.variantAAggregatePct}% | ` +
    `B: ${s.variantBAggregatePct}%`
  );

  console.log(
    `Median fold return — A: ${s.variantAMedianFoldPct}% | ` +
    `B: ${s.variantBMedianFoldPct}% | ` +
    `B − A: ${s.medianImprovementBMinusA} pp`
  );

  console.log(
    `Worst fold — A: ${s.variantAWorstFoldPct}% | ` +
    `B: ${s.variantBWorstFoldPct}% | ` +
    `B − A: ${s.worstFoldImprovementBMinusA} pp`
  );

  console.log(
    `Best fold — A: ${s.variantABestFoldPct}% | ` +
    `B: ${s.variantBBestFoldPct}%`
  );
}

function main() {
  const baselineData = loadResults(BASELINE_FILE);
  const variantBData = loadResults(VARIANT_B_FILE);

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Crypto only: BTC, ETH, SOL, BNB',
    oosStart: fmtDate(OOS_START_MS),
    inputFiles: {
      variantA: BASELINE_FILE,
      variantB: VARIANT_B_FILE,
    },
    windowDefinition:
      'Non-overlapping two-calendar-month UTC windows',
    attributionMethod:
      'Trade entry timestamp',
    methodologyWarning:
      'This is entry-time trade attribution, not fold-boundary mark-to-market equity accounting. A trade may exit outside the OOS window to which it is attributed.',
    assets: {},
    overall: {
      comparableWindows: 0,
      variantAWins: 0,
      variantBWins: 0,
      ties: 0,
      variantBWinRatioPct: null,
    },
  };

  console.log(
    'Crypto OOS calendar-window comparison — Variant A vs Variant B'
  );

  console.log(
    `Locked comparable OOS start: ${fmtDate(OOS_START_MS)} UTC`
  );

  console.log(
    'Window definition: non-overlapping two-calendar-month UTC periods.'
  );

  console.log(
    'Attribution method: trade entry timestamp.'
  );

  console.log(
    'Warning: trade attribution is not fold-boundary mark-to-market accounting.'
  );

  for (const symbol of CRYPTO_SYMBOLS) {
    const aEntry = baselineData.crypto?.[symbol];
    const bEntry = variantBData.crypto?.[symbol];

    if (!aEntry || !bEntry) {
      console.log(`\n=== ${symbol} ===`);
      console.log('Missing Variant A or Variant B result data; skipped.');
      continue;
    }

    const result = summarizeAsset(
      symbol,
      aEntry.trades ?? [],
      bEntry.trades ?? []
    );

    report.assets[symbol] = result;
    printAsset(result);

    if (result.summary) {
      report.overall.comparableWindows +=
        result.summary.comparableWindows;

      report.overall.variantAWins +=
        result.summary.variantAWins;

      report.overall.variantBWins +=
        result.summary.variantBWins;

      report.overall.ties +=
        result.summary.ties;
    }
  }

  const overall = report.overall;

  overall.variantBWinRatioPct = overall.comparableWindows > 0
    ? +(
      (overall.variantBWins / overall.comparableWindows) * 100
    ).toFixed(1)
    : null;

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log('\n=== OVERALL CROSS-ASSET SUMMARY ===');

  console.log(
    `B better: ${overall.variantBWins}/${overall.comparableWindows} ` +
    `windows (${overall.variantBWinRatioPct}%)`
  );

  console.log(
    `A better: ${overall.variantAWins}/${overall.comparableWindows}`
  );

  console.log(`Ties: ${overall.ties}`);

  console.log(`\nSaved machine-readable report: ${OUTPUT_FILE}`);

  console.log('\nAudit interpretation notes:');

  console.log(
    '- OOS comparison begins after the EMA-200 warm-up period, at the locked 2025-03-01 UTC start date.'
  );

  console.log(
    '- High B win frequency is empirical robustness evidence, not standalone proof of statistical significance.'
  );

  console.log(
    '- Crypto assets share market regimes; asset-window observations are correlated and are not fully independent trials.'
  );

  console.log(
    '- Production-risk decisions require fold-boundary force-close or mark-to-market accounting, risk-adjusted metrics, slippage stress testing, and holdout validation.'
  );
}

main();
