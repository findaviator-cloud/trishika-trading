/**
 * scripts/risk-adjusted-crypto-metrics.js
 *
 * Supplementary risk-adjusted metrics for frozen crypto OOS results.
 *
 * Two separate, non-mixed inclusion conventions are reported:
 *
 * 1. ENTRY_ATTRIBUTION
 *    Includes trades whose entryTime >= locked OOS start.
 *    Use: signal-cohort consistency with the walk-forward fold analysis.
 *
 * 2. EXIT_REALIZATION
 *    Includes trades whose exitTime >= locked OOS start.
 *    Use: closed-trade realization diagnostic.
 *
 * Important limitations:
 * - Both views use closed-trade net returns and sequential trade compounding.
 * - Neither view is daily/4H marked-to-market portfolio equity accounting.
 * - Trades may overlap across symbols; each asset is evaluated independently.
 * - Trade-level Sharpe/Sortino use irregularly spaced trade outcomes.
 * - CVaR-95 and CVaR-99 are empirical tail-loss diagnostics, not stable
 *   parametric tail estimates when sample sizes are small.
 * - Final production-risk approval requires fold-boundary MTM equity:
 *   open positions marked at OOS start, every boundary, and OOS end.
 *
 * Inputs:
 *   data/backtest-results/baseline-4h-results.json
 *   data/backtest-results/variant-b-4h-ema-results.json
 *
 * Outputs:
 *   data/backtest-results/risk-adjusted-crypto-metrics.json
 *   data/backtest-results/risk-adjusted-crypto-metrics.csv
 *
 * Usage:
 *   node scripts/risk-adjusted-crypto-metrics.js
 */

import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve('data/backtest-results');

const BASELINE_FILE = 'baseline-4h-results.json';
const VARIANT_B_FILE = 'variant-b-4h-ema-results.json';

const OUTPUT_JSON = path.join(
  RESULTS_DIR,
  'risk-adjusted-crypto-metrics.json'
);

const OUTPUT_CSV = path.join(
  RESULTS_DIR,
  'risk-adjusted-crypto-metrics.csv'
);

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB'];

const OOS_START_MS = Date.UTC(2025, 2, 1);
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const RISK_FREE_RATE_PER_TRADE = 0;
const SORTINO_TARGET_PER_TRADE = 0;

const MODES = {
  ENTRY_ATTRIBUTION: {
    key: 'ENTRY_ATTRIBUTION',
    label: 'OOS Entry-Attributed Closed-Trade Metrics',
    inclusionRule:
      'Include a closed trade if entryTime >= OOS_START_MS.',
    primaryTimeField: 'entryTime',
    limitation:
      'A trade may realize after its entry-attributed OOS window.',
  },

  EXIT_REALIZATION: {
    key: 'EXIT_REALIZATION',
    label: 'OOS Exit-Realized Closed-Trade Metrics',
    inclusionRule:
      'Include a closed trade if exitTime >= OOS_START_MS.',
    primaryTimeField: 'exitTime',
    limitation:
      'A pre-OOS trade can contribute its full lifetime P&L if it exits during OOS.',
  },
};

function loadJson(filename) {
  const file = path.join(RESULTS_DIR, filename);

  if (!fs.existsSync(file)) {
    console.error(`Missing required result file: ${file}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fmtDate(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }

  return new Date(ms).toISOString().slice(0, 10);
}

function round(value, decimals = 4) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce(
    (sum, value) => sum + value,
    0
  ) / values.length;
}

function sampleStdDev(values) {
  if (values.length < 2) {
    return null;
  }

  const avg = mean(values);

  const variance = values.reduce(
    (sum, value) => sum + (value - avg) ** 2,
    0
  ) / (values.length - 1);

  return Math.sqrt(variance);
}

function downsideDeviation(values, target = 0) {
  if (!values.length) {
    return null;
  }

  const squaredDownside = values.map(
    value => Math.min(0, value - target) ** 2
  );

  const averageSquaredDownside = squaredDownside.reduce(
    (sum, value) => sum + value,
    0
  ) / squaredDownside.length;

  return Math.sqrt(averageSquaredDownside);
}

function empiricalCvar(values, confidenceLevel) {
  if (!values.length) {
    return null;
  }

  const tailCount = Math.max(
    1,
    Math.ceil(values.length * (1 - confidenceLevel))
  );

  const sortedAscending = [...values].sort(
    (a, b) => a - b
  );

  const tailReturns = sortedAscending.slice(0, tailCount);

  return {
    confidenceLevel,
    tailCount,
    cvar: mean(tailReturns),
    worstTrade: sortedAscending[0],
    note: tailCount === 1
      ? 'Tail contains one trade; interpret as worst-trade diagnostic.'
      : `Tail contains ${tailCount} worst closed trades.`,
  };
}

function buildSequentialEquityCurve(returns) {
  let equity = 1;
  let peak = 1;

  const points = [{
    sequence: 0,
    equity: 1,
    peak: 1,
    drawdown: 0,
  }];

  for (let index = 0; index < returns.length; index++) {
    equity *= 1 + returns[index];
    peak = Math.max(peak, equity);

    const drawdown = peak === 0
      ? 0
      : (equity - peak) / peak;

    points.push({
      sequence: index + 1,
      equity,
      peak,
      drawdown,
    });
  }

  return points;
}

function maxDrawdown(equityCurve) {
  if (!equityCurve.length) {
    return null;
  }

  return Math.min(
    ...equityCurve.map(point => point.drawdown)
  );
}

function ulcerIndex(equityCurve) {
  if (equityCurve.length <= 1) {
    return null;
  }

  const drawdowns = equityCurve
    .slice(1)
    .map(point => point.drawdown);

  const meanSquaredDrawdown = drawdowns.reduce(
    (sum, drawdown) => sum + drawdown ** 2,
    0
  ) / drawdowns.length;

  return Math.sqrt(meanSquaredDrawdown);
}

function sortClosedTrades(trades) {
  return [...trades].sort((a, b) => {
    const aExit = a.exitTime ?? a.entryTime;
    const bExit = b.exitTime ?? b.entryTime;

    if (aExit !== bExit) {
      return aExit - bExit;
    }

    return a.entryTime - b.entryTime;
  });
}

function normaliseTrade(trade) {
  if (
    !Number.isFinite(trade.entryTime) ||
    !Number.isFinite(trade.exitTime) ||
    !Number.isFinite(trade.netPnlPct)
  ) {
    return null;
  }

  return trade;
}

function selectTradesByMode(trades, mode) {
  const closedTrades = trades
    .map(normaliseTrade)
    .filter(Boolean);

  if (mode.key === 'ENTRY_ATTRIBUTION') {
    return sortClosedTrades(
      closedTrades.filter(
        trade => trade.entryTime >= OOS_START_MS
      )
    );
  }

  if (mode.key === 'EXIT_REALIZATION') {
    return sortClosedTrades(
      closedTrades.filter(
        trade => trade.exitTime >= OOS_START_MS
      )
    );
  }

  throw new Error(`Unsupported metric mode: ${mode.key}`);
}

function computeMetrics(symbol, variant, allTrades, mode) {
  const trades = selectTradesByMode(allTrades, mode);

  if (!trades.length) {
    return {
      symbol,
      variant,
      mode: mode.key,
      status: 'NO_ELIGIBLE_CLOSED_TRADES',
      methodology: {
        oosStartUtc: fmtDate(OOS_START_MS),
        inclusionRule: mode.inclusionRule,
      },
    };
  }

  const returns = trades.map(
    trade => trade.netPnlPct
  );

  const firstEntryMs = Math.min(
    ...trades.map(trade => trade.entryTime)
  );

  const lastExitMs = Math.max(
    ...trades.map(trade => trade.exitTime)
  );

  const durationStartMs = mode.key === 'ENTRY_ATTRIBUTION'
    ? OOS_START_MS
    : Math.min(OOS_START_MS, firstEntryMs);

  const durationYears = Math.max(
    (lastExitMs - durationStartMs) / MS_PER_YEAR,
    1 / 365.25
  );

  const tradeCount = trades.length;
  const tradesPerYear = tradeCount / durationYears;

  const averageReturn = mean(returns);
  const standardDeviation = sampleStdDev(returns);
  const downsideDev = downsideDeviation(
    returns,
    SORTINO_TARGET_PER_TRADE
  );

  const averageExcessReturn = averageReturn === null
    ? null
    : averageReturn - RISK_FREE_RATE_PER_TRADE;

  const annualizedSharpe = (
    averageExcessReturn === null ||
    standardDeviation === null ||
    standardDeviation === 0
  )
    ? null
    : (
      averageExcessReturn /
      standardDeviation
    ) * Math.sqrt(tradesPerYear);

  const annualizedSortino = (
    averageReturn === null ||
    downsideDev === null ||
    downsideDev === 0
  )
    ? null
    : (
      (averageReturn - SORTINO_TARGET_PER_TRADE) /
      downsideDev
    ) * Math.sqrt(tradesPerYear);

  const equityCurve = buildSequentialEquityCurve(returns);

  const endingEquity = equityCurve.at(-1).equity;
  const totalReturn = endingEquity - 1;

  const cagr = endingEquity > 0
    ? endingEquity ** (1 / durationYears) - 1
    : null;

  const maximumDrawdown = maxDrawdown(equityCurve);

  const calmar = (
    cagr === null ||
    maximumDrawdown === null ||
    maximumDrawdown === 0
  )
    ? null
    : cagr / Math.abs(maximumDrawdown);

  const cvar95 = empiricalCvar(returns, 0.95);
  const cvar99 = empiricalCvar(returns, 0.99);

  const wins = returns.filter(
    value => value > 0
  ).length;

  const losses = returns.filter(
    value => value < 0
  ).length;

  return {
    symbol,
    variant,
    mode: mode.key,
    status: 'OK',

    methodology: {
      modeLabel: mode.label,
      oosStartUtc: fmtDate(OOS_START_MS),
      inclusionRule: mode.inclusionRule,
      modeLimitation: mode.limitation,
      returnBasis: 'Net closed-trade P&L percentage',
      equityBasis:
        'Sequential compounding by closed trade, ordered by exit timestamp',
      annualization:
        'Trade-level mean/std ratios annualized by observed trades per calendar year',
      riskFreeRatePerTrade: RISK_FREE_RATE_PER_TRADE,
      sortinoTargetPerTrade: SORTINO_TARGET_PER_TRADE,
      primaryLimitation:
        'This is supplementary trade-level risk analysis, not daily or 4H marked-to-market portfolio risk accounting.',
    },

    period: {
      firstIncludedEntryUtc: fmtDate(firstEntryMs),
      lastIncludedExitUtc: fmtDate(lastExitMs),
      durationStartUtc: fmtDate(durationStartMs),
      durationYears: round(durationYears, 6),
      tradeCount,
      tradesPerYear: round(tradesPerYear, 4),
    },

    distribution: {
      averageTradeReturnPct: round(averageReturn * 100, 4),
      sampleStdDevTradeReturnPct: round(
        standardDeviation * 100,
        4
      ),
      downsideDeviationPct: round(downsideDev * 100, 4),
      winCount: wins,
      lossCount: losses,
      winRatePct: round((wins / tradeCount) * 100, 2),
      bestTradePct: round(Math.max(...returns) * 100, 4),
      worstTradePct: round(Math.min(...returns) * 100, 4),
    },

    performance: {
      totalReturnPct: round(totalReturn * 100, 4),
      cagrPct: round(cagr * 100, 4),
    },

    riskAdjusted: {
      sharpeRatioAnnualizedTradeFrequency: round(
        annualizedSharpe,
        4
      ),
      sortinoRatioAnnualizedTradeFrequency: round(
        annualizedSortino,
        4
      ),
      maxDrawdownPct: round(maximumDrawdown * 100, 4),
      calmarRatioCagrOverAbsoluteMaxDrawdown: round(
        calmar,
        4
      ),
      ulcerIndexPct: round(ulcerIndex(equityCurve) * 100, 4),

      cvar95Pct: round(cvar95.cvar * 100, 4),
      cvar95TailTradeCount: cvar95.tailCount,
      cvar95WorstTradePct: round(
        cvar95.worstTrade * 100,
        4
      ),
      cvar95Interpretation: cvar95.note,

      cvar99Pct: round(cvar99.cvar * 100, 4),
      cvar99TailTradeCount: cvar99.tailCount,
      cvar99WorstTradePct: round(
        cvar99.worstTrade * 100,
        4
      ),
      cvar99Interpretation: cvar99.note,
    },

    equityCurve: equityCurve.map(point => ({
      sequence: point.sequence,
      equity: round(point.equity, 8),
      drawdownPct: round(point.drawdown * 100, 4),
    })),
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n')
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function writeCsv(metrics) {
  const headers = [
    'symbol',
    'variant',
    'mode',
    'status',
    'oosStartUtc',
    'firstIncludedEntryUtc',
    'lastIncludedExitUtc',
    'durationYears',
    'tradeCount',
    'tradesPerYear',
    'totalReturnPct',
    'cagrPct',
    'averageTradeReturnPct',
    'sampleStdDevTradeReturnPct',
    'downsideDeviationPct',
    'winRatePct',
    'bestTradePct',
    'worstTradePct',
    'sharpeRatioAnnualizedTradeFrequency',
    'sortinoRatioAnnualizedTradeFrequency',
    'maxDrawdownPct',
    'calmarRatioCagrOverAbsoluteMaxDrawdown',
    'ulcerIndexPct',
    'cvar95Pct',
    'cvar95TailTradeCount',
    'cvar99Pct',
    'cvar99TailTradeCount',
  ];

  const rows = [headers.join(',')];

  for (const metric of metrics) {
    const row = [
      metric.symbol,
      metric.variant,
      metric.mode,
      metric.status,
      metric.methodology?.oosStartUtc,
      metric.period?.firstIncludedEntryUtc,
      metric.period?.lastIncludedExitUtc,
      metric.period?.durationYears,
      metric.period?.tradeCount,
      metric.period?.tradesPerYear,
      metric.performance?.totalReturnPct,
      metric.performance?.cagrPct,
      metric.distribution?.averageTradeReturnPct,
      metric.distribution?.sampleStdDevTradeReturnPct,
      metric.distribution?.downsideDeviationPct,
      metric.distribution?.winRatePct,
      metric.distribution?.bestTradePct,
      metric.distribution?.worstTradePct,
      metric.riskAdjusted
        ?.sharpeRatioAnnualizedTradeFrequency,
      metric.riskAdjusted
        ?.sortinoRatioAnnualizedTradeFrequency,
      metric.riskAdjusted?.maxDrawdownPct,
      metric.riskAdjusted
        ?.calmarRatioCagrOverAbsoluteMaxDrawdown,
      metric.riskAdjusted?.ulcerIndexPct,
      metric.riskAdjusted?.cvar95Pct,
      metric.riskAdjusted?.cvar95TailTradeCount,
      metric.riskAdjusted?.cvar99Pct,
      metric.riskAdjusted?.cvar99TailTradeCount,
    ];

    rows.push(
      row.map(csvEscape).join(',')
    );
  }

  fs.writeFileSync(
    OUTPUT_CSV,
    `${rows.join('\n')}\n`,
    'utf8'
  );
}

function printMetric(metric) {
  if (metric.status !== 'OK') {
    console.log(
      `${metric.symbol} / ${metric.variant} / ${metric.mode}: ` +
      `${metric.status}`
    );
    return;
  }

  const p = metric.period;
  const r = metric.performance;
  const q = metric.riskAdjusted;

  console.log(
    `${metric.symbol.padEnd(4)} ` +
    `Variant ${metric.variant} ` +
    `${metric.mode.padEnd(18)} | ` +
    `trades=${String(p.tradeCount).padStart(3)} | ` +
    `TPY=${String(p.tradesPerYear).padStart(7)} | ` +
    `return=${String(r.totalReturnPct).padStart(9)}% | ` +
    `CAGR=${String(r.cagrPct).padStart(9)}% | ` +
    `Sharpe=${String(q.sharpeRatioAnnualizedTradeFrequency).padStart(8)} | ` +
    `Sortino=${String(q.sortinoRatioAnnualizedTradeFrequency).padStart(8)} | ` +
    `MaxDD=${String(q.maxDrawdownPct).padStart(9)}% | ` +
    `Calmar=${String(q.calmarRatioCagrOverAbsoluteMaxDrawdown).padStart(8)} | ` +
    `UI=${String(q.ulcerIndexPct).padStart(8)}% | ` +
    `CVaR95=${String(q.cvar95Pct).padStart(8)}% | ` +
    `CVaR99=${String(q.cvar99Pct).padStart(8)}%`
  );
}

function main() {
  const baselineData = loadJson(BASELINE_FILE);
  const variantBData = loadJson(VARIANT_B_FILE);

  const metrics = [];

  console.log(
    'Supplementary Risk-Adjusted Crypto Metrics'
  );

  console.log(
    `Locked OOS start: ${fmtDate(OOS_START_MS)} UTC`
  );

  console.log(
    'Risk-free rate: 0% per trade | Sortino target: 0% per trade'
  );

  console.log(
    'Equity basis: sequential closed-trade compounding, not daily/4H MTM.'
  );

  console.log('');

  for (const mode of Object.values(MODES)) {
    console.log('='.repeat(110));
    console.log(`${mode.key}: ${mode.label}`);
    console.log(`Inclusion: ${mode.inclusionRule}`);
    console.log(`Limitation: ${mode.limitation}`);
    console.log('='.repeat(110));

    for (const symbol of CRYPTO_SYMBOLS) {
      const aTrades = baselineData.crypto?.[symbol]?.trades ?? [];
      const bTrades = variantBData.crypto?.[symbol]?.trades ?? [];

      const aMetric = computeMetrics(
        symbol,
        'A',
        aTrades,
        mode
      );

      const bMetric = computeMetrics(
        symbol,
        'B',
        bTrades,
        mode
      );

      metrics.push(aMetric, bMetric);

      printMetric(aMetric);
      printMetric(bMetric);

      console.log('');
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'BTC, ETH, SOL, BNB',
    lockedOosStartUtc: fmtDate(OOS_START_MS),

    methodology: {
      description:
        'Supplementary closed-trade risk metrics reported under separate entry-attribution and exit-realization conventions.',
      riskFreeRatePerTrade: RISK_FREE_RATE_PER_TRADE,
      sortinoTargetPerTrade: SORTINO_TARGET_PER_TRADE,
      annualization:
        'Trade-level Sharpe and Sortino annualized using realized trade frequency over calendar duration.',
      cvarConvention:
        'Empirical mean of worst ceil(N × tail_probability) trade returns, minimum one trade.',
      criticalLimitation:
        'Not a daily/4H mark-to-market portfolio equity curve. Do not use alone for final production-risk approval.',
    },

    modes: MODES,
    metrics,
  };

  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  writeCsv(metrics);

  console.log('Saved outputs:');
  console.log(`- ${OUTPUT_JSON}`);
  console.log(`- ${OUTPUT_CSV}`);
}

main();
