/**
 * 4H fold-aware MTM risk engine for frozen crypto Variant A/B results.
 *
 * Scope:
 * - BTC, ETH, SOL, BNB
 * - Frozen closed-trade result JSON files
 * - Continuous 4H raw-close marks from locked OOS start
 *
 * Accounting assumptions:
 * - Independent normalized sequential sleeve per asset/variant.
 * - Starting sleeve equity before full trade history = 1.0.
 * - Actual entry/exit slippage = 0.05% adverse, matching frozen A/B runners.
 * - Fees = 0, funding = 0, leverage = 1x for this research accounting layer.
 * - Pre-OOS carry-in positions are replayed from historical sleeve state.
 * - OOS boundary is a raw-close accounting mark only:
 *   no synthetic entry, exit, fee, or slippage.
 * - OOS risk equity is rebased to 1.0 at the first OOS 4H mark.
 *
 * Strategy behavior is not modified. This script reads frozen trade outputs.
 *
 * Outputs:
 *   data/backtest-results/mtm-crypto-event-ledger.json
 *   data/backtest-results/mtm-crypto-asset-4h.json
 *   data/backtest-results/mtm-crypto-reconciliation.json
 *
 * Usage:
 *   node scripts/build-crypto-mtm-4h.js
 */

import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve('data/backtest-results');
const CANDLES_DIR = path.resolve('data/historical-4h');

const BASELINE_FILE = 'baseline-4h-results.json';
const VARIANT_B_FILE = 'variant-b-4h-ema-results.json';

const OUTPUT_LEDGER = path.join(
  RESULTS_DIR,
  'mtm-crypto-event-ledger.json'
);

const OUTPUT_ASSET = path.join(
  RESULTS_DIR,
  'mtm-crypto-asset-4h.json'
);

const OUTPUT_RECON = path.join(
  RESULTS_DIR,
  'mtm-crypto-reconciliation.json'
);

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB'];

const OOS_START_MS = Date.UTC(2025, 2, 1);
const FOLD_MONTHS = 2;
const FOLD_COUNT = 9;

const SLIPPAGE_PCT = 0.0005;
const FEE_PCT = 0;
const FUNDING_PCT_PER_BAR = 0;
const STARTING_EQUITY = 1;
const EPSILON = 1e-10;

function loadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required file: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function round(value, decimals = 12) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function addMonthsUtc(ms, months) {
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

function foldIdAt(ms) {
  if (ms < OOS_START_MS) {
    return 'PRE_OOS';
  }

  for (let index = 0; index < FOLD_COUNT; index++) {
    const start = addMonthsUtc(
      OOS_START_MS,
      index * FOLD_MONTHS
    );

    const end = addMonthsUtc(
      OOS_START_MS,
      (index + 1) * FOLD_MONTHS
    );

    if (ms >= start && ms < end) {
      return `OOS_${String(index + 1).padStart(2, '0')}`;
    }
  }

  return 'POST_DEFINED_OOS';
}

function adverseFill(rawPrice, side, phase) {
  const isLong = side === 'LONG';

  if (phase === 'ENTRY') {
    return isLong
      ? rawPrice * (1 + SLIPPAGE_PCT)
      : rawPrice * (1 - SLIPPAGE_PCT);
  }

  if (phase === 'EXIT') {
    return isLong
      ? rawPrice * (1 - SLIPPAGE_PCT)
      : rawPrice * (1 + SLIPPAGE_PCT);
  }

  throw new Error(`Unsupported fill phase: ${phase}`);
}

function validateTrade(trade, label) {
  const requiredFields = [
    'entryTime',
    'exitTime',
    'entryPrice',
    'exitPrice',
    'netPnlPct',
  ];

  for (const field of requiredFields) {
    if (!Number.isFinite(trade[field])) {
      throw new Error(`${label}: invalid ${field}`);
    }
  }

  if (!['LONG', 'SHORT'].includes(trade.direction)) {
    throw new Error(
      `${label}: unsupported direction ${trade.direction}`
    );
  }

  if (trade.exitTime < trade.entryTime) {
    throw new Error(`${label}: exit before entry`);
  }
}

function netReturn(trade) {
  return trade.side === 'LONG'
    ? trade.exitFill / trade.entryFill - 1
    : trade.entryFill / trade.exitFill - 1;
}

function buildTrades(resultData, variant, symbol) {
  const rawTrades = resultData.crypto?.[symbol]?.trades ?? [];

  return rawTrades
    .map((rawTrade, originalIndex) => {
      validateTrade(
        rawTrade,
        `${variant}/${symbol}/${originalIndex}`
      );

      const side = rawTrade.direction;

      return {
        ...rawTrade,
        originalIndex,
        variant,
        symbol,
        side,
        tradeId:
          `${variant}-${symbol}-` +
          `${String(originalIndex + 1).padStart(4, '0')}`,
        entryFill: adverseFill(
          rawTrade.entryPrice,
          side,
          'ENTRY'
        ),
        exitFill: adverseFill(
          rawTrade.exitPrice,
          side,
          'EXIT'
        ),
      };
    })
    .sort((a, b) => {
      if (a.entryTime !== b.entryTime) {
        return a.entryTime - b.entryTime;
      }

      return a.exitTime - b.exitTime;
    });
}

function buildLedger(allTrades) {
  const events = [];

  for (const trade of allTrades) {
    events.push({
      eventId: `${trade.tradeId}-ENTRY`,
      timestamp: trade.entryTime,
      timestampUtc: iso(trade.entryTime),
      variant: trade.variant,
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      eventType: 'ENTRY',
      side: trade.side,
      rawPrice: round(trade.entryPrice),
      fillPrice: round(trade.entryFill),
      fee: 0,
      funding: 0,
      slippagePct: SLIPPAGE_PCT * 100,
      exitReason: null,
      foldId: foldIdAt(trade.entryTime),
    });

    events.push({
      eventId: `${trade.tradeId}-EXIT`,
      timestamp: trade.exitTime,
      timestampUtc: iso(trade.exitTime),
      variant: trade.variant,
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      eventType: 'EXIT',
      side: trade.side,
      rawPrice: round(trade.exitPrice),
      fillPrice: round(trade.exitFill),
      fee: 0,
      funding: 0,
      slippagePct: SLIPPAGE_PCT * 100,
      exitReason: trade.exitReason ?? 'UNKNOWN',
      foldId: foldIdAt(trade.exitTime),
    });
  }

  return events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }

    return a.eventId.localeCompare(b.eventId);
  });
}

function candleMap(candles) {
  const map = new Map();

  for (const candle of candles) {
    if (
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      throw new Error(
        'Invalid 4H candle: expected finite time/open/high/low/close'
      );
    }

    map.set(candle.time, candle);
  }

  return map;
}

function replayPreOosState(allTrades) {
  let equity = STARTING_EQUITY;
  let carryIn = null;

  for (const trade of allTrades) {
    if (trade.entryTime >= OOS_START_MS) {
      break;
    }

    if (trade.exitTime < OOS_START_MS) {
      equity *= 1 + netReturn(trade);
      continue;
    }

    if (
      trade.entryTime < OOS_START_MS &&
      trade.exitTime >= OOS_START_MS
    ) {
      if (carryIn) {
        throw new Error(
          `${trade.variant}/${trade.symbol}: ` +
          'multiple carry-in positions are unsupported in v2'
        );
      }

      carryIn = {
        ...trade,
        entryEquity: equity,
        quantity: equity / trade.entryFill,
        carryIn: true,
      };

      break;
    }
  }

  return {
    preOosClosedEquity: equity,
    carryIn,
  };
}

function createPosition(trade, entryEquity, carryIn = false) {
  return {
    ...trade,
    entryEquity,
    quantity: entryEquity / trade.entryFill,
    carryIn,
  };
}

function buildAssetMtm(variant, symbol, allTrades, candles) {
  const candlesByTime = candleMap(candles);

  const oosCandles = candles
    .filter(candle => candle.time >= OOS_START_MS)
    .sort((a, b) => a.time - b.time);

  if (!oosCandles.length) {
    throw new Error(
      `${variant}/${symbol}: no 4H candles on or after OOS start`
    );
  }

  const {
    preOosClosedEquity,
    carryIn,
  } = replayPreOosState(allTrades);

  const oosTrades = allTrades.filter(
    trade => trade.exitTime >= OOS_START_MS
  );

  const entryAt = new Map();
  const exitAt = new Map();

  for (const trade of oosTrades) {
    if (!candlesByTime.has(trade.entryTime)) {
      throw new Error(
        `${trade.tradeId}: missing entry candle in 4H data`
      );
    }

    if (!candlesByTime.has(trade.exitTime)) {
      throw new Error(
        `${trade.tradeId}: missing exit candle in 4H data`
      );
    }

    if (trade.entryTime >= OOS_START_MS) {
      if (entryAt.has(trade.entryTime)) {
        throw new Error(
          `${variant}/${symbol}: multiple same-bar entries unsupported`
        );
      }

      entryAt.set(trade.entryTime, trade);
    }

    if (exitAt.has(trade.exitTime)) {
      throw new Error(
        `${variant}/${symbol}: multiple same-bar exits unsupported`
      );
    }

    exitAt.set(trade.exitTime, trade);
  }

  let current = carryIn;
  let economicEquity = carryIn
    ? carryIn.entryEquity
    : STARTING_EQUITY;

  let cash = current ? 0 : economicEquity;
  let oosBaselineEconomicEquity = null;
  let peakOosEquity = null;
  let realizedPnlCumulative = 0;
  let feesCumulative = 0;
  let fundingCumulative = 0;

  const marks = [];
  const tradeReconciliations = [];
  const boundaryChecks = [];

  for (const candle of oosCandles) {
    const timestamp = candle.time;
    const markPrice = candle.close;

    let eventType = 'MARK';
    let boundaryStatus = null;
    let terminalStatus = null;

    if (timestamp === OOS_START_MS && current?.carryIn) {
      eventType = 'BOUNDARY_MARK';
      boundaryStatus = 'CARRY_IN';
    }

    if (current && exitAt.has(timestamp)) {
      const exitTrade = exitAt.get(timestamp);

      if (exitTrade.tradeId !== current.tradeId) {
        throw new Error(
          `${variant}/${symbol}: exit identity mismatch at ${iso(timestamp)}`
        );
      }

      const reconstructedNetPnlPct = netReturn(exitTrade);
      const reconciliationDelta =
        reconstructedNetPnlPct - exitTrade.netPnlPct;

      const entryEquity = current.entryEquity;
      const realizedPnl =
        entryEquity * reconstructedNetPnlPct;

      economicEquity =
        entryEquity * (1 + reconstructedNetPnlPct);

      cash = economicEquity;
      realizedPnlCumulative += realizedPnl;

      tradeReconciliations.push({
        checkType: 'CLOSED_TRADE_PNL_RECONCILIATION',
        variant,
        symbol,
        tradeId: exitTrade.tradeId,
        status:
          Math.abs(reconciliationDelta) <= EPSILON
            ? 'PASS'
            : 'FAIL',
        expectedNetPnlPct: round(exitTrade.netPnlPct),
        reconstructedNetPnlPct: round(reconstructedNetPnlPct),
        delta: round(reconciliationDelta, 14),
        entryTimeUtc: iso(exitTrade.entryTime),
        exitTimeUtc: iso(exitTrade.exitTime),
        entryEquity: round(entryEquity),
        realizedPnl: round(realizedPnl),
        economicEquityAfterExit: round(economicEquity),
      });

      eventType = eventType === 'BOUNDARY_MARK'
        ? 'BOUNDARY_MARK_AND_EXIT'
        : 'EXIT';

      current = null;
    }

    if (!current && entryAt.has(timestamp)) {
      const entryTrade = entryAt.get(timestamp);

      current = createPosition(
        entryTrade,
        economicEquity,
        false
      );

      cash = 0;

      eventType = eventType === 'EXIT'
        ? 'EXIT_AND_ENTRY'
        : 'ENTRY';
    }

    let unrealizedPnl = 0;
    let positionNotionalAtMark = 0;
    let grossExposure = 0;
    let netExposure = 0;
    let openPositionCount = 0;
    let tradeId = null;
    let side = null;
    let positionStatus = 'FLAT';

    if (current) {
      unrealizedPnl = current.side === 'LONG'
        ? current.quantity * (
          markPrice - current.entryFill
        )
        : current.quantity * (
          current.entryFill - markPrice
        );

      positionNotionalAtMark =
        current.quantity * markPrice;

      grossExposure = Math.abs(positionNotionalAtMark);

      netExposure = current.side === 'LONG'
        ? positionNotionalAtMark
        : -positionNotionalAtMark;

      openPositionCount = 1;
      tradeId = current.tradeId;
      side = current.side;

      positionStatus =
        current.carryIn && timestamp === OOS_START_MS
          ? 'CARRY_IN_OPEN'
          : timestamp === current.entryTime
            ? 'OPENED'
            : 'OPEN';

      economicEquity =
        current.entryEquity +
        unrealizedPnl -
        feesCumulative -
        fundingCumulative;

      cash = 0;
    }

    if (oosBaselineEconomicEquity === null) {
      oosBaselineEconomicEquity = economicEquity;

      if (
        !Number.isFinite(oosBaselineEconomicEquity) ||
        oosBaselineEconomicEquity <= 0
      ) {
        throw new Error(
          `${variant}/${symbol}: invalid OOS baseline equity ` +
          `${oosBaselineEconomicEquity}`
        );
      }
    }

    const oosRebasedEquity =
      economicEquity / oosBaselineEconomicEquity;

    peakOosEquity = peakOosEquity === null
      ? oosRebasedEquity
      : Math.max(peakOosEquity, oosRebasedEquity);

    const drawdownPct = peakOosEquity > 0
      ? (
        (oosRebasedEquity - peakOosEquity) /
        peakOosEquity
      ) * 100
      : 0;

    const mark = {
      timestamp,
      timestampUtc: iso(timestamp),
      variant,
      scope: 'ASSET_NORMALIZED_NOTIONAL_OOS_REBASED',
      symbol,
      foldId: foldIdAt(timestamp),
      eventType,

      accounting: {
        startingEquity: STARTING_EQUITY,
        preOosClosedEquity: round(preOosClosedEquity),
        oosBaselineEconomicEquity: round(
          oosBaselineEconomicEquity
        ),
        economicEquity: round(economicEquity),
        oosRebasedEquity: round(oosRebasedEquity),
      },

      cash: round(cash),
      realizedPnlCumulative: round(realizedPnlCumulative),
      unrealizedPnl: round(unrealizedPnl),
      feesCumulative: round(feesCumulative),
      fundingCumulative: round(fundingCumulative),

      equity: round(oosRebasedEquity),
      peakEquity: round(peakOosEquity),
      drawdownPct: round(drawdownPct, 10),

      grossExposure: round(grossExposure),
      netExposure: round(netExposure),
      positionNotionalAtMark: round(positionNotionalAtMark),
      openPositionCount,

      largestPositionWeightPct: openPositionCount
        ? round(
          (grossExposure / economicEquity) * 100,
          10
        )
        : 0,

      tradeId,
      side,
      rawMarkPrice: round(markPrice),
      positionStatus,
      boundaryStatus,
      terminalStatus,
    };

    marks.push(mark);

    if (boundaryStatus === 'CARRY_IN') {
      const boundaryPass =
        current?.tradeId === carryIn.tradeId &&
        current?.side === carryIn.side &&
        Math.abs(current?.quantity - carryIn.quantity) <=
          EPSILON &&
        mark.eventType === 'BOUNDARY_MARK' &&
        mark.feesCumulative === 0 &&
        mark.fundingCumulative === 0 &&
        mark.boundaryStatus === 'CARRY_IN';

      boundaryChecks.push({
        checkType: 'CARRY_IN_BOUNDARY_CONTINUITY',
        variant,
        symbol,
        tradeId: carryIn.tradeId,
        status: boundaryPass ? 'PASS' : 'FAIL',
        oosStartUtc: iso(OOS_START_MS),
        originalEntryUtc: iso(carryIn.entryTime),
        originalExitUtc: iso(carryIn.exitTime),
        side: carryIn.side,
        entryFillPrice: round(carryIn.entryFill),
        quantity: round(carryIn.quantity),
        rawBoundaryMarkPrice: round(markPrice),
        boundaryFee: 0,
        boundarySlippage: 0,
        syntheticExecutionCreated: false,
      });
    }
  }

  if (current) {
    const lastMark = marks.at(-1);

    lastMark.positionStatus = 'CARRY_OUT_MARKED';
    lastMark.terminalStatus = 'CARRY_OUT_MARKED';
  }

  return {
    marks,
    tradeReconciliations,
    boundaryChecks,

    carryInSummary: carryIn
      ? {
          tradeId: carryIn.tradeId,
          side: carryIn.side,
          originalEntryUtc: iso(carryIn.entryTime),
          originalExitUtc: iso(carryIn.exitTime),
          entryEquity: round(carryIn.entryEquity),
          entryFillPrice: round(carryIn.entryFill),
          quantity: round(carryIn.quantity),
          preOosClosedEquity: round(preOosClosedEquity),
        }
      : null,
  };
}

function verifySeries(marks, variant, symbol) {
  const failures = [];

  for (const mark of marks) {
    const grossExposure = mark.grossExposure ?? 0;
    const netExposure = mark.netExposure ?? 0;
    const equity = mark.equity;

    if (
      grossExposure + EPSILON <
      Math.abs(netExposure)
    ) {
      failures.push({
        timestampUtc: mark.timestampUtc,
        invariant: 'GROSS_EXPOSURE_GE_ABS_NET_EXPOSURE',
        grossExposure,
        netExposure,
      });
    }

    if (!Number.isFinite(equity) || equity <= 0) {
      failures.push({
        timestampUtc: mark.timestampUtc,
        invariant: 'FINITE_POSITIVE_OOS_REBASED_EQUITY',
        equity,
      });
    }
  }

  return {
    checkType: 'SERIES_INVARIANTS',
    variant,
    symbol,
    status: failures.length ? 'FAIL' : 'PASS',
    failureCount: failures.length,
    failures,
  };
}

function main() {
  const baseline = loadJson(
    path.join(RESULTS_DIR, BASELINE_FILE)
  );

  const variantB = loadJson(
    path.join(RESULTS_DIR, VARIANT_B_FILE)
  );

  const allLedger = [];
  const assetSeries = [];
  const tradeReconciliations = [];
  const allBoundaryChecks = [];
  const invariantChecks = [];

  for (const [variant, resultData] of [
    ['A', baseline],
    ['B', variantB],
  ]) {
    for (const symbol of SYMBOLS) {
      const allTrades = buildTrades(
        resultData,
        variant,
        symbol
      );

      const candles = loadJson(
        path.join(CANDLES_DIR, `${symbol}_4h.json`)
      );

      const ledger = buildLedger(allTrades);

      const mtm = buildAssetMtm(
        variant,
        symbol,
        allTrades,
        candles
      );

      allLedger.push(...ledger);

      assetSeries.push({
        variant,
        symbol,

        methodology: {
          accountingModel:
            'normalized sequential per-asset sleeve',
          markFrequency: '4H raw close',
          oosRiskSeries:
            'rebased to 1.0 at first OOS mark',
          carryInPolicy:
            'Pre-OOS open trade preserves original entry fill, ' +
            'entry equity, quantity, side, and trade ID. ' +
            'OOS boundary is a raw mark only.',
        },

        carryIn: mtm.carryInSummary,
        marks: mtm.marks,
      });

      tradeReconciliations.push(
        ...mtm.tradeReconciliations
      );

      allBoundaryChecks.push(...mtm.boundaryChecks);

      invariantChecks.push(
        verifySeries(mtm.marks, variant, symbol)
      );
    }
  }

  const failedTradeReconciliations =
    tradeReconciliations.filter(
      row => row.status !== 'PASS'
    );

  const failedBoundaryChecks =
    allBoundaryChecks.filter(
      row => row.status !== 'PASS'
    );

  const failedInvariantChecks =
    invariantChecks.filter(
      row => row.status !== 'PASS'
    );

  const report = {
    generatedAt: new Date().toISOString(),
    scope: SYMBOLS,
    oosStartUtc: iso(OOS_START_MS),

    methodology: {
      accountingModel:
        'Normalized sequential per-asset sleeve with OOS rebasing',
      startingEquityPerAsset: STARTING_EQUITY,
      markFrequency: '4H raw close',
      slippagePctPerActualFill: SLIPPAGE_PCT * 100,
      feePct: FEE_PCT * 100,
      fundingPctPerBar: FUNDING_PCT_PER_BAR * 100,
      leverage: 1,

      carryInPolicy:
        'Carry-in positions are initialized through pre-OOS ' +
        'sleeve replay. Original entry fill, entry equity, ' +
        'quantity, side, and trade ID are preserved. ' +
        'OOS boundary mark uses raw close, zero fee, and zero slippage.',

      criticalLimitation:
        'Research accounting only. Not broker-faithful shared-capital, ' +
        'fee, funding, leverage, or margin accounting.',

      strategyBehavior:
        'Frozen Variant A/B closed trade decisions are inputs ' +
        'and are not modified.',
    },

    summary: {
      assetSeriesCount: assetSeries.length,
      eventCount: allLedger.length,
      closedTradeReconciliations:
        tradeReconciliations.length,
      closedTradeReconciliationFailures:
        failedTradeReconciliations.length,
      carryInBoundaryChecks:
        allBoundaryChecks.length,
      carryInBoundaryFailures:
        failedBoundaryChecks.length,
      invariantCheckFailures:
        failedInvariantChecks.length,

      overallStatus:
        failedTradeReconciliations.length === 0 &&
        failedBoundaryChecks.length === 0 &&
        failedInvariantChecks.length === 0
          ? 'PASS'
          : 'FAIL',
    },

    tradeReconciliations,
    carryInBoundaryChecks: allBoundaryChecks,
    invariantChecks,
  };

  writeJson(OUTPUT_LEDGER, {
    generatedAt: report.generatedAt,
    methodology: report.methodology,
    events: allLedger,
  });

  writeJson(OUTPUT_ASSET, {
    generatedAt: report.generatedAt,
    methodology: report.methodology,
    assets: assetSeries,
  });

  writeJson(OUTPUT_RECON, report);

  console.log('Fold-aware 4H crypto MTM build complete');
  console.log(`Event ledger: ${OUTPUT_LEDGER}`);
  console.log(`Asset MTM marks: ${OUTPUT_ASSET}`);
  console.log(`Reconciliation: ${OUTPUT_RECON}`);

  console.log(
    `Status: ${report.summary.overallStatus} | ` +
    `trade failures=${failedTradeReconciliations.length} | ` +
    `carry-in boundary failures=${failedBoundaryChecks.length} | ` +
    `invariant failures=${failedInvariantChecks.length}`
  );

  if (report.summary.overallStatus !== 'PASS') {
    process.exitCode = 1;
  }
}

main();
