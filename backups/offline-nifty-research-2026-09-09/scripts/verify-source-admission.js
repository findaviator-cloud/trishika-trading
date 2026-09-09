#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const artifactRelativePath = args[args.indexOf('--artifact') + 1];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  assert(artifactRelativePath, 'Usage: node scripts/verify-source-admission.js --artifact <artifact.json>');
  const artifactPath = path.resolve(ROOT, artifactRelativePath);
  assert(artifactPath.startsWith(`${ROOT}${path.sep}`), 'Artifact path escapes project root.');
  assert(fs.existsSync(artifactPath), `Admission artifact missing: ${artifactRelativePath}`);

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert(artifact.schemaVersion === 1, 'Unsupported admission artifact schemaVersion.');
  assert(['BLOCKED', 'REVIEW', 'APPROVED_FOR_RESEARCH_SOURCE'].includes(artifact.decision), 'Invalid admission decision.');
  assert(typeof artifact.approvedForResearchSource === 'boolean', 'approvedForResearchSource must be boolean.');
  assert(artifact.approvedForTrading === false, 'approvedForTrading must remain false.');
  assert(artifact.executionBoundary?.researchOnly === true, 'researchOnly must remain true.');
  assert(artifact.executionBoundary?.brokerConnectivityAllowed === false, 'Broker must remain disabled.');
  assert(artifact.executionBoundary?.websocketAllowed === false, 'WebSocket must remain disabled.');
  assert(artifact.executionBoundary?.ordersAllowed === false, 'Orders must remain disabled.');
  assert(artifact.executionBoundary?.executionAllowed === false, 'Execution must remain disabled.');
  assert(artifact.provenance?.candidate?.sha256, 'Candidate SHA-256 missing.');
  assert(artifact.provenance?.candidateProfile?.sha256, 'Candidate profile SHA-256 missing.');
  assert(artifact.provenance?.policy?.sha256, 'Policy SHA-256 missing.');
  assert(artifact.provenance?.independentReference?.sha256, 'Independent reference SHA-256 missing.');
  assert(artifact.decisionPrecedence?.terminalReason, 'Terminal decision reason missing.');
  assert(artifact.gates && typeof artifact.gates === 'object', 'Raw gates missing.');

  const blockedExpected = artifact.decision === 'BLOCKED';
  const reviewExpected = artifact.decision === 'REVIEW';
  const approvedExpected = artifact.decision === 'APPROVED_FOR_RESEARCH_SOURCE';

  assert(
    artifact.approvedForResearchSource === approvedExpected,
    'Research approval does not match serialized decision.'
  );

  if (blockedExpected) {
    assert(artifact.decisionPrecedence.terminalReason !== 'ALL_REQUIRED_GATES_PASS', 'BLOCKED artifact cannot claim all gates passed.');
  }

  if (reviewExpected) {
    assert(artifact.decisionPrecedence.terminalReason.includes('REFERENCE') || artifact.decisionPrecedence.terminalReason.includes('FRESHNESS'), 'REVIEW artifact has unsupported terminal reason.');
  }

  if (approvedExpected) {
    assert(artifact.decisionPrecedence.terminalReason === 'ALL_REQUIRED_GATES_PASS', 'Approved research artifact must have all-gates-pass terminal reason.');
  }

  console.log('PASS: ADMISSION_ARTIFACT_SCHEMA_VALID');
  console.log(`PASS: ADMISSION_DECISION_${artifact.decision}`);
  console.log('PASS: RESEARCH_TRADING_BOUNDARY_VALID');
  console.log('PASS: PROVENANCE_HASHES_PRESENT');
  console.log('PASS: RAW_GATES_AND_TERMINAL_REASON_PRESENT');
  console.log('Safety: local artifact verification only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
