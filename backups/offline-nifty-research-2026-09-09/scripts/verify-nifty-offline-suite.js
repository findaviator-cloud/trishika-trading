#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REQUIRED = [
  'scripts/run-nifty-offline-validation-suite.js',
  'scripts/show-nifty-research-status.js',
  'scripts/export-nifty-research-manifest.js',
  'data/india-analysis/nifty-offline-suite-manifest.json',
  'data/india-analysis/nifty-research-status.json',
  'data/india-analysis/nifty-research-status.md'
];

const requiredFields = [
  ['manifest.safety.executionAllowed', (x) => x.safety?.executionAllowed === false],
  ['manifest.safety.brokerConnectivityAllowed', (x) => x.safety?.brokerConnectivityAllowed === false],
  ['manifest.safety.websocketAllowed', (x) => x.safety?.websocketAllowed === false],
  ['manifest.daily.regression', (x) => x.officialDailyReference?.regression === 'PASS'],
  ['manifest.intraday.regression', (x) => x.thirdPartyMinuteFixture?.regression === 'PASS'],
  ['manifest.intraday.referenceGate', (x) => x.thirdPartyMinuteFixture?.referenceGate === 'FAIL'],
  ['manifest.intraday.freshnessGate', (x) => x.thirdPartyMinuteFixture?.freshnessGate === 'FAIL'],
  ['manifest.intraday.eligible', (x) => x.thirdPartyMinuteFixture?.eligibleCurrentIntradayContext === false],
  ['status.overall', (x) => x.overall?.status === 'PASS_WITH_INTRADAY_HARD_BLOCK'],
  ['status.intraday.decision', (x) => x.intradayFixture?.decision === 'BLOCKED']
];

try {
  for (const relativePath of REQUIRED) {
    const fullPath = path.join(ROOT, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing required offline-suite artifact: ${relativePath}`);
    }
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/india-analysis/nifty-offline-suite-manifest.json'), 'utf8')
  );
  const status = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/india-analysis/nifty-research-status.json'), 'utf8')
  );

  const failures = [];

  for (const [name, condition] of requiredFields) {
    const target = name.startsWith('manifest.') ? manifest : status;

    if (!condition(target)) failures.push(name);
  }

  if (failures.length > 0) {
    throw new Error(`Offline-suite verification failed: ${failures.join(', ')}`);
  }

  console.log('PASS: OFFLINE_NIFTY_OPERATIONS_SUITE_COMPLETE');
  console.log('PASS: DAILY_REFERENCE_REGRESSION_BOUND');
  console.log('PASS: INTRADAY_FIXTURE_GOVERNANCE_BOUND');
  console.log('PASS: INTRADAY_FIXTURE_REGRESSION_BOUND');
  console.log('PASS: CURRENT_INTRADAY_HARD_BLOCK_CONFIRMED');
  console.log('PASS: EXECUTION_BROKER_WEBSOCKET_DISABLED');
  console.log('PASS: STATUS_AND_MANIFEST_ARTIFACTS_VALID');
  console.log('Safety: local suite verification only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
