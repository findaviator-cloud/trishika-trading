#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data/india-analysis/source-admission-regression');
const AUDIT_PATH = path.join(ROOT, 'data/india-analysis/source-admission-regression-audit.json');

const cases = [
  {
    name: 'SYNTHETIC_APPROVED',
    profile: 'admission/candidate-profiles/synthetic-clean-minute.json',
    expectedDecision: 'APPROVED_FOR_RESEARCH_SOURCE',
    expectedResearch: true
  },
  {
    name: 'SYNTHETIC_REVIEW',
    profile: 'admission/candidate-profiles/synthetic-reconciliation-review-minute.json',
    expectedDecision: 'REVIEW',
    expectedResearch: false
  },
  {
    name: 'SYNTHETIC_BLOCKED_FRESHNESS',
    profile: 'admission/candidate-profiles/synthetic-stale-minute.json',
    expectedDecision: 'BLOCKED',
    expectedResearch: false
  },
  {
    name: 'SYNTHETIC_BLOCKED_HASH_MISMATCH',
    profile: 'admission/candidate-profiles/synthetic-hash-mismatch-minute.json',
    expectedDecision: 'BLOCKED',
    expectedResearch: false
  },
  {
    name: 'FROZEN_NIFTY_FIXTURE_EXPECTED_BLOCKED',
    profile: 'admission/candidate-profiles/nifty-frozen-minute-fixture.json',
    expectedDecision: 'BLOCKED',
    expectedResearch: false
  }
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runAdmission(profile, output) {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-source-admission.js', '--profile', profile, '--output', output],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Validator failed for profile: ${profile}`);
}

function runVerifier(artifact) {
  const result = spawnSync(
    process.execPath,
    ['scripts/verify-source-admission.js', '--artifact', artifact],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Artifact verifier failed: ${artifact}`);
}

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (const testCase of cases) {
    const output = path.join('data/india-analysis/source-admission-regression', `${testCase.name.toLowerCase()}.json`);
    const repeatOutput = path.join('data/india-analysis/source-admission-regression', `${testCase.name.toLowerCase()}.repeat.json`);

    runAdmission(testCase.profile, output);
    runVerifier(output);
    runAdmission(testCase.profile, repeatOutput);

    const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, output), 'utf8'));
    const repeatArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, repeatOutput), 'utf8'));

    const semanticProjection = (value) => ({
      admissionId: value.admissionId,
      decision: value.decision,
      approvedForResearchSource: value.approvedForResearchSource,
      approvedForTrading: value.approvedForTrading,
      decisionPrecedence: value.decisionPrecedence,
      gates: value.gates,
      provenance: value.provenance,
      executionBoundary: value.executionBoundary
    });

    const repeatable = JSON.stringify(semanticProjection(artifact)) === JSON.stringify(semanticProjection(repeatArtifact));

    if (
      artifact.decision !== testCase.expectedDecision ||
      artifact.approvedForResearchSource !== testCase.expectedResearch ||
      !repeatable
    ) {
      throw new Error(
        `Regression mismatch for ${testCase.name}: ` +
        `decision=${artifact.decision}; research=${artifact.approvedForResearchSource}; repeatable=${repeatable}`
      );
    }

    results.push({
      name: testCase.name,
      expectedDecision: testCase.expectedDecision,
      actualDecision: artifact.decision,
      expectedApprovedForResearchSource: testCase.expectedResearch,
      actualApprovedForResearchSource: artifact.approvedForResearchSource,
      repeatability: repeatable ? 'PASS' : 'FAIL',
      artifactSha256: sha256(path.join(ROOT, output))
    });

    console.log(`REGRESSION: PASS ${testCase.name}`);
  }

  const audit = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    summary: {
      result: 'PASS',
      casesPassed: results.length,
      casesTotal: cases.length,
      repeatability: 'PASS'
    },
    cases: results,
    safety: {
      researchOnly: true,
      approvedForTrading: false,
      brokerConnectivityAllowed: false,
      websocketAllowed: false,
      ordersAllowed: false,
      executionAllowed: false
    }
  };

  fs.writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

  console.log('SOURCE ADMISSION REGRESSION: PASS');
  console.log(`Cases: ${results.length}/${cases.length} passed.`);
  console.log('Repeatability: PASS');
  console.log(`Audit JSON: ${AUDIT_PATH}`);
  console.log('Safety: offline local regression only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
