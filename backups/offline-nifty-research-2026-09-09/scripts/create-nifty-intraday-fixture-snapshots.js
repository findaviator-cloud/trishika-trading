#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  INTRADAY_POLICY,
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
const ELIGIBILITY_FILE = path.join(
  ROOT,
  'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json'
);
const OUTPUT_FILE = path.join(
  ROOT,
  'data/india-analysis/nifty-intraday-fixture-snapshots.json'
);

const SCENARIOS = Object.freeze([
  {
    id: 'PRIOR_SESSION_BEFORE_OPEN',
    asOf: '2025-02-07T10:30:00+05:30',
    delayMinutes: 120,
    note: 'Cutoff is 08:30 IST, before NSE open; current-day session must contribute zero eligible minutes.'
  },
  {
    id: 'IN_SESSION_DELAYED',
    asOf: '2025-02-06T14:00:00+05:30',
    delayMinutes: 120,
    note: 'Cutoff is 12:00 IST; only completed minute candles whose close is at/before cutoff are eligible.'
  },
  {
    id: 'POST_SESSION_DELAYED',
    asOf: '2025-02-06T17:45:00+05:30',
    delayMinutes: 120,
    note: 'Cutoff is 15:45 IST; full regular 09:15–15:29 session is eligible.'
  }
]);

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

function makeScenario(rawCandles, inspection, scenario) {
  const asOf = new Date(scenario.asOf);

  assert(!Number.isNaN(asOf.getTime()), `Invalid scenario asOf: ${scenario.asOf}`);

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
    note: scenario.note,
    cutoffUtc: eligible.cutoff.toISOString(),
    eligibleMinuteCandles: eligible.candles.length,
    aggregate: aggregateIntradayBias(timeframes),
    timeframes
  };
}

try {
  const eligibility = readJson(ELIGIBILITY_FILE, 'eligibility policy audit');
  const actualSha = sha256(RAW_FILE);
  const boundSha = eligibility?.provenance?.rawMinuteSourceSha256;

  assert(boundSha, 'Eligibility audit has no bound raw fixture SHA-256.');
  assert(
    actualSha === boundSha,
    [
      'REFUSING BASELINE CREATION: raw fixture SHA-256 does not match governance provenance.',
      `expected=${boundSha}`,
      `actual=${actualSha}`,
      'Run a deliberate structural/reconciliation/governance re-audit before any snapshot baseline refresh.'
    ].join(' ')
  );

  assert(
    eligibility?.eligibleCurrentIntradayContext === false &&
      eligibility?.decision === 'BLOCKED',
    'REFUSING BASELINE CREATION: fixture eligibility policy is not in expected BLOCKED state.'
  );

  const rawCandles = loadRawMinuteCandles(RAW_FILE);
  const inspection = inspectMinuteCandles(rawCandles);

  assert(inspection.duplicates.length === 0, 'Raw fixture has duplicate timestamps.');
  assert(inspection.outOfOrder.length === 0, 'Raw fixture has out-of-order timestamps.');
  assert(inspection.strictFullSessionDays > 0, 'Raw fixture has no strict full sessions.');

  const snapshots = SCENARIOS.map((scenario) => makeScenario(rawCandles, inspection, scenario));

  const output = {
    schemaVersion: 1,
    createdAtUtc: new Date().toISOString(),
    purpose: 'Canonical deterministic regression snapshots for frozen third-party NIFTY minute pipeline fixture.',
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    fixture: {
      filename: path.basename(RAW_FILE),
      sha256: actualSha,
      sourceClassification: eligibility.sourceClassification,
      eligibilityAtCreation: {
        eligibleCurrentIntradayContext: eligibility.eligibleCurrentIntradayContext,
        decision: eligibility.decision,
        gates: eligibility.gates
      }
    },
    policy: {
      timezone: INTRADAY_POLICY.timezone,
      timestampConvention: INTRADAY_POLICY.timestampConvention,
      strictFullSessionOnly: INTRADAY_POLICY.strictFullSessionOnly,
      expectedMinuteBarsPerRegularSession: INTRADAY_POLICY.expectedMinuteBarsPerRegularSession,
      volumePolicy: INTRADAY_POLICY.volumePolicy
    },
    scenarios: snapshots
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log('PASS: Canonical NIFTY intraday fixture snapshots created.');
  console.log(`Fixture SHA-256: ${actualSha}`);
  console.log(`Fixture policy decision: ${eligibility.decision}`);
  console.log(`Fixture eligibility: ${eligibility.eligibleCurrentIntradayContext}`);

  for (const snapshot of snapshots) {
    console.log(
      `Scenario ${snapshot.id}: eligibleMinutes=${snapshot.eligibleMinuteCandles}; ` +
      `1H=${snapshot.timeframes['1H'].bias}; ` +
      `2H=${snapshot.timeframes['2H'].bias}; ` +
      `4H=${snapshot.timeframes['4H'].bias}; ` +
      `aggregate=${snapshot.aggregate.bias}`
    );
  }

  console.log(`Snapshot JSON: ${OUTPUT_FILE}`);
  console.log('Safety: offline deterministic fixture snapshots only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
