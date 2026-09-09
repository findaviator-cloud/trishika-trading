#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FILES = Object.freeze({
  inputAudit: path.join(ROOT, 'data/india-analysis/nifty50-minute-input-audit.json'),
  reconciliation: path.join(ROOT, 'data/india-analysis/nifty50-daily-intraday-reconciliation.json'),
  rawMinuteSource: path.join(ROOT, 'data/india-input/NIFTY 50_minute_data.csv'),
  output: path.join(ROOT, 'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json')
});

const EXPECTED = Object.freeze({
  sourceTier: 'THIRD_PARTY_HISTORICAL_RESEARCH',
  structuralGate: 'PASS',
  referenceGate: 'PASS',
  researchOnly: true,
  executionAllowed: false,
  brokerConnectivityAllowed: false,
  websocketAllowed: false
});

function readJson(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${description}: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${description}: ${error.message}`);
  }
}

function sha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function parseDataEndUtc(inputAudit) {
  const raw = inputAudit?.inspection?.coverage?.lastUtcTimestamp;

  if (!raw) {
    return { valid: false, value: null, reason: 'Input audit does not contain inspection.coverage.lastUtcTimestamp.' };
  }

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    return { valid: false, value: null, reason: `Invalid audited data-end timestamp: ${raw}` };
  }

  return { valid: true, value, reason: null };
}

function parseAsOf(argv) {
  const index = argv.indexOf('--as-of');

  if (index === -1) {
    return new Date();
  }

  const raw = argv[index + 1];

  if (!raw || raw.startsWith('--')) {
    throw new Error('Missing value for --as-of. Use an ISO-8601 timestamp with timezone.');
  }

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid --as-of timestamp: ${raw}`);
  }

  return value;
}

function indiaTime(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function hardBlockReason(gates) {
  const reasons = [];

  if (gates.structuralGate !== 'PASS') {
    reasons.push('structural gate is not PASS');
  }

  if (gates.referenceReconciliationGate !== 'PASS') {
    reasons.push('reference reconciliation gate is not PASS');
  }

  if (gates.freshnessGate !== 'PASS') {
    reasons.push('freshness gate is not PASS');
  }

  if (gates.researchOnlyGate !== 'PASS') {
    reasons.push('research-only policy is not intact');
  }

  if (gates.executionGate !== 'PASS') {
    reasons.push('execution-disabled policy is not intact');
  }

  if (gates.brokerConnectivityGate !== 'PASS') {
    reasons.push('broker-connectivity-disabled policy is not intact');
  }

  if (gates.websocketGate !== 'PASS') {
    reasons.push('websocket-disabled policy is not intact');
  }

  return reasons;
}

try {
  const asOf = parseAsOf(process.argv.slice(2));
  const inputAudit = readJson(FILES.inputAudit, 'minute input audit');
  const reconciliation = readJson(FILES.reconciliation, 'daily-vs-intraday reconciliation');

  const auditedPolicy = inputAudit.policy || {};
  const inspection = inputAudit.inspection || {};
  const dataEnd = parseDataEndUtc(inputAudit);

  const structuralPass =
    inputAudit.researchOnly === true &&
    inputAudit.executionAllowed === false &&
    inputAudit.brokerConnectivityAllowed === false &&
    inputAudit.websocketAllowed === false &&
    auditedPolicy.sourceTier === EXPECTED.sourceTier &&
    inspection.duplicates?.length === 0 &&
    inspection.outOfOrder?.length === 0 &&
    inspection.strictFullSessionDays > 0;

  const reconciliationPass =
    reconciliation.summary?.result === 'PASS' &&
    reconciliation.classification === 'REFERENCE_RECONCILED';

  const freshnessPass =
    dataEnd.valid &&
    dataEnd.value.getTime() >= asOf.getTime();

  const policyPass = {
    researchOnly: inputAudit.researchOnly === EXPECTED.researchOnly,
    executionAllowed: inputAudit.executionAllowed === EXPECTED.executionAllowed,
    brokerConnectivityAllowed: inputAudit.brokerConnectivityAllowed === EXPECTED.brokerConnectivityAllowed,
    websocketAllowed: inputAudit.websocketAllowed === EXPECTED.websocketAllowed
  };

  const gates = {
    structuralGate: structuralPass ? 'PASS' : 'FAIL',
    referenceReconciliationGate: reconciliationPass ? 'PASS' : 'FAIL',
    freshnessGate: freshnessPass ? 'PASS' : 'FAIL',
    researchOnlyGate: policyPass.researchOnly ? 'PASS' : 'FAIL',
    executionGate: policyPass.executionAllowed ? 'PASS' : 'FAIL',
    brokerConnectivityGate: policyPass.brokerConnectivityAllowed ? 'PASS' : 'FAIL',
    websocketGate: policyPass.websocketAllowed ? 'PASS' : 'FAIL'
  };

  const reasons = hardBlockReason(gates);

  const eligibleCurrentIntradayContext =
    gates.structuralGate === 'PASS' &&
    gates.referenceReconciliationGate === 'PASS' &&
    gates.freshnessGate === 'PASS' &&
    gates.researchOnlyGate === 'PASS' &&
    gates.executionGate === 'PASS' &&
    gates.brokerConnectivityGate === 'PASS' &&
    gates.websocketGate === 'PASS';

  const audit = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    asOfUtc: asOf.toISOString(),
    asOfIndia: indiaTime(asOf),
    sourceClassification: {
      source: 'THIRD_PARTY_MINUTE_SOURCE',
      structuralStatus: structuralPass ? 'STRUCTURALLY_VALID' : 'STRUCTURAL_VALIDATION_FAILED',
      referenceStatus: reconciliationPass ? 'REFERENCE_RECONCILED' : 'NOT_REFERENCE_RECONCILED',
      diagnosticStatus: reconciliationPass
        ? 'REFERENCE_RECONCILIATION_PASS'
        : 'UNEXPLAINED_SOURCE_DISCREPANCY_PENDING_REVIEW',
      allowedUse: 'HISTORICAL_RESEARCH_PIPELINE_VALIDATION_ONLY',
      freshness: freshnessPass ? 'ACCEPTABLE_FOR_AS_OF' : 'STALE',
      currentIntradayUse: 'PROHIBITED',
      referenceUse: 'BLOCKED',
      execution: 'DISABLED',
      brokerConnectivity: 'DISABLED',
      websocket: 'DISABLED',
      humanReviewRequired: true
    },
    provenance: {
      minuteInputAudit: path.basename(FILES.inputAudit),
      reconciliationAudit: path.basename(FILES.reconciliation),
      rawMinuteSource: path.basename(FILES.rawMinuteSource),
      rawMinuteSourceSha256: sha256(FILES.rawMinuteSource),
      dataEndUtc: dataEnd.valid ? dataEnd.value.toISOString() : null,
      dataEndIndia: dataEnd.valid ? indiaTime(dataEnd.value) : null,
      dataEndParseIssue: dataEnd.reason
    },
    evidence: {
      auditedSourceTier: auditedPolicy.sourceTier ?? null,
      rawMinuteCandles: inspection.rawCandleCount ?? null,
      duplicateTimestampCount: inspection.duplicates?.length ?? null,
      outOfOrderCount: inspection.outOfOrder?.length ?? null,
      strictFullSessionDays: inspection.strictFullSessionDays ?? null,
      allVolumeZero: inspection.allVolumeZero ?? null,
      reconciliationSummary: reconciliation.summary ?? null,
      reconciliationClassification: reconciliation.classification ?? null
    },
    gates,
    hardRule: {
      expression: [
        'structuralGate === PASS',
        'referenceReconciliationGate === PASS',
        'freshnessGate === PASS',
        'researchOnlyGate === PASS',
        'executionGate === PASS',
        'brokerConnectivityGate === PASS',
        'websocketGate === PASS'
      ].join(' AND '),
      metadataOverridePermitted: false,
      explanation: (
        'A failed reference-reconciliation gate remains a hard block even if future metadata labels ' +
        'claim freshness or otherwise attempt to relabel the source.'
      )
    },
    eligibleCurrentIntradayContext,
    decision: eligibleCurrentIntradayContext ? 'ELIGIBLE_RESEARCH_CONTEXT' : 'BLOCKED',
    reasons
  };

  fs.mkdirSync(path.dirname(FILES.output), { recursive: true });
  fs.writeFileSync(FILES.output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

  console.log('PASS: Intraday eligibility enforcement audit generated.');
  console.log(`As-of IST: ${audit.asOfIndia}`);
  console.log(`Structural gate: ${gates.structuralGate}`);
  console.log(`Reference reconciliation gate: ${gates.referenceReconciliationGate}`);
  console.log(`Freshness gate: ${gates.freshnessGate}`);
  console.log(`Research-only gate: ${gates.researchOnlyGate}`);
  console.log(`Execution-disabled gate: ${gates.executionGate}`);
  console.log(`Broker-connectivity-disabled gate: ${gates.brokerConnectivityGate}`);
  console.log(`WebSocket-disabled gate: ${gates.websocketGate}`);
  console.log(`eligibleCurrentIntradayContext: ${eligibleCurrentIntradayContext}`);
  console.log(`decision: ${audit.decision}`);
  console.log(`reason: ${reasons.join('; ')}`);
  console.log(`Audit JSON: ${FILES.output}`);
  console.log('Safety: local audit only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
