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
const QUALITY_AUDIT_FILE = path.join(ROOT, 'data/india-analysis/nifty50-nse-daily-quality-report.json');
const OUTPUT_FILE = path.join(ROOT, 'data/india-analysis/nifty-daily-reference-snapshots.json');

const SCENARIOS = Object.freeze([
  {
    id: 'LATEST_OFFICIAL_DAILY_DATA_END',
    cutoff: '2026-09-07T15:30:00+05:30',
    note: 'Includes all imported official daily candles through the documented data end.'
  },
  {
    id: 'HISTORICAL_CUTOFF_2025',
    cutoff: '2025-02-07T15:30:00+05:30',
    note: 'Independent historical daily calculation before the final source period.'
  },
  {
    id: 'PRE_SMA200_HISTORY',
    cutoff: '2024-06-01T15:30:00+05:30',
    note: 'Confirms SMA(200) stays unavailable when fewer than 200 daily candles exist.'
  }
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filePath) {
  assert(fs.existsSync(filePath), `Missing daily normalized CSV: ${filePath}`);

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label}: ${error.message}`);
  }
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

function scenarioSnapshot(candles, scenario) {
  const cutoff = new Date(scenario.cutoff);

  assert(!Number.isNaN(cutoff.getTime()), `Invalid scenario cutoff "${scenario.cutoff}".`);

  const eligible = candles.filter((candle) => candle.timestamp.getTime() <= cutoff.getTime());

  assert(eligible.length > 0, `Scenario ${scenario.id} has no eligible daily candles.`);

  return {
    id: scenario.id,
    cutoff: scenario.cutoff,
    note: scenario.note,
    eligibleDailyCandles: eligible.length,
    firstEligibleTimestampUtc: eligible[0].timestampIso,
    lastEligibleTimestampUtc: eligible.at(-1).timestampIso,
    daily: analyseTimeframe(eligible, '1D')
  };
}

try {
  const qualityAudit = readJson(QUALITY_AUDIT_FILE, 'daily quality audit');
  const actualSha = sha256(DAILY_FILE);

  assert(
    qualityAudit?.researchOnly === true &&
      qualityAudit?.executionAllowed === false &&
      qualityAudit?.brokerConnectivityAllowed === false &&
      qualityAudit?.websocketAllowed === false,
    'Refusing snapshot creation: daily quality audit does not preserve research-only safety settings.'
  );

  assert(
    qualityAudit?.duplicateDates?.length === 0,
    'Refusing snapshot creation: daily quality audit reports duplicate dates.'
  );

  assert(
    qualityAudit?.outputRows >= 200,
    'Refusing snapshot creation: daily quality audit has fewer than 200 rows.'
  );

  const candles = loadDailyCandles();
  const snapshots = SCENARIOS.map((scenario) => scenarioSnapshot(candles, scenario));

  const output = {
    schemaVersion: 1,
    createdAtUtc: new Date().toISOString(),
    purpose: 'Canonical deterministic regression snapshots for the independent official daily NIFTY 50 reference pipeline.',
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    source: {
      tier: 'LOCAL_NORMALIZED_OFFICIAL_NSE_DAILY_CSV',
      normalizedFile: path.basename(DAILY_FILE),
      sha256: actualSha,
      coverage: qualityAudit.chronologicalRange,
      inputRows: qualityAudit.inputRows,
      outputRows: qualityAudit.outputRows,
      duplicateDates: qualityAudit.duplicateDates.length,
      timestampConvention: qualityAudit.timestampConvention
    },
    scenarios: snapshots
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log('PASS: Canonical NIFTY daily reference snapshots created.');
  console.log(`Daily normalized SHA-256: ${actualSha}`);
  console.log(`Daily coverage: ${output.source.coverage.firstDate} to ${output.source.coverage.lastDate}`);
  console.log(`Daily rows: ${output.source.outputRows}`);

  for (const snapshot of snapshots) {
    console.log(
      `Scenario ${snapshot.id}: candles=${snapshot.eligibleDailyCandles}; ` +
      `bias=${snapshot.daily.bias}; ` +
      `SMA200=${snapshot.daily.indicators.sma200}; ` +
      `ATR14=${snapshot.daily.indicators.atr14}`
    );
  }

  console.log(`Snapshot JSON: ${OUTPUT_FILE}`);
  console.log('Safety: offline official daily CSV snapshots only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
