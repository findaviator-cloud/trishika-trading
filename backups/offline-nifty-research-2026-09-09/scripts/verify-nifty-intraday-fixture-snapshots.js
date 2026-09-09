#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateIntradayBias,
  analyseIntradayTimeframe,
  delayedEligibleCandles,
  inspectMinuteCandles,
  loadRawMinuteCandles,
  resampleStrictIntraday,
  strictFullSessionCandles
} from '../src/india/nifty_intraday_core.js';

const ROOT = process.cwd();
const RAW_FILE = path.join(ROOT, 'data/india-input/NIFTY 50_minute_data.csv');
const SNAPSHOT_FILE = path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-snapshots.json');
const GOVERNANCE_FILE = path.join(ROOT, 'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json');
const OUTPUT_FILE = path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-regression-audit.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label}: ${error.message}`);
  }
}

function sha256(filePath) {
  assert(fs.existsSync(filePath), `Missing raw fixture: ${filePath}`);

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function numberDifference(expected, actual) {
  if (typeof expected !== 'number' || typeof actual !== 'number') return null;
  return Number((actual - expected).toFixed(8));
}

function samePrimitive(expected, actual) {
  return expected === actual;
}

function compare(pathLabel, expected, actual, context, diffs) {
  const equal = typeof expected === 'number' && typeof actual === 'number'
    ? Math.abs(expected - actual) <= 1e-10
    : samePrimitive(expected, actual);

  if (!equal) {
    diffs.push({
      ...context,
      component: pathLabel,
      expected,
      actual,
      difference: numberDifference(expected, actual)
    });
  }
}

function recompute(rawCandles, inspection, scenario) {
  const asOf = new Date(scenario.asOf);
  assert(!Number.isNaN(asOf.getTime()), `Invalid snapshot scenario asOf: ${scenario.asOf}`);

  const strictCandles = strictFullSessionCandles(rawCandles, inspection);
  const eligible = delayedEligibleCandles(strictCandles, asOf, scenario.delayMinutes);
  const timeframes = {};

  for (const timeframe of ['1H', '2H', '4H']) {
    const bars = resampleStrictIntraday(eligible.candles, timeframe);
    timeframes[timeframe] = analyseIntradayTimeframe(bars, timeframe);
  }

  return {
    id: scenario.id,
    asOf: scenario.asOf,
    delayMinutes: scenario.delayMinutes,
    cutoffUtc: eligible.cutoff.toISOString(),
    eligibleMinuteCandles: eligible.candles.length,
    aggregate: aggregateIntradayBias(timeframes),
    timeframes
  };
}

function compareScenario(expected, actual) {
  const diffs = [];
  const base = { asOf: expected.asOf, scenario: expected.id };

  compare('cutoffUtc', expected.cutoffUtc, actual.cutoffUtc, base, diffs);
  compare('eligibleMinuteCandles', expected.eligibleMinuteCandles, actual.eligibleMinuteCandles, base, diffs);
  compare('aggregate.bias', expected.aggregate.bias, actual.aggregate.bias, base, diffs);
  compare('aggregate.reason', expected.aggregate.reason, actual.aggregate.reason, base, diffs);

  for (const timeframe of ['1H', '2H', '4H']) {
    const expectedTf = expected.timeframes[timeframe];
    const actualTf = actual.timeframes[timeframe];
    const context = { ...base, timeframe };

    compare('bias', expectedTf.bias, actualTf.bias, context, diffs);
    compare('reason', expectedTf.reason, actualTf.reason, context, diffs);
    compare('candleCount', expectedTf.candleCount, actualTf.candleCount, context, diffs);

    const fields = [
      'lastCandle.timestampUtc',
      'lastCandle.timestampIndiaOpen',
      'lastCandle.open',
      'lastCandle.high',
      'lastCandle.low',
      'lastCandle.close',
      'lastCandle.sourceCandleCount',
      'indicators.sma200',
      'indicators.atr14',
      'indicators.donchian20.upper',
      'indicators.donchian20.lower'
    ];

    for (const field of fields) {
      const read = (object, keyPath) =>
        keyPath.split('.').reduce((value, key) => value === null || value === undefined ? undefined : value[key], object);

      compare(field, read(expectedTf, field), read(actualTf, field), context, diffs);
    }
  }

  return diffs;
}

try {
  const baseline = readJson(SNAPSHOT_FILE, 'canonical fixture snapshot');
  const governance = readJson(GOVERNANCE_FILE, 'eligibility policy audit');
  const actualSha = sha256(RAW_FILE);

  assert(
    baseline?.fixture?.sha256 === actualSha,
    [
      'REGRESSION: FAIL',
      'component: FIXTURE_SHA256',
      `expected: ${baseline?.fixture?.sha256}`,
      `actual:   ${actualSha}`,
      'difference: raw fixture changed; baseline comparison refused; deliberate re-audit required.'
    ].join('\n')
  );

  assert(
    governance?.provenance?.rawMinuteSourceSha256 === actualSha,
    [
      'REGRESSION: FAIL',
      'component: GOVERNANCE_PROVENANCE_SHA256',
      `expected: ${governance?.provenance?.rawMinuteSourceSha256}`,
      `actual:   ${actualSha}`,
      'difference: raw fixture does not match governance provenance; re-audit required.'
    ].join('\n')
  );

  assert(
    governance?.eligibleCurrentIntradayContext === false &&
      governance?.decision === 'BLOCKED',
    'REGRESSION: FAIL\ncomponent: GOVERNANCE_BLOCK_STATE\nexpected: eligible=false / decision=BLOCKED\nactual: governance policy state changed.'
  );

  const rawCandles = loadRawMinuteCandles(RAW_FILE);
  const inspection = inspectMinuteCandles(rawCandles);

  assert(inspection.duplicates.length === 0, 'REGRESSION: FAIL\ncomponent: DUPLICATE_TIMESTAMPS\nexpected: 0\nactual: fixture contains duplicate timestamps.');
  assert(inspection.outOfOrder.length === 0, 'REGRESSION: FAIL\ncomponent: OUT_OF_ORDER_TIMESTAMPS\nexpected: 0\nactual: fixture contains out-of-order timestamps.');

  const allDiffs = [];
  const scenarioResults = [];

  for (const expected of baseline.scenarios) {
    const actual = recompute(rawCandles, inspection, expected);
    const diffs = compareScenario(expected, actual);

    scenarioResults.push({
      id: expected.id,
      asOf: expected.asOf,
      status: diffs.length === 0 ? 'PASS' : 'FAIL',
      differenceCount: diffs.length
    });

    allDiffs.push(...diffs);
  }

  const output = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    purpose: 'Deterministic regression verification for frozen third-party NIFTY minute pipeline fixture.',
    fixture: {
      filename: path.basename(RAW_FILE),
      sha256: actualSha,
      baselineFile: path.basename(SNAPSHOT_FILE),
      governanceFile: path.basename(GOVERNANCE_FILE),
      governanceDecision: governance.decision,
      eligibleCurrentIntradayContext: governance.eligibleCurrentIntradayContext
    },
    scenarios: scenarioResults,
    differences: allDiffs,
    summary: {
      scenarios: scenarioResults.length,
      passed: scenarioResults.filter((item) => item.status === 'PASS').length,
      failed: scenarioResults.filter((item) => item.status === 'FAIL').length,
      differences: allDiffs.length,
      result: allDiffs.length === 0 ? 'PASS' : 'FAIL'
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  for (const item of scenarioResults) {
    console.log(`REGRESSION: ${item.status}`);
    console.log(`scenario: ${item.id}`);
    console.log(`asOf: ${item.asOf}`);
    console.log(`differences: ${item.differenceCount}`);
  }

  if (allDiffs.length > 0) {
    console.log('');
    console.log('First detailed differences:');

    for (const diff of allDiffs.slice(0, 25)) {
      console.log('REGRESSION: FAIL');
      console.log(`asOf: ${diff.asOf}`);
      console.log(`scenario: ${diff.scenario}`);
      console.log(`timeframe: ${diff.timeframe ?? 'aggregate/source'}`);
      console.log(`component: ${diff.component}`);
      console.log(`expected: ${diff.expected}`);
      console.log(`actual:   ${diff.actual}`);
      console.log(`difference: ${diff.difference}`);
      console.log('');
    }
  }

  console.log(`Regression summary: ${output.summary.result}`);
  console.log(`Scenarios: ${output.summary.passed}/${output.summary.scenarios} passed.`);
  console.log(`Differences: ${output.summary.differences}`);
  console.log(`Audit JSON: ${OUTPUT_FILE}`);
  console.log('Safety: offline deterministic regression only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');

  if (allDiffs.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
