#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FILES = Object.freeze({
  watchlist: path.join(ROOT, 'config/indian-watchlist.json'),
  dailyNormalized: path.join(ROOT, 'data/india-input/nifty50-nse-daily-normalized.csv'),
  rawMinuteFixture: path.join(ROOT, 'data/india-input/NIFTY 50_minute_data.csv'),
  minuteAudit: path.join(ROOT, 'data/india-analysis/nifty50-minute-input-audit.json'),
  reconciliation: path.join(ROOT, 'data/india-analysis/nifty50-daily-intraday-reconciliation.json'),
  eligibility: path.join(ROOT, 'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json'),
  output: path.join(ROOT, 'data/india-analysis/nifty-data-governance-regression-audit.json')
});

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`Missing ${label}: ${filePath}`);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function sha256(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`Missing ${label}: ${filePath}`);

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function check(results, name, condition, detail) {
  results.push({
    name,
    status: condition ? 'PASS' : 'FAIL',
    detail
  });
}

function countCsvRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const nonEmpty = text.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (nonEmpty.length < 2) fail(`CSV has no usable rows: ${filePath}`);

  return nonEmpty.length - 1;
}

try {
  const watchlist = readJson(FILES.watchlist, 'watchlist');
  const minuteAudit = readJson(FILES.minuteAudit, 'minute input audit');
  const reconciliation = readJson(FILES.reconciliation, 'reconciliation audit');
  const eligibility = readJson(FILES.eligibility, 'eligibility audit');

  const results = [];
  const dailyRowCount = countCsvRows(FILES.dailyNormalized);
  const minuteFixtureSha256 = sha256(FILES.rawMinuteFixture, 'raw minute fixture');

  const nifty = Array.isArray(watchlist.instruments)
    ? watchlist.instruments.find((item) => item.id === 'NIFTY')
    : null;

  check(
    results,
    'DAILY_REFERENCE_PIPELINE_INDEPENDENT',
    fs.existsSync(FILES.dailyNormalized) &&
      dailyRowCount >= 200 &&
      nifty?.assetClass === 'INDEX' &&
      nifty?.exchange === 'NSE' &&
      nifty?.segment === 'NSE_INDEX',
    `Normalized official daily CSV rows=${dailyRowCount}; NIFTY metadata is cash-index/NSE_INDEX.`
  );

  check(
    results,
    'THIRD_PARTY_FIXTURE_STRUCTURALLY_VALID',
    minuteAudit?.researchOnly === true &&
      minuteAudit?.executionAllowed === false &&
      minuteAudit?.brokerConnectivityAllowed === false &&
      minuteAudit?.websocketAllowed === false &&
      minuteAudit?.policy?.sourceTier === 'THIRD_PARTY_HISTORICAL_RESEARCH' &&
      minuteAudit?.inspection?.duplicates?.length === 0 &&
      minuteAudit?.inspection?.outOfOrder?.length === 0 &&
      Number(minuteAudit?.inspection?.strictFullSessionDays) > 0,
    (
      `sourceTier=${minuteAudit?.policy?.sourceTier}; ` +
      `duplicates=${minuteAudit?.inspection?.duplicates?.length}; ` +
      `outOfOrder=${minuteAudit?.inspection?.outOfOrder?.length}; ` +
      `strictFullSessionDays=${minuteAudit?.inspection?.strictFullSessionDays}.`
    )
  );

  check(
    results,
    'REFERENCE_GATE_HARD_BLOCK',
    reconciliation?.summary?.result !== 'PASS' &&
      reconciliation?.classification !== 'REFERENCE_RECONCILED' &&
      eligibility?.gates?.referenceReconciliationGate === 'FAIL' &&
      eligibility?.eligibleCurrentIntradayContext === false,
    (
      `reconciliationResult=${reconciliation?.summary?.result}; ` +
      `classification=${reconciliation?.classification}; ` +
      `eligibilityReferenceGate=${eligibility?.gates?.referenceReconciliationGate}; ` +
      `eligible=${eligibility?.eligibleCurrentIntradayContext}.`
    )
  );

  check(
    results,
    'STALE_GATE_HARD_BLOCK',
    eligibility?.gates?.freshnessGate === 'FAIL' &&
      eligibility?.sourceClassification?.freshness === 'STALE' &&
      eligibility?.eligibleCurrentIntradayContext === false,
    (
      `freshnessGate=${eligibility?.gates?.freshnessGate}; ` +
      `freshness=${eligibility?.sourceClassification?.freshness}; ` +
      `eligible=${eligibility?.eligibleCurrentIntradayContext}.`
    )
  );

  check(
    results,
    'RESEARCH_ONLY_ENFORCED',
    watchlist?.executionAllowed === false &&
      watchlist?.brokerConnectivityAllowed === false &&
      watchlist?.websocketAllowed === false &&
      nifty?.researchOnly === true &&
      nifty?.executionAllowed === false &&
      eligibility?.gates?.researchOnlyGate === 'PASS',
    (
      `global execution=${watchlist?.executionAllowed}; ` +
      `broker=${watchlist?.brokerConnectivityAllowed}; ` +
      `websocket=${watchlist?.websocketAllowed}; ` +
      `nifty researchOnly=${nifty?.researchOnly}; ` +
      `nifty execution=${nifty?.executionAllowed}.`
    )
  );

  check(
    results,
    'EXECUTION_DISABLED',
    eligibility?.gates?.executionGate === 'PASS' &&
      eligibility?.sourceClassification?.execution === 'DISABLED',
    (
      `executionGate=${eligibility?.gates?.executionGate}; ` +
      `classificationExecution=${eligibility?.sourceClassification?.execution}.`
    )
  );

  check(
    results,
    'BROKER_CONNECTIVITY_DISABLED',
    eligibility?.gates?.brokerConnectivityGate === 'PASS' &&
      eligibility?.sourceClassification?.brokerConnectivity === 'DISABLED',
    (
      `brokerConnectivityGate=${eligibility?.gates?.brokerConnectivityGate}; ` +
      `classificationBroker=${eligibility?.sourceClassification?.brokerConnectivity}.`
    )
  );

  check(
    results,
    'WEBSOCKET_DISABLED',
    eligibility?.gates?.websocketGate === 'PASS' &&
      eligibility?.sourceClassification?.websocket === 'DISABLED',
    (
      `websocketGate=${eligibility?.gates?.websocketGate}; ` +
      `classificationWebsocket=${eligibility?.sourceClassification?.websocket}.`
    )
  );

  check(
    results,
    'CURRENT_INTRADAY_CONTEXT_BLOCKED',
    eligibility?.eligibleCurrentIntradayContext === false &&
      eligibility?.decision === 'BLOCKED' &&
      eligibility?.sourceClassification?.currentIntradayUse === 'PROHIBITED',
    (
      `eligible=${eligibility?.eligibleCurrentIntradayContext}; ` +
      `decision=${eligibility?.decision}; ` +
      `currentIntradayUse=${eligibility?.sourceClassification?.currentIntradayUse}.`
    )
  );

  check(
    results,
    'FIXTURE_PROVENANCE_BOUND',
    eligibility?.provenance?.rawMinuteSourceSha256 === minuteFixtureSha256 &&
      eligibility?.provenance?.rawMinuteSource === path.basename(FILES.rawMinuteFixture),
    (
      `expectedSha256=${minuteFixtureSha256}; ` +
      `auditedSha256=${eligibility?.provenance?.rawMinuteSourceSha256}; ` +
      `source=${eligibility?.provenance?.rawMinuteSource}.`
    )
  );

  const failed = results.filter((item) => item.status === 'FAIL');
  const output = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    researchOnly: true,
    executionAllowed: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    purpose: 'Offline governance regression audit for the frozen NIFTY minute validation fixture and separate official daily reference pipeline.',
    sourcePolicy: {
      officialDaily: 'REFERENCE_QUALITY_DAILY_RESEARCH_WITHIN_ACTUAL_COVERAGE',
      thirdPartyMinute: 'STRUCTURALLY_VALID_BUT_NOT_REFERENCE_RECONCILED_HISTORICAL_FIXTURE_ONLY',
      currentIntradayContext: 'BLOCKED',
      referenceUse: 'BLOCKED',
      execution: 'DISABLED'
    },
    provenance: {
      dailyNormalizedFile: path.basename(FILES.dailyNormalized),
      dailyNormalizedRows: dailyRowCount,
      rawMinuteFixture: path.basename(FILES.rawMinuteFixture),
      rawMinuteFixtureSha256: minuteFixtureSha256,
      minuteAudit: path.basename(FILES.minuteAudit),
      reconciliation: path.basename(FILES.reconciliation),
      eligibility: path.basename(FILES.eligibility)
    },
    checks: results,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      result: failed.length === 0 ? 'PASS' : 'FAIL'
    }
  };

  fs.mkdirSync(path.dirname(FILES.output), { recursive: true });
  fs.writeFileSync(FILES.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  for (const item of results) {
    console.log(`${item.status}: ${item.name}`);
    console.log(`  ${item.detail}`);
  }

  console.log('');
  console.log(`Governance regression result: ${output.summary.result}`);
  console.log(`Checks: ${output.summary.passed}/${output.summary.total} passed.`);
  console.log(`Audit JSON: ${FILES.output}`);
  console.log('Safety: offline local verification only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');

  if (failed.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
