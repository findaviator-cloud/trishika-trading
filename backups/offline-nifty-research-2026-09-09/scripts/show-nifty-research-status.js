#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, 'data/india-analysis/nifty-offline-suite-manifest.json');
const STATUS_JSON = path.join(ROOT, 'data/india-analysis/nifty-research-status.json');
const STATUS_MD = path.join(ROOT, 'data/india-analysis/nifty-research-status.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  assert(fs.existsSync(filePath), `Missing manifest: ${filePath}`);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid manifest JSON: ${error.message}`);
  }
}

try {
  const manifest = readJson(MANIFEST);
  const daily = manifest.officialDailyReference;
  const minute = manifest.thirdPartyMinuteFixture;

  const currentIntradayBlocked =
    minute.eligibleCurrentIntradayContext === false &&
    minute.decision === 'BLOCKED' &&
    minute.referenceGate !== 'PASS';

  const status = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    overall: {
      status: (
        daily.regression === 'PASS' &&
        minute.regression === 'PASS' &&
        currentIntradayBlocked &&
        manifest.safety.executionAllowed === false &&
        manifest.safety.brokerConnectivityAllowed === false &&
        manifest.safety.websocketAllowed === false
      ) ? 'PASS_WITH_INTRADAY_HARD_BLOCK' : 'REVIEW_REQUIRED',
      meaning: (
        'Offline regression controls are healthy. The third-party minute fixture remains blocked ' +
        'from current intraday context because reference reconciliation and freshness requirements are not met.'
      )
    },
    safety: manifest.safety,
    dailyReference: {
      status: daily.status,
      coverage: daily.coverage,
      rows: daily.outputRows,
      duplicateDates: daily.duplicateDates,
      regression: daily.regression,
      allowedUse: 'INDEPENDENT_1D_REFERENCE_RESEARCH_WITHIN_ACTUAL_COVERAGE'
    },
    intradayFixture: {
      status: minute.status,
      structuralGate: minute.structuralGate,
      referenceGate: minute.referenceGate,
      freshnessGate: minute.freshnessGate,
      currentIntradayUse: minute.currentIntradayUse,
      eligibleCurrentIntradayContext: minute.eligibleCurrentIntradayContext,
      decision: minute.decision,
      dataEndIndia: minute.dataEndIndia,
      volumeStatus: minute.volumeStatus,
      reconciliation: minute.reconciliation,
      regression: minute.regression,
      allowedUse: 'HISTORICAL_PIPELINE_VALIDATION_FIXTURE_ONLY'
    }
  };

  const lines = [
    '# Offline NIFTY Research Status',
    '',
    `Generated UTC: ${status.generatedAtUtc}`,
    '',
    '## Overall',
    '',
    `- Status: ${status.overall.status}`,
    `- Meaning: ${status.overall.meaning}`,
    '',
    '## Official Daily Reference',
    '',
    `- Status: ${status.dailyReference.status}`,
    `- Coverage: ${status.dailyReference.coverage.firstDate} to ${status.dailyReference.coverage.lastDate}`,
    `- Normalized rows: ${status.dailyReference.rows}`,
    `- Duplicate dates: ${status.dailyReference.duplicateDates}`,
    `- Daily regression: ${status.dailyReference.regression}`,
    `- Allowed use: ${status.dailyReference.allowedUse}`,
    '',
    '## Third-Party Minute Fixture',
    '',
    `- Status: ${status.intradayFixture.status}`,
    `- Structural gate: ${status.intradayFixture.structuralGate}`,
    `- Reference reconciliation gate: ${status.intradayFixture.referenceGate}`,
    `- Freshness gate: ${status.intradayFixture.freshnessGate}`,
    `- Data end (Asia/Kolkata): ${status.intradayFixture.dataEndIndia}`,
    `- Current intraday use: ${status.intradayFixture.currentIntradayUse}`,
    `- eligibleCurrentIntradayContext: ${status.intradayFixture.eligibleCurrentIntradayContext}`,
    `- Decision: ${status.intradayFixture.decision}`,
    `- Volume status: ${status.intradayFixture.volumeStatus}`,
    `- Overlap comparison: ${status.intradayFixture.reconciliation.pass}/${status.intradayFixture.reconciliation.compared} within tolerance; ${status.intradayFixture.reconciliation.review} review.`,
    `- Intraday fixture regression: ${status.intradayFixture.regression}`,
    `- Allowed use: ${status.intradayFixture.allowedUse}`,
    '',
    '## Safety',
    '',
    `- Research only: ${status.safety.researchOnly}`,
    `- Execution allowed: ${status.safety.executionAllowed}`,
    `- Broker connectivity allowed: ${status.safety.brokerConnectivityAllowed}`,
    `- WebSocket allowed: ${status.safety.websocketAllowed}`,
    `- Human review required: ${status.safety.humanReviewRequired}`,
    '',
    '## Hard Rule',
    '',
    '- The third-party minute fixture is never eligible for current intraday context unless structural, reference reconciliation, freshness, and safety gates independently pass.',
    '- A metadata label or freshness relabel must not override a failed reference-reconciliation gate.',
    ''
  ];

  fs.mkdirSync(path.dirname(STATUS_JSON), { recursive: true });
  fs.writeFileSync(STATUS_JSON, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  fs.writeFileSync(STATUS_MD, lines.join('\n'), 'utf8');

  console.log('PASS: Offline NIFTY research status generated.');
  console.log(`Overall: ${status.overall.status}`);
  console.log(`Daily reference: ${status.dailyReference.regression}`);
  console.log(
    `Intraday fixture: structural=${status.intradayFixture.structuralGate}; ` +
    `reference=${status.intradayFixture.referenceGate}; ` +
    `freshness=${status.intradayFixture.freshnessGate}; ` +
    `eligible=${status.intradayFixture.eligibleCurrentIntradayContext}; ` +
    `decision=${status.intradayFixture.decision}`
  );
  console.log(`Status JSON: ${STATUS_JSON}`);
  console.log(`Status Markdown: ${STATUS_MD}`);
  console.log('Safety: local status generation only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
