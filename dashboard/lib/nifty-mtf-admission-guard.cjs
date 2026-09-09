'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DECISION_APPROVED = 'APPROVED_FOR_RESEARCH_SOURCE';
const DECISION_BLOCKED = 'BLOCKED';
const DECISION_REVIEW = 'REVIEW';

const STATUS_READY = 'READY_FOR_RESEARCH_REFRESH';
const STATUS_BLOCKED = 'REFRESH_BLOCKED';

function blocked(reason) {
  return {
    httpStatus: 409,
    body: {
      status: STATUS_BLOCKED,
      approvedForResearchSource: false,
      approvedForTrading: false,
      readinessOnly: true,
      reason
    }
  };
}

function ready() {
  return {
    httpStatus: 200,
    body: {
      status: STATUS_READY,
      approvedForResearchSource: true,
      approvedForTrading: false,
      readinessOnly: true
    }
  };
}

function validateAdmissionArtifact(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {
      ok: false,
      reason: 'ADMISSION_ARTIFACT_INVALID'
    };
  }

  const {
    decision,
    approvedForResearchSource,
    approvedForTrading
  } = value;

  if (typeof decision !== 'string') {
    return {
      ok: false,
      reason: 'ADMISSION_DECISION_INVALID'
    };
  }

  if (typeof approvedForResearchSource !== 'boolean') {
    return {
      ok: false,
      reason: 'RESEARCH_APPROVAL_FLAG_INVALID'
    };
  }

  if (approvedForTrading !== false) {
    return {
      ok: false,
      reason: 'TRADING_APPROVAL_INVARIANT_VIOLATION'
    };
  }

  if (
    decision === DECISION_APPROVED &&
    approvedForResearchSource === true
  ) {
    return {
      ok: true,
      decision
    };
  }

  if (
    (decision === DECISION_BLOCKED ||
      decision === DECISION_REVIEW) &&
    approvedForResearchSource === false
  ) {
    return {
      ok: true,
      decision
    };
  }

  return {
    ok: false,
    reason: 'ADMISSION_ARTIFACT_INCONSISTENT'
  };
}

function resolveReadiness({ artifactPath }) {
  if (
    typeof artifactPath !== 'string' ||
    artifactPath.trim().length === 0
  ) {
    return blocked('ADMISSION_ARTIFACT_PATH_INVALID');
  }

  let raw;

  try {
    raw = fs.readFileSync(
      path.resolve(artifactPath),
      'utf8'
    );
  } catch {
    return blocked('ADMISSION_ARTIFACT_MISSING');
  }

  let artifact;

  try {
    artifact = JSON.parse(raw);
  } catch {
    return blocked('ADMISSION_ARTIFACT_MALFORMED');
  }

  const validation = validateAdmissionArtifact(artifact);

  if (!validation.ok) {
    return blocked(validation.reason);
  }

  if (validation.decision === DECISION_APPROVED) {
    return ready();
  }

  return blocked(`ADMISSION_${validation.decision}`);
}

module.exports = {
  DECISION_APPROVED,
  DECISION_BLOCKED,
  DECISION_REVIEW,
  STATUS_READY,
  STATUS_BLOCKED,
  validateAdmissionArtifact,
  resolveReadiness
};
