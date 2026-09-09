#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'data/india-analysis/nifty-offline-suite-manifest.json');

const FILES = Object.freeze({
  dailyNormalized: path.join(ROOT, 'data/india-input/nifty50-nse-daily-normalized.csv'),
  rawMinuteFixture: path.join(ROOT, 'data/india-input/NIFTY 50_minute_data.csv'),
  dailyQuality: path.join(ROOT, 'data/india-analysis/nifty50-nse-daily-quality-report.json'),
  dailySnapshots: path.join(ROOT, 'data/india-analysis/nifty-daily-reference-snapshots.json'),
  dailyRegression: path.join(ROOT, 'data/india-analysis/nifty-daily-reference-regression-audit.json'),
  minuteAudit: path.join(ROOT, 'data/india-analysis/nifty50-minute-input-audit.json'),
  reconciliation: path.join(ROOT, 'data/india-analysis/nifty50-daily-intraday-reconciliation.json'),
  eligibility: path.join(ROOT, 'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json'),
  intradaySnapshots: path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-snapshots.json'),
  intradayRegression: path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-regression-audit.json')
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filePath) {
  assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);

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
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function fileInfo(filePath, json = false) {
  assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);

  const info = {
    filename: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath)
  };

  if (json) {
    const parsed = readJson(filePath, path.basename(filePath));
    info.schemaVersion = parsed.schemaVersion ?? null;
    info.generatedAtUtc = parsed.generatedAtUtc ?? parsed.createdAtUtc ?? null;
  }

  return info;
}

try {
  const dailyQuality = readJson(FILES.dailyQuality, 'daily quality audit');
  const reconciliation = readJson(FILES.reconciliation, 'reconciliation audit');
  const eligibility = readJson(FILES.eligibility, 'eligibility audit');
  const dailyRegression = readJson(FILES.dailyRegression, 'daily regression audit');
  const intradayRegression = readJson(FILES.intradayRegression, 'intraday regression audit');

  const manifest = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    purpose: 'Offline NIFTY research operations manifest. No current market claim and no execution entitlement.',
    safety: {
      researchOnly: true,
      executionAllowed: false,
      brokerConnectivityAllowed: false,
      websocketAllowed: false,
      humanReviewRequired: true
    },
    officialDailyReference: {
      status: 'REFERENCE_QUALITY_DAILY_RESEARCH_WITHIN_ACTUAL_COVERAGE',
      coverage: dailyQuality.chronologicalRange,
      inputRows: dailyQuality.inputRows,
      outputRows: dailyQuality.outputRows,
      duplicateDates: dailyQuality.duplicateDates?.length ?? null,
      regression: dailyRegression.summary?.result ?? 'UNKNOWN',
      files: {
        normalized: fileInfo(FILES.dailyNormalized),
        qualityAudit: fileInfo(FILES.dailyQuality, true),
        snapshots: fileInfo(FILES.dailySnapshots, true),
        regressionAudit: fileInfo(FILES.dailyRegression, true)
      }
    },
    thirdPartyMinuteFixture: {
      status: 'STRUCTURALLY_VALID_BUT_NOT_REFERENCE_RECONCILED_HISTORICAL_FIXTURE_ONLY',
      structuralGate: eligibility.gates?.structuralGate ?? 'UNKNOWN',
      referenceGate: eligibility.gates?.referenceReconciliationGate ?? 'UNKNOWN',
      freshnessGate: eligibility.gates?.freshnessGate ?? 'UNKNOWN',
      currentIntradayUse: eligibility.sourceClassification?.currentIntradayUse ?? 'UNKNOWN',
      eligibleCurrentIntradayContext: eligibility.eligibleCurrentIntradayContext ?? null,
      decision: eligibility.decision ?? 'UNKNOWN',
      dataEndUtc: eligibility.provenance?.dataEndUtc ?? null,
      dataEndIndia: eligibility.provenance?.dataEndIndia ?? null,
      volumeStatus: eligibility.evidence?.allVolumeZero === true
        ? 'UNAVAILABLE_ALL_ZERO'
        : 'UNKNOWN',
      reconciliation: {
        result: reconciliation.summary?.result ?? 'UNKNOWN',
        compared: reconciliation.summary?.compared ?? null,
        pass: reconciliation.summary?.pass ?? null,
        review: reconciliation.summary?.review ?? null,
        meanAbsoluteDifference: reconciliation.summary?.meanAbsoluteDifference ?? null,
        maxAbsoluteDifference: reconciliation.summary?.maxAbsoluteDifference ?? null
      },
      regression: intradayRegression.summary?.result ?? 'UNKNOWN',
      files: {
        rawFixture: fileInfo(FILES.rawMinuteFixture),
        inputAudit: fileInfo(FILES.minuteAudit, true),
        reconciliation: fileInfo(FILES.reconciliation, true),
        eligibility: fileInfo(FILES.eligibility, true),
        snapshots: fileInfo(FILES.intradaySnapshots, true),
        regressionAudit: fileInfo(FILES.intradayRegression, true)
      }
    },
    sourceSeparation: {
      dailyAndMinuteRawShaDifferent:
        sha256(FILES.dailyNormalized) !== sha256(FILES.rawMinuteFixture),
      dailyPipelineRole: 'INDEPENDENT_1D_REFERENCE_RESEARCH',
      minuteFixtureRole: 'ISOLATED_DETERMINISTIC_PIPELINE_VALIDATION_FIXTURE',
      crossContaminationAllowed: false
    },
    recurringCommands: [
      'node scripts/run-nifty-offline-validation-suite.js',
      'node scripts/show-nifty-research-status.js'
    ]
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('PASS: Offline NIFTY research manifest exported.');
  console.log(`Daily reference regression: ${manifest.officialDailyReference.regression}`);
  console.log(`Intraday fixture regression: ${manifest.thirdPartyMinuteFixture.regression}`);
  console.log(`Intraday reference gate: ${manifest.thirdPartyMinuteFixture.referenceGate}`);
  console.log(`Intraday freshness gate: ${manifest.thirdPartyMinuteFixture.freshnessGate}`);
  console.log(`Current intraday eligibility: ${manifest.thirdPartyMinuteFixture.eligibleCurrentIntradayContext}`);
  console.log(`Manifest: ${OUTPUT}`);
  console.log('Safety: local manifest only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
