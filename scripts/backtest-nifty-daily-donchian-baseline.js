#!/usr/bin/env node
/**
 * Distinct from scripts/run-nifty-daily-research.js:
 * this script runs only the frozen, long-only NIFTY daily Donchian 20/20 baseline.
 *
 * Research-only local backtest. No network, broker, WebSocket, order, or execution calls.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = process.argv[2] || path.join(ROOT, 'data/india-input/nifty50-nse-daily-normalized.csv');
const REPORT = process.argv[3] || path.join(ROOT, 'reports/nifty-daily-donchian-baseline.json');
const TRADES = process.argv[4] || path.join(ROOT, 'reports/nifty-daily-donchian-baseline-trades.csv');

const ENTRY_LOOKBACK = 20;
const EXIT_LOOKBACK = 20;
const WARMUP_SESSIONS = 20;
const MIN_COMPLETED_TRADES = 10;
const COST_SCENARIOS = [
  { id: 'ZERO_BPS', entryCostRate: 0, exitCostRate: 0, roundTripBps: 0 },
  { id: 'TWENTY_BPS_ROUND_TRIP', entryCostRate: 0.001, exitCostRate: 0.001, roundTripBps: 20 }
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail(`Non-finite ${label}.`);
  return value;
}

function round(value, digits = 10) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function dateOnly(timestamp) {
  return timestamp.slice(0, 10);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function maximumDrawdown(equityValues) {
  let peak = 1;
  let maxDrawdown = 0;
  for (const equity of equityValues) {
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  return maxDrawdown;
}

function parseRows(inputPath) {
  if (!fs.existsSync(inputPath)) fail(`Missing CSV: ${inputPath}`);

  const lines = fs.readFileSync(inputPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  if (lines.length < WARMUP_SESSIONS + 2) {
    fail(`Need at least ${WARMUP_SESSIONS + 2} non-empty CSV lines including header.`);
  }

  const expected = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
  const header = lines[0].split(',').map((cell) => cell.trim());
  if (JSON.stringify(header) !== JSON.stringify(expected)) {
    fail(`Unexpected header: ${JSON.stringify(header)}`);
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length !== 6) fail(`CSV row ${index + 2} has ${cells.length} columns; expected 6.`);

    const [timestamp, openText, highText, lowText, closeText, volumeText] = cells;
    if (!/^\d{4}-\d{2}-\d{2}T15:30:00\+05:30$/.test(timestamp)) {
      fail(`Unexpected timestamp at row ${index + 2}: ${timestamp}`);
    }

    const open = finite(Number(openText), `open at row ${index + 2}`);
    const high = finite(Number(highText), `high at row ${index + 2}`);
    const low = finite(Number(lowText), `low at row ${index + 2}`);
    const close = finite(Number(closeText), `close at row ${index + 2}`);
    const volume = finite(Number(volumeText), `volume at row ${index + 2}`);

    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) {
      fail(`Invalid non-positive OHLC or negative volume at row ${index + 2}.`);
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      fail(`Invalid OHLC relationship at row ${index + 2}.`);
    }

    return { timestamp, open, high, low, close, volume };
  });

  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].timestamp <= rows[i - 1].timestamp) {
      fail(`Rows must be strictly chronological: ${rows[i - 1].timestamp} then ${rows[i].timestamp}.`);
    }
  }

  return rows;
}

function priorWindow(rows, signalIndex, lookback, field) {
  const start = signalIndex - lookback;
  const endExclusive = signalIndex;
  if (start < 0) fail(`Insufficient warm-up at signal index ${signalIndex}.`);
  return rows.slice(start, endExclusive).map((row) => row[field]);
}

function buildSignalLedger(rows) {
  const ledger = [];

  for (let signalIndex = WARMUP_SESSIONS; signalIndex < rows.length - 1; signalIndex += 1) {
    const signalRow = rows[signalIndex];
    const executionRow = rows[signalIndex + 1];
    const priorHighs = priorWindow(rows, signalIndex, ENTRY_LOOKBACK, 'high');
    const priorLows = priorWindow(rows, signalIndex, EXIT_LOOKBACK, 'low');
    const priorUpperBand = Math.max(...priorHighs);
    const priorLowerBand = Math.min(...priorLows);

    ledger.push({
      signalIndex,
      signalTimestamp: signalRow.timestamp,
      signalDate: dateOnly(signalRow.timestamp),
      signalClose: signalRow.close,
      executionIndex: signalIndex + 1,
      executionTimestamp: executionRow.timestamp,
      executionDate: dateOnly(executionRow.timestamp),
      executionOpen: executionRow.open,
      priorUpperBand,
      priorLowerBand,
      entryCondition: signalRow.close > priorUpperBand,
      exitCondition: signalRow.close < priorLowerBand
    });
  }

  return ledger;
}

function runScenario(rows, signalLedger, scenario) {
  const completedTrades = [];
  const ignoredEntrySignals = [];
  const ignoredExitSignals = [];
  let openPosition = null;

  for (const event of signalLedger) {
    if (openPosition === null && event.entryCondition) {
      const entryRawFill = event.executionOpen;
      const entryEffectiveFill = entryRawFill * (1 + scenario.entryCostRate);

      openPosition = {
        entrySignalDate: event.signalDate,
        entrySignalTimestamp: event.signalTimestamp,
        entrySignalClose: event.signalClose,
        entryPriorUpperBand: event.priorUpperBand,
        entryDate: event.executionDate,
        entryTimestamp: event.executionTimestamp,
        entryRawFill,
        entryEffectiveFill,
        entryExecutionIndex: event.executionIndex
      };
      continue;
    }

    if (openPosition !== null && event.entryCondition) {
      ignoredEntrySignals.push({
        signalDate: event.signalDate,
        executionDate: event.executionDate,
        reason: 'ALREADY_LONG'
      });
    }

    if (openPosition !== null && event.exitCondition) {
      const exitRawFill = event.executionOpen;
      const exitEffectiveFill = exitRawFill * (1 - scenario.exitCostRate);
      const grossReturn = (exitRawFill - openPosition.entryRawFill) / openPosition.entryRawFill;
      const netReturn = (exitEffectiveFill - openPosition.entryEffectiveFill) / openPosition.entryEffectiveFill;
      const calendarDaysHeld = Math.round(
        (Date.parse(event.executionTimestamp) - Date.parse(openPosition.entryTimestamp)) / 86_400_000
      );
      const tradingSessionsHeld = event.executionIndex - openPosition.entryExecutionIndex;

      completedTrades.push({
        tradeId: completedTrades.length + 1,
        state: 'COMPLETED',
        scenarioId: scenario.id,
        entrySignalDate: openPosition.entrySignalDate,
        entrySignalTimestamp: openPosition.entrySignalTimestamp,
        entrySignalClose: round(openPosition.entrySignalClose),
        entryPriorUpperBand: round(openPosition.entryPriorUpperBand),
        entryDate: openPosition.entryDate,
        entryTimestamp: openPosition.entryTimestamp,
        entryRawFill: round(openPosition.entryRawFill),
        entryEffectiveFill: round(openPosition.entryEffectiveFill),
        exitSignalDate: event.signalDate,
        exitSignalTimestamp: event.signalTimestamp,
        exitSignalClose: round(event.signalClose),
        exitPriorLowerBand: round(event.priorLowerBand),
        exitDate: event.executionDate,
        exitTimestamp: event.executionTimestamp,
        exitRawFill: round(exitRawFill),
        exitEffectiveFill: round(exitEffectiveFill),
        calendarDaysHeld,
        tradingSessionsHeld,
        grossReturn: round(grossReturn),
        netReturn: round(netReturn)
      });

      openPosition = null;
      continue;
    }

    if (openPosition === null && event.exitCondition) {
      ignoredExitSignals.push({
        signalDate: event.signalDate,
        executionDate: event.executionDate,
        reason: 'ALREADY_FLAT'
      });
    }
  }

  let openAtDatasetEnd = null;
  if (openPosition !== null) {
    const last = rows.at(-1);
    const unrealizedGrossReturn = (last.close - openPosition.entryRawFill) / openPosition.entryRawFill;
    const unrealizedNetReturn = ((last.close * (1 - scenario.exitCostRate)) - openPosition.entryEffectiveFill)
      / openPosition.entryEffectiveFill;
    const calendarDaysHeld = Math.round(
      (Date.parse(last.timestamp) - Date.parse(openPosition.entryTimestamp)) / 86_400_000
    );
    const tradingSessionsHeld = (rows.length - 1) - openPosition.entryExecutionIndex;

    openAtDatasetEnd = {
      state: 'OPEN_AT_DATASET_END',
      scenarioId: scenario.id,
      entrySignalDate: openPosition.entrySignalDate,
      entrySignalTimestamp: openPosition.entrySignalTimestamp,
      entrySignalClose: round(openPosition.entrySignalClose),
      entryPriorUpperBand: round(openPosition.entryPriorUpperBand),
      entryDate: openPosition.entryDate,
      entryTimestamp: openPosition.entryTimestamp,
      entryRawFill: round(openPosition.entryRawFill),
      entryEffectiveFill: round(openPosition.entryEffectiveFill),
      markDate: dateOnly(last.timestamp),
      markTimestamp: last.timestamp,
      markLastAvailableClose: round(last.close),
      calendarDaysHeld,
      tradingSessionsHeld,
      unrealizedGrossReturn: round(unrealizedGrossReturn),
      unrealizedNetReturn: round(unrealizedNetReturn),
      excludedFromCompletedTradeMetrics: true,
      excludedFromEquityCurve: true,
      notForceClosed: true
    };
  }

  const returns = completedTrades.map((trade) => trade.netReturn);
  const equityCurve = [];
  let equity = 1;

  for (const trade of completedTrades) {
    equity *= 1 + trade.netReturn;
    equityCurve.push({
      tradeId: trade.tradeId,
      exitDate: trade.exitDate,
      netReturn: round(trade.netReturn),
      equity: round(equity)
    });
  }

  const completedTradeCount = completedTrades.length;
  const status = completedTradeCount < MIN_COMPLETED_TRADES
    ? 'INSUFFICIENT_EVIDENCE'
    : 'SUFFICIENT_EVIDENCE';

  return {
    scenario: {
      id: scenario.id,
      entryCostBps: scenario.entryCostRate * 10_000,
      exitCostBps: scenario.exitCostRate * 10_000,
      roundTripBps: scenario.roundTripBps
    },
    status,
    statusMeaning: status === 'INSUFFICIENT_EVIDENCE'
      ? 'Completed trade count is below the predeclared threshold. Metrics are descriptive only and cannot support an edge or readiness claim.'
      : 'Trade-count reporting threshold met. This is not an edge, robustness, deployment, or out-of-sample validation verdict.',
    completedTrades,
    openAtDatasetEnd,
    ignoredEntrySignals,
    ignoredExitSignals,
    equityCurve,
    metrics: {
      completedTradeCount,
      openPositionAtDatasetEndCount: openAtDatasetEnd ? 1 : 0,
      winRate: returns.length ? returns.filter((value) => value > 0).length / returns.length : null,
      averageNetTradeReturn: round(average(returns)),
      medianNetTradeReturn: round(median(returns)),
      terminalReturnCompletedTradesOnly: round(equity - 1),
      maximumDrawdownCompletedTradesOnly: round(maximumDrawdown(equityCurve.map((point) => point.equity))),
      bestSingleTradeNetReturn: returns.length ? round(Math.max(...returns)) : null,
      worstSingleTradeNetReturn: returns.length ? round(Math.min(...returns)) : null
    }
  };
}

function buildCsv(scenarioResults) {
  const headers = [
    'scenario_id',
    'trade_id',
    'state',
    'entry_signal_date',
    'entry_date',
    'entry_raw_fill',
    'entry_effective_fill',
    'exit_signal_date',
    'exit_date',
    'exit_raw_fill',
    'exit_effective_fill',
    'calendar_days_held',
    'trading_sessions_held',
    'gross_return',
    'net_return',
    'mark_date',
    'mark_last_available_close',
    'unrealized_gross_return',
    'unrealized_net_return',
    'excluded_from_completed_trade_metrics',
    'excluded_from_equity_curve'
  ];

  const output = [headers.join(',')];

  for (const result of scenarioResults) {
    for (const trade of result.completedTrades) {
      output.push([
        trade.scenarioId,
        trade.tradeId,
        trade.state,
        trade.entrySignalDate,
        trade.entryDate,
        trade.entryRawFill,
        trade.entryEffectiveFill,
        trade.exitSignalDate,
        trade.exitDate,
        trade.exitRawFill,
        trade.exitEffectiveFill,
        trade.calendarDaysHeld,
        trade.tradingSessionsHeld,
        trade.grossReturn,
        trade.netReturn,
        '',
        '',
        '',
        '',
        false,
        false
      ].map(csvEscape).join(','));
    }

    if (result.openAtDatasetEnd) {
      const open = result.openAtDatasetEnd;
      output.push([
        open.scenarioId,
        '',
        open.state,
        open.entrySignalDate,
        open.entryDate,
        open.entryRawFill,
        open.entryEffectiveFill,
        '',
        '',
        '',
        '',
        open.calendarDaysHeld,
        open.tradingSessionsHeld,
        '',
        '',
        open.markDate,
        open.markLastAvailableClose,
        open.unrealizedGrossReturn,
        open.unrealizedNetReturn,
        open.excludedFromCompletedTradeMetrics,
        open.excludedFromEquityCurve
      ].map(csvEscape).join(','));
    }
  }

  return `${output.join('\n')}\n`;
}

const rows = parseRows(INPUT);
const signalLedger = buildSignalLedger(rows);
const scenarios = COST_SCENARIOS.map((scenario) => runScenario(rows, signalLedger, scenario));

const report = {
  generatedAtUtc: new Date().toISOString(),
  mode: 'RESEARCH_ONLY_LOCAL_BACKTEST',
  safety: {
    networkCalls: false,
    brokerCalls: false,
    websocketCalls: false,
    orderPlacement: false,
    liveExecution: false
  },
  input: {
    path: INPUT,
    rowCount: rows.length,
    firstTimestamp: rows[0].timestamp,
    lastTimestamp: rows.at(-1).timestamp,
    sourceType: 'NIFTY_50_PRICE_INDEX_DAILY_OHLC_AS_IS'
  },
  frozenSpecification: {
    positionPolicy: 'LONG_ONLY_FLAT_TO_LONG_TO_FLAT_NO_SHORTS_NO_REVERSALS_NO_SAME_DAY_FILLS',
    entry: 'completed close strictly above maximum high of prior 20 trading-session rows',
    exit: 'completed close strictly below minimum low of prior 20 trading-session rows',
    signalTiming: 'signal at completed day t close using data through day t only',
    executionTiming: 'fill at next trading-session open, day t+1',
    entryLookbackSessions: ENTRY_LOOKBACK,
    exitLookbackSessions: EXIT_LOOKBACK,
    warmupCompletedSessions: WARMUP_SESSIONS,
    trendFilter: 'NONE',
    atrStop: 'NONE',
    openTradePolicy: 'OPEN_AT_DATASET_END_NOT_FORCE_CLOSED_EXCLUDED_FROM_COMPLETED_METRICS_AND_EQUITY_CURVE',
    evidenceGate: {
      minimumCompletedTrades: MIN_COMPLETED_TRADES,
      belowThresholdStatus: 'INSUFFICIENT_EVIDENCE',
      atOrAboveThresholdStatus: 'SUFFICIENT_EVIDENCE'
    }
  },
  signalLedgerSummary: {
    evaluableSignalDays: signalLedger.length,
    rawEntryConditions: signalLedger.filter((event) => event.entryCondition).length,
    rawExitConditions: signalLedger.filter((event) => event.exitCondition).length,
    lastSignalDayWithNextOpenAvailable: signalLedger.at(-1)?.signalDate ?? null
  },
  scenarios
};

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.mkdirSync(path.dirname(TRADES), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(TRADES, buildCsv(scenarios), 'utf8');

for (const result of scenarios) {
  const metrics = result.metrics;
  console.log([
    `SCENARIO=${result.scenario.id}`,
    `STATUS=${result.status}`,
    `COMPLETED_TRADES=${metrics.completedTradeCount}`,
    `OPEN_AT_DATASET_END=${metrics.openPositionAtDatasetEndCount}`,
    `WIN_RATE=${metrics.winRate ?? 'NA'}`,
    `AVG_NET_RETURN=${metrics.averageNetTradeReturn ?? 'NA'}`,
    `MEDIAN_NET_RETURN=${metrics.medianNetTradeReturn ?? 'NA'}`,
    `TERMINAL_RETURN=${metrics.terminalReturnCompletedTradesOnly ?? 'NA'}`,
    `MAX_DRAWDOWN=${metrics.maximumDrawdownCompletedTradesOnly ?? 'NA'}`
  ].join(' '));
}

console.log(`REPORT=${REPORT}`);
console.log(`TRADES=${TRADES}`);
console.log('Safety: local-file research only; no network, broker, WebSocket, order, or live-execution function was called.');
