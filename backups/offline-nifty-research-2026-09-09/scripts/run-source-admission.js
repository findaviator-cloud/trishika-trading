#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const profileRelativePath = valueAfter('--profile');
const outputRelativePath = valueAfter('--output');
const policyRelativePath = valueAfter('--policy') ?? 'admission/source-admission-policy.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveProjectPath(relativePath, label) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, `${label} is required.`);
  const resolved = path.resolve(ROOT, relativePath);
  assert(resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`), `${label} escapes project root.`);
  return resolved;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(relativePath, label) {
  const fullPath = resolveProjectPath(relativePath, label);
  assert(fs.existsSync(fullPath), `${label} missing: ${relativePath}`);

  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label} root must be an object.`);
    return { parsed, fullPath, sha256: sha256(fullPath) };
  } catch (error) {
    throw new Error(`${label} invalid: ${error.message}`);
  }
}

function parseCsv(relativePath, label) {
  const fullPath = resolveProjectPath(relativePath, label);
  assert(fs.existsSync(fullPath), `${label} missing: ${relativePath}`);

  const raw = fs.readFileSync(fullPath, 'utf8').trim();
  assert(raw.length > 0, `${label} is empty: ${relativePath}`);

  const lines = raw.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 2, `${label} must contain a header and at least one row.`);

  const header = lines.shift().split(',').map((item) => item.trim());

  assert(
    header.length > 0 && header.every((item) => item.length > 0),
    `${label} has an invalid header.`
  );

  const rows = lines.map((line, index) => {
    const values = line.split(',').map((item) => item.trim());
    assert(values.length === header.length, `${label} row ${index + 2} has unexpected column count.`);
    return Object.fromEntries(header.map((name, position) => [name, values[position]]));
  });

  return {
    fullPath,
    header,
    rows,
    sha256: sha256(fullPath),
    bytes: fs.statSync(fullPath).size
  };
}

function findHeader(headers, acceptedNames, label) {
  const byNormalizedName = new Map(
    headers.map((header) => [header.trim().toLowerCase(), header])
  );

  for (const accepted of acceptedNames) {
    const matched = byNormalizedName.get(accepted.toLowerCase());
    if (matched) return matched;
  }

  throw new Error(`${label} missing. Accepted names: ${acceptedNames.join(', ')}`);
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function dateKey(value) {
  if (typeof value !== 'string' || value.length < 10) return null;

  const isoPrefix = value.slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(isoPrefix) ? isoPrefix : null;
}

function gate(result, details = {}) {
  return { result, ...details };
}

function evaluateDecision(policy, gates) {
  const trace = [];

  for (const gateName of policy.decisionPrecedence) {
    const currentGate = gates[gateName];

    if (!currentGate || currentGate.result === 'PASS') continue;

    let outcome = policy.terminalRules?.[gateName] ?? 'BLOCKED';

    if (gateName === 'referenceReconciliation') {
      outcome = policy.referenceReconciliation?.failureOutcome ?? 'BLOCKED';
    }

    if (gateName === 'freshness') {
      outcome = policy.freshness?.failureOutcome ?? 'BLOCKED';
    }

    trace.push({
      gate: gateName,
      gateResult: currentGate.result,
      outcome,
      reason: currentGate.reason ?? null
    });

    return {
      decision: outcome,
      approvedForResearchSource: false,
      terminalReason: `${gateName.toUpperCase()}_${outcome}`,
      evaluatedInOrder: policy.decisionPrecedence,
      trace
    };
  }

  return {
    decision: 'APPROVED_FOR_RESEARCH_SOURCE',
    approvedForResearchSource: true,
    terminalReason: 'ALL_REQUIRED_GATES_PASS',
    evaluatedInOrder: policy.decisionPrecedence,
    trace
  };
}

try {
  assert(
    profileRelativePath && outputRelativePath,
    'Usage: node scripts/run-source-admission.js --profile <profile.json> --output <artifact.json> [--policy <policy.json>]'
  );

  const { parsed: policy, fullPath: policyPath, sha256: policySha256 } = readJson(
    policyRelativePath,
    'Admission policy'
  );

  const { parsed: profile, fullPath: profilePath, sha256: profileSha256 } = readJson(
    profileRelativePath,
    'Candidate profile'
  );

  assert(policy.schemaVersion === 1, 'Unsupported admission policy schemaVersion.');
  assert(profile.schemaVersion === 1, 'Unsupported candidate profile schemaVersion.');
  assert(policy.researchOnly === true, 'Policy must keep researchOnly=true.');
  assert(policy.approvedForTrading === false, 'Policy must keep approvedForTrading=false.');
  assert(policy.executionBoundary?.brokerConnectivityAllowed === false, 'Policy must keep broker connectivity disabled.');
  assert(policy.executionBoundary?.websocketAllowed === false, 'Policy must keep WebSocket disabled.');
  assert(policy.executionBoundary?.ordersAllowed === false, 'Policy must keep orders disabled.');
  assert(policy.executionBoundary?.executionAllowed === false, 'Policy must keep execution disabled.');

  const candidate = parseCsv(profile.candidatePath, 'Candidate CSV');
  const reference = parseCsv(profile.referencePath, 'Independent reference CSV');

  const gates = {};

  const candidateTimestampHeader = findHeader(
    candidate.header,
    ['timestamp', 'datetime', 'date time', 'date'],
    'Candidate timestamp column'
  );

  const candidateOpenHeader = findHeader(candidate.header, ['open'], 'Candidate open column');
  const candidateHighHeader = findHeader(candidate.header, ['high'], 'Candidate high column');
  const candidateLowHeader = findHeader(candidate.header, ['low'], 'Candidate low column');
  const candidateCloseHeader = findHeader(
    candidate.header,
    ['close', 'closing price', 'closingprice'],
    'Candidate close column'
  );

  const referenceDateHeader = findHeader(
    reference.header,
    ['date', 'timestamp', 'datetime', 'date time'],
    'Independent reference date column'
  );

  const referenceCloseHeader = findHeader(
    reference.header,
    ['close', 'closing price', 'closingprice'],
    'Independent reference close column'
  );

  const missingRequiredColumns = policy.requiredColumns.filter((required) => {
    const accepted = required === 'timestamp'
      ? ['timestamp', 'datetime', 'date time', 'date']
      : required === 'close'
        ? ['close', 'closing price', 'closingprice']
        : [required];

    return !candidate.header.some((header) => accepted.includes(header.trim().toLowerCase()));
  });

  gates.schema = missingRequiredColumns.length === 0
    ? gate('PASS', {
      required: true,
      resolvedColumns: {
        timestamp: candidateTimestampHeader,
        open: candidateOpenHeader,
        high: candidateHighHeader,
        low: candidateLowHeader,
        close: candidateCloseHeader
      }
    })
    : gate('FAIL', {
      required: true,
      missingColumns: missingRequiredColumns,
      reason: 'REQUIRED_COLUMNS_MISSING'
    });

  let duplicateTimestamps = 0;
  let outOfOrder = 0;
  let previousEpoch = null;
  const seenTimestamps = new Set();
  const invalidRows = [];

  for (let index = 0; index < candidate.rows.length; index += 1) {
    const row = candidate.rows[index];
    const timestamp = row[candidateTimestampHeader];
    const epoch = parseTimestamp(timestamp);

    const open = Number(row[candidateOpenHeader]);
    const high = Number(row[candidateHighHeader]);
    const low = Number(row[candidateLowHeader]);
    const close = Number(row[candidateCloseHeader]);

    const numericValid = [open, high, low, close].every(Number.isFinite);
    const ohlcValid = numericValid && high >= Math.max(open, close) && low <= Math.min(open, close);

    if (epoch === null || !ohlcValid) invalidRows.push(index + 2);
    if (seenTimestamps.has(timestamp)) duplicateTimestamps += 1;
    seenTimestamps.add(timestamp);

    if (previousEpoch !== null && epoch !== null && epoch <= previousEpoch) {
      outOfOrder += 1;
    }

    if (epoch !== null) previousEpoch = epoch;
  }

  gates.structural = (
    candidate.rows.length > 0 &&
    invalidRows.length === 0 &&
    duplicateTimestamps === 0 &&
    outOfOrder === 0
  )
    ? gate('PASS', {
      required: true,
      rows: candidate.rows.length,
      invalidRows: [],
      duplicateTimestamps,
      outOfOrder
    })
    : gate('FAIL', {
      required: true,
      rows: candidate.rows.length,
      invalidRows,
      duplicateTimestamps,
      outOfOrder,
      reason: 'STRUCTURAL_VALIDATION_FAILED'
    });

  const timestampValues = candidate.rows.map((row) => row[candidateTimestampHeader]);
  const timestampEpochs = timestampValues.map(parseTimestamp);
  const timestampValid = timestampEpochs.every((epoch) => epoch !== null);

  gates.timestampIntegrity = timestampValid
    ? gate('PASS', {
      required: true,
      earliestTimestamp: timestampValues[0] ?? null,
      latestTimestamp: timestampValues.at(-1) ?? null
    })
    : gate('FAIL', {
      required: true,
      reason: 'UNPARSEABLE_TIMESTAMP'
    });

  const sessionViolations = timestampValues.filter((timestamp) => {
    if (typeof timestamp !== 'string' || timestamp.length < 16) return true;
    const time = timestamp.slice(11, 16);
    return time < policy.session.start || time > policy.session.end;
  });

  gates.session = sessionViolations.length === 0
    ? gate('PASS', {
      required: true,
      timezone: policy.timezone,
      observedRows: candidate.rows.length,
      sessionViolations: []
    })
    : gate('FAIL', {
      required: true,
      timezone: policy.timezone,
      sessionViolations,
      reason: 'SESSION_WINDOW_VIOLATION'
    });

  gates.provenance = candidate.sha256 === profile.expectedSha256
    ? gate('PASS', {
      required: true,
      expectedSha256: profile.expectedSha256,
      actualSha256: candidate.sha256
    })
    : gate('FAIL', {
      required: true,
      expectedSha256: profile.expectedSha256,
      actualSha256: candidate.sha256,
      reason: 'CANDIDATE_SHA256_MISMATCH'
    });

  const referenceByDate = new Map();

  for (const row of reference.rows) {
    const referenceDate = dateKey(row[referenceDateHeader]);
    const referenceClose = Number(row[referenceCloseHeader]);

    if (referenceDate && Number.isFinite(referenceClose)) {
      referenceByDate.set(referenceDate, referenceClose);
    }
  }

  assert(referenceByDate.size > 0, 'Independent reference has no usable date/close rows.');

  const candidateDailyLastClose = new Map();

  for (const row of candidate.rows) {
    const candidateDate = dateKey(row[candidateTimestampHeader]);
    const candidateClose = Number(row[candidateCloseHeader]);

    if (candidateDate && Number.isFinite(candidateClose)) {
      candidateDailyLastClose.set(candidateDate, candidateClose);
    }
  }

  assert(candidateDailyLastClose.size > 0, 'Candidate has no usable timestamp/close rows for reconciliation.');

  const comparisons = [];

  for (const [date, candidateClose] of candidateDailyLastClose) {
    if (!referenceByDate.has(date)) continue;

    const referenceClose = referenceByDate.get(date);
    const absoluteDifference = Math.abs(candidateClose - referenceClose);

    comparisons.push({
      date,
      candidateClose,
      referenceClose,
      absoluteDifference,
      withinTolerance: absoluteDifference <= policy.referenceReconciliation.maximumCloseDifference
    });
  }

  const reconciliationPass = comparisons.filter((item) => item.withinTolerance).length;
  const passRate = comparisons.length === 0 ? 0 : reconciliationPass / comparisons.length;

  const reconciliationPasses = (
    comparisons.length >= policy.referenceReconciliation.minimumOverlapDays &&
    passRate >= policy.referenceReconciliation.minimumPassRate
  );

  gates.referenceReconciliation = reconciliationPasses
    ? gate('PASS', {
      required: true,
      compared: comparisons.length,
      pass: reconciliationPass,
      review: comparisons.length - reconciliationPass,
      passRate,
      maximumCloseDifference: policy.referenceReconciliation.maximumCloseDifference,
      comparisons
    })
    : gate('FAIL', {
      required: true,
      compared: comparisons.length,
      pass: reconciliationPass,
      review: comparisons.length - reconciliationPass,
      passRate,
      minimumOverlapDays: policy.referenceReconciliation.minimumOverlapDays,
      minimumPassRate: policy.referenceReconciliation.minimumPassRate,
      maximumCloseDifference: policy.referenceReconciliation.maximumCloseDifference,
      comparisons,
      reason: 'REFERENCE_RECONCILIATION_FAILED'
    });

  const latestTimestamp = timestampValues.at(-1) ?? null;
  const latestEpoch = parseTimestamp(latestTimestamp);
  const evaluationEpoch = parseTimestamp(profile.evaluationAsOf);

  assert(evaluationEpoch !== null, 'Candidate profile evaluationAsOf is invalid.');

  const ageHours = latestEpoch === null ? null : (evaluationEpoch - latestEpoch) / (1000 * 60 * 60);
  const fresh = ageHours !== null && ageHours >= 0 && ageHours <= policy.freshness.maximumAgeHours;

  gates.freshness = fresh
    ? gate('PASS', {
      required: true,
      classification: 'FRESH',
      evaluationAsOf: profile.evaluationAsOf,
      latestTimestamp,
      ageHours,
      maximumAgeHours: policy.freshness.maximumAgeHours
    })
    : gate('FAIL', {
      required: true,
      classification: 'STALE',
      evaluationAsOf: profile.evaluationAsOf,
      latestTimestamp,
      ageHours,
      maximumAgeHours: policy.freshness.maximumAgeHours,
      reason: 'FRESHNESS_GATE_FAILED'
    });

  gates.artifactIntegrity = gate('PASS', {
    required: true,
    policyPresent: true,
    profilePresent: true,
    candidatePresent: true,
    referencePresent: true
  });

  const finalDecision = evaluateDecision(policy, gates);

  const artifact = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    admissionId: profile.profileId,
    decision: finalDecision.decision,
    approvedForResearchSource: finalDecision.approvedForResearchSource,
    approvedForTrading: false,
    decisionPrecedence: {
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      evaluatedInOrder: finalDecision.evaluatedInOrder,
      terminalReason: finalDecision.terminalReason,
      trace: finalDecision.trace
    },
    gates,
    provenance: {
      candidate: {
        path: profile.candidatePath,
        filename: path.basename(candidate.fullPath),
        bytes: candidate.bytes,
        sha256: candidate.sha256
      },
      candidateProfile: {
        path: profileRelativePath,
        filename: path.basename(profilePath),
        sha256: profileSha256
      },
      policy: {
        path: policyRelativePath,
        filename: path.basename(policyPath),
        sha256: policySha256
      },
      independentReference: {
        path: profile.referencePath,
        filename: path.basename(reference.fullPath),
        bytes: reference.bytes,
        sha256: reference.sha256
      }
    },
    executionBoundary: {
      researchOnly: true,
      approvedForTrading: false,
      brokerConnectivityAllowed: false,
      websocketAllowed: false,
      ordersAllowed: false,
      executionAllowed: false,
      humanReviewRequired: true
    },
    notes: profile.notes ?? null
  };

  const outputPath = resolveProjectPath(outputRelativePath, 'Output artifact');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`SOURCE ADMISSION: ${artifact.decision}`);
  console.log(`Profile: ${artifact.admissionId}`);
  console.log(`Approved for research source: ${artifact.approvedForResearchSource}`);
  console.log(`Approved for trading: ${artifact.approvedForTrading}`);
  console.log(`Terminal reason: ${artifact.decisionPrecedence.terminalReason}`);
  console.log(`Artifact: ${outputPath}`);
  console.log('Safety: offline local CSV admission only; no broker, WebSocket, authentication, market request, order, portfolio, execution, or automatic action was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
