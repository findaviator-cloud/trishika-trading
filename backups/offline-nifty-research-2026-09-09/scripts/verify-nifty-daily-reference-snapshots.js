#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyseTimeframe,
  normalizeCandles,
  parseCsv
} from '../src/india/indian_mtf_core.js';

const ROOT = process.cwd();
const DAILY_FILE = path.join(ROOT, 'data/india-input/nifty50-nse-daily-normalized.csv');
const SNAPSHOT_FILE = path.join(ROOT, 'data/india-analysis/nifty-daily-reference-snapshots.json');
const QUALITY_AUDIT_FILE = path.join(ROOT, 'data/india-analysis/nifty50-nse-daily-quality-report.json');
const OUTPUT_FILE = path.join(ROOT, 'data/india-analysis/nifty-daily-reference-regression-audit.json');

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
  assert(fs.existsSync(filePath), `Missing daily normalized CSV: ${filePath}`);

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function parseNseDailyTimestamp(raw, rowNumber) {
  if (!/T15:30:00\+05:30$/.test(raw)) {
    throw new Error(
      `Row ${rowNumber}: expected normalized NSE daily timestamp ending ` +
      `T15:30:00+05:30, got "${raw}".`
    );
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Row ${rowNumber}: invalid timestamp "${raw}".`);
  }

  return date;
}

function loadDailyCandles() {
  const rows = parseCsv(fs.readFileSync(DAILY_FILE, 'utf8'));
  const normalized = normalizeCandles(rows);

  return normalized.map((candle, index) => {
    const timestamp = parseNseDailyTimestamp(rows[index].timestamp, index + 2);

    return {
      ...candle,
      timestamp,
      timestampIso: timestamp.toISOString(),
      localTime: rows[index].timestamp,
      sourceCandleCount: 1
    };
  });
}

function readPath(object, pathKey) {
  return pathKey.split('.').reduce(
    (value, key) => value === null || value === undefined ? undefined : value[key],
    object
  );
}

function difference(expected, actual) {
  if (typeof expected !== 'number' || typeof actual !== 'number') return null;
  return Number((actual - expected).toFixed(8));
}

function compare(component, expected, actual, context, diffs) {
  const equal = typeof expected === 'number' && typeof actual === 'number'
    ? Math.abs(expected - actual) <= 1e-10
    : expected === actual;

  if (!equal) {
    diffs.push({
      ...context,
      component,
      expected,
      actual,
      difference: difference(expected, actual)
    });
  }
}

function recomputeScenario(candles, expectedScenario) {
  const cutoff = new Date(expectedScenario.cutoff);

  assert(!Number.isNaN(cutoff.getTime()), `Invalid baseline cutoff: ${expectedScenario.cutoff}`);

  const eligible = candles.filter((candle) => candle.timestamp.getTime() <= cutoff.getTime());

  assert(eligible.length > 0, `No eligible candles for baseline scenario ${expectedScenario.id}.`);

  return {
    id: expectedScenario.id,
    cutoff: expectedScenario.cutoff,
    eligibleDailyCandles: eligible.length,
    firstEligibleTimestampUtc: eligible[0].timestampIso,
    lastEligibleTimestampUtc: eligible.at(-1).timestampIso,
    daily: analyseTimeframe(eligible, '1D')
  };
}

function compareScenario(expected, actual) {
  const diffs = [];
  const context = {
    scenario: expected.id,
    cutoff: expected.cutoff,
    timeframe: '1D'
  };

  compare('eligibleDailyCandles', expected.eligibleDailyCandles, actual.eligibleDailyCandles, context, diffs);
  compare('firstEligibleTimestampUtc', expected.firstEligibleTimestampUtc, actual.firstEligibleTimestampUtc, context, diffs);
  compare('lastEligibleTimestampUtc', expected.lastEligibleTimestampUtc, actual.lastEligibleTimestampUtc, context, diffs);

  const fields = [
    'bias',
    'reason',
    'candleCount',
    'lastCandle.timestampUtc',
    'lastCandle.timestampIndia',
    'lastCandle.open',
    'lastCandle.high',
    'lastCandle.low',
    'lastCandle.close',
    'lastCandle.volume',
    'lastCandle.sourceCandleCount',
    'indicators.sma200',
    'indicators.atr14',
    'indicators.donchian20.upper',
    'indicators.donchian20.lower'
  ];

  for (const field of fields) {
    compare(
      field,
      readPath(expected.daily, field),
      readPath(actual.daily, field),
      context,
      diffs
    );
  }

  return diffs;
}

try {
  const baseline = readJson(SNAPSHOT_FILE, 'daily canonical snapshots');
  const qualityAudit = readJson(QUALITY_AUDIT_FILE, 'daily quality audit');
  const actualSha = sha256(DAILY_FILE);
  const expectedSha = baseline?.source?.sha256;

  assert(
    expectedSha === actualSha,
    [
      'REGRESSION: FAIL',
      'component: DAILY_NORMALIZED_CSV_SHA256',
      `expected: ${expectedSha}`,
      `actual:   ${actualSha}`,
      'difference: normalized official daily CSV changed; baseline comparison refused; deliberate re-normalization and snapshot review required.'
    ].join('\n')
  );

  assert(
    qualityAudit?.duplicateDates?.length === 0 &&
      qualityAudit?.researchOnly === true &&
      qualityAudit?.executionAllowed === false &&
      qualityAudit?.brokerConnectivityAllowed === false &&
      qualityAudit?.websocketAllowed === false,
    'REGRESSION: FAIL\ncomponent: DAILY_QUALITY_AUDIT_POLICY\nexpected: duplicate-free research-only daily audit\nactual: audit policy or duplicate state changed.'
  );

  const candles = loadDailyCandles();
  const scenarioResults = [];
  const differences = [];

  for (const expected of baseline.scenarios) {
    const actual = recomputeScenario(candles, expected);
    const diffs = compareScenario(expected, actual);

    scenarioResults.push({
      id: expected.id,
      cutoff: expected.cutoff,
      status: diffs.length === 0 ? 'PASS' : 'FAIL',
      differenceCount: diffs.length
    });

    differences.push(...diffs);
  }

  const output = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    purpose: 'Deterministic regression verification for the independent official daily NIFTY 50 reference pipeline.',
    source: {
      normalizedFile: path.basename(DAILY_FILE),
      sha256: actualSha,
      baselineFile: path.basename(SNAPSHOT_FILE),
      qualityAuditFile: path.basename(QUALITY_AUDIT_FILE),
      coverage: qualityAudit.chronologicalRange
    },
    scenarios: scenarioResults,
    differences,
    summary: {
      scenarios: scenarioResults.length,
      passed: scenarioResults.filter((item) => item.status === 'PASS').length,
      failed: scenarioResults.filter((item) => item.status === 'FAIL').length,
      differences: differences.length,
      result: differences.length === 0 ? 'PASS' : 'FAIL'
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  for (const result of scenarioResults) {
    console.log('REGRESSION: ' + result.status);
    console.log(`scenario: ${result.id}`);
    console.log(`cutoff: ${result.cutoff}`);
    console.log(`differences: ${result.differenceCount}`);
  }

  if (differences.length > 0) {
    console.log('');
    console.log('First detailed differences:');

    for (const diff of differences.slice(0, 25)) {
      console.log('REGRESSION: FAIL');
      console.log(`scenario: ${diff.scenario}`);
      console.log(`cutoff: ${diff.cutoff}`);
      console.log(`timeframe: ${diff.timeframe}`);
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
  console.log('Safety: offline official daily regression only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');

  if (differences.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
