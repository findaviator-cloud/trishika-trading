#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const requiredFiles = [
  'admission/source-admission-policy.json',
  'admission/candidate-profiles/nifty-frozen-minute-fixture.json',
  'admission/candidate-profiles/synthetic-clean-minute.json',
  'admission/candidate-profiles/synthetic-stale-minute.json',
  'admission/candidate-profiles/synthetic-reconciliation-review-minute.json',
  'admission/candidate-profiles/synthetic-hash-mismatch-minute.json',
  'scripts/run-source-admission.js',
  'scripts/verify-source-admission.js',
  'scripts/run-source-admission-regression.js',
  'data/india-analysis/nifty-minute-source-admission.json',
  'data/india-analysis/source-admission-regression-audit.json'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const relativePath of requiredFiles) {
    assert(fs.existsSync(path.join(ROOT, relativePath)), `Missing framework artifact: ${relativePath}`);
  }

  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'admission/source-admission-policy.json'), 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/india-analysis/nifty-minute-source-admission.json'), 'utf8'));
  const regression = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/india-analysis/source-admission-regression-audit.json'), 'utf8'));

  assert(policy.researchOnly === true, 'Policy researchOnly must be true.');
  assert(policy.approvedForTrading === false, 'Policy trading approval must be false.');
  assert(policy.executionBoundary?.brokerConnectivityAllowed === false, 'Policy broker boundary failed.');
  assert(policy.executionBoundary?.websocketAllowed === false, 'Policy WebSocket boundary failed.');
  assert(policy.executionBoundary?.ordersAllowed === false, 'Policy orders boundary failed.');
  assert(policy.executionBoundary?.executionAllowed === false, 'Policy execution boundary failed.');

  assert(artifact.decision === 'BLOCKED', 'Frozen NIFTY fixture must remain BLOCKED.');
  assert(artifact.approvedForResearchSource === false, 'Frozen NIFTY fixture must not be research-approved.');
  assert(artifact.approvedForTrading === false, 'Frozen NIFTY fixture must not be trading-approved.');
  assert(artifact.executionBoundary?.researchOnly === true, 'Admission artifact research-only boundary failed.');
  assert(artifact.executionBoundary?.brokerConnectivityAllowed === false, 'Admission artifact broker boundary failed.');
  assert(artifact.executionBoundary?.websocketAllowed === false, 'Admission artifact WebSocket boundary failed.');
  assert(artifact.executionBoundary?.ordersAllowed === false, 'Admission artifact orders boundary failed.');
  assert(artifact.executionBoundary?.executionAllowed === false, 'Admission artifact execution boundary failed.');

  assert(regression.summary?.result === 'PASS', 'Admission regression must pass.');
  assert(regression.summary?.repeatability === 'PASS', 'Admission repeatability must pass.');

  const byName = new Map((regression.cases ?? []).map((item) => [item.name, item]));
  assert(byName.get('SYNTHETIC_APPROVED')?.actualDecision === 'APPROVED_FOR_RESEARCH_SOURCE', 'Synthetic approved fixture failed.');
  assert(byName.get('SYNTHETIC_REVIEW')?.actualDecision === 'REVIEW', 'Synthetic review fixture failed.');
  assert(byName.get('SYNTHETIC_BLOCKED_FRESHNESS')?.actualDecision === 'BLOCKED', 'Synthetic freshness blocked fixture failed.');
  assert(byName.get('SYNTHETIC_BLOCKED_HASH_MISMATCH')?.actualDecision === 'BLOCKED', 'Synthetic hash mismatch blocked fixture failed.');
  assert(byName.get('FROZEN_NIFTY_FIXTURE_EXPECTED_BLOCKED')?.actualDecision === 'BLOCKED', 'Frozen NIFTY baseline changed.');

  console.log('PASS: GENERIC_VALIDATOR_BOUND');
  console.log('PASS: POLICY_VALIDATION_BOUND');
  console.log('PASS: CANDIDATE_PROFILES_BOUND');
  console.log('PASS: SYNTHETIC_APPROVED_FIXTURE_BOUND');
  console.log('PASS: SYNTHETIC_REVIEW_FIXTURE_BOUND');
  console.log('PASS: SYNTHETIC_BLOCKED_FIXTURES_BOUND');
  console.log('PASS: FROZEN_NIFTY_FIXTURE_BLOCKED_EXPECTED');
  console.log('PASS: ADMISSION_ARTIFACTS_BOUND');
  console.log('PASS: REPEATABILITY_BOUND');
  console.log('PASS: RESEARCH_ONLY_EXECUTION_BOUNDARY_BOUND');
  console.log('Safety: offline framework verification only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
