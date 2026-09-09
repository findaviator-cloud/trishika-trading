import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

export const ARTIFACT_PATHS = Object.freeze({
  manifest: path.join(ROOT, 'data/india-analysis/nifty-offline-suite-manifest.json'),
  status: path.join(ROOT, 'data/india-analysis/nifty-research-status.json'),
  dailySnapshots: path.join(ROOT, 'data/india-analysis/nifty-daily-reference-snapshots.json'),
  dailyRegression: path.join(ROOT, 'data/india-analysis/nifty-daily-reference-regression-audit.json'),
  minuteAudit: path.join(ROOT, 'data/india-analysis/nifty50-minute-input-audit.json'),
  reconciliation: path.join(ROOT, 'data/india-analysis/nifty50-daily-intraday-reconciliation.json'),
  eligibility: path.join(ROOT, 'data/india-analysis/nifty50-intraday-eligibility-policy-audit.json'),
  governanceRegression: path.join(ROOT, 'data/india-analysis/nifty-data-governance-regression-audit.json'),
  intradaySnapshots: path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-snapshots.json'),
  intradayRegression: path.join(ROOT, 'data/india-analysis/nifty-intraday-fixture-regression-audit.json'),
  admission: path.join(ROOT, 'data/india-analysis/nifty-minute-source-admission.json')
});

export class ArtifactIntegrityError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ArtifactIntegrityError';
    this.details = details;
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(name) {
  const filePath = ARTIFACT_PATHS[name];

  if (!filePath || !fs.existsSync(filePath)) {
    throw new ArtifactIntegrityError(`Required artifact is missing: ${name}`, [name]);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON root must be an object');
    }

    return parsed;
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;

    throw new ArtifactIntegrityError(
      `Required artifact is invalid: ${name}: ${error.message}`,
      [name]
    );
  }
}

function requireValue(condition, name, details) {
  if (!condition) {
    throw new ArtifactIntegrityError(`Artifact consistency check failed: ${name}`, details);
  }
}

function safeString(value, fallback = null) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function loadArtifacts() {
  const artifacts = {};

  for (const name of Object.keys(ARTIFACT_PATHS)) {
    artifacts[name] = readJson(name);
  }

  const { manifest, status, eligibility, reconciliation, admission } = artifacts;
  const manifestMinute = manifest.thirdPartyMinuteFixture;
  const statusMinute = status.intradayFixture;

  requireValue(manifest.schemaVersion === 1, 'manifest.schemaVersion', ['manifest']);
  requireValue(status.schemaVersion === 1, 'status.schemaVersion', ['status']);

  requireValue(manifest.safety?.researchOnly === true, 'manifest.safety.researchOnly', ['manifest']);
  requireValue(manifest.safety?.executionAllowed === false, 'manifest.safety.executionAllowed', ['manifest']);
  requireValue(manifest.safety?.brokerConnectivityAllowed === false, 'manifest.safety.brokerConnectivityAllowed', ['manifest']);
  requireValue(manifest.safety?.websocketAllowed === false, 'manifest.safety.websocketAllowed', ['manifest']);

  requireValue(manifest.officialDailyReference?.regression === 'PASS', 'manifest.officialDailyReference.regression', ['manifest']);
  requireValue(manifestMinute?.regression === 'PASS', 'manifest.thirdPartyMinuteFixture.regression', ['manifest']);
  requireValue(manifestMinute?.referenceGate === 'FAIL', 'manifest.thirdPartyMinuteFixture.referenceGate', ['manifest']);
  requireValue(manifestMinute?.freshnessGate === 'FAIL', 'manifest.thirdPartyMinuteFixture.freshnessGate', ['manifest']);
  requireValue(manifestMinute?.eligibleCurrentIntradayContext === false, 'manifest.thirdPartyMinuteFixture.eligibleCurrentIntradayContext', ['manifest']);

  requireValue(status.overall?.status === 'PASS_WITH_INTRADAY_HARD_BLOCK', 'status.overall.status', ['status']);
  requireValue(statusMinute?.decision === 'BLOCKED', 'status.intradayFixture.decision', ['status']);
  requireValue(statusMinute?.eligibleCurrentIntradayContext === false, 'status.intradayFixture.eligibleCurrentIntradayContext', ['status']);

  requireValue(eligibility.eligibleCurrentIntradayContext === false, 'eligibility.eligibleCurrentIntradayContext', ['eligibility']);
  requireValue(safeString(eligibility.decision) === 'BLOCKED', 'eligibility.decision', ['eligibility']);
  requireValue(safeString(reconciliation.summary?.result) === 'REVIEW', 'reconciliation.summary.result', ['reconciliation']);

  requireValue(manifestMinute.referenceGate === statusMinute.referenceGate, 'referenceGate cross-artifact agreement', ['manifest', 'status']);
  requireValue(manifestMinute.freshnessGate === statusMinute.freshnessGate, 'freshnessGate cross-artifact agreement', ['manifest', 'status']);
  requireValue(manifestMinute.eligibleCurrentIntradayContext === statusMinute.eligibleCurrentIntradayContext, 'eligibility cross-artifact agreement', ['manifest', 'status']);

  requireValue(admission.schemaVersion === 1, 'admission.schemaVersion', ['admission']);
  requireValue(admission.decision === 'BLOCKED', 'admission.decision', ['admission']);
  requireValue(admission.approvedForResearchSource === false, 'admission.approvedForResearchSource', ['admission']);
  requireValue(admission.approvedForTrading === false, 'admission.approvedForTrading', ['admission']);
  requireValue(admission.decisionPrecedence?.terminalReason === 'SESSION_BLOCKED', 'admission.decisionPrecedence.terminalReason', ['admission']);
  requireValue(admission.gates && typeof admission.gates === 'object', 'admission.gates', ['admission']);
  requireValue(admission.provenance && typeof admission.provenance === 'object', 'admission.provenance', ['admission']);

  requireValue(admission.executionBoundary?.researchOnly === true, 'admission.executionBoundary.researchOnly', ['admission']);
  requireValue(admission.executionBoundary?.brokerConnectivityAllowed === false, 'admission.executionBoundary.brokerConnectivityAllowed', ['admission']);
  requireValue(admission.executionBoundary?.websocketAllowed === false, 'admission.executionBoundary.websocketAllowed', ['admission']);
  requireValue(admission.executionBoundary?.ordersAllowed === false, 'admission.executionBoundary.ordersAllowed', ['admission']);
  requireValue(admission.executionBoundary?.executionAllowed === false, 'admission.executionBoundary.executionAllowed', ['admission']);

  return artifacts;
}

export function artifactInventory() {
  return Object.entries(ARTIFACT_PATHS).map(([name, filePath]) => {
    if (!fs.existsSync(filePath)) {
      return { name, filename: path.basename(filePath), present: false, bytes: null, sha256: null };
    }

    return {
      name,
      filename: path.basename(filePath),
      present: true,
      bytes: fs.statSync(filePath).size,
      sha256: sha256(filePath)
    };
  });
}

export function integrityReport() {
  try {
    const artifacts = loadArtifacts();

    return {
      ok: true,
      checkedAtUtc: new Date().toISOString(),
      artifacts,
      inventory: artifactInventory()
    };
  } catch (error) {
    return {
      ok: false,
      checkedAtUtc: new Date().toISOString(),
      error: error.message,
      details: error.details ?? [],
      inventory: artifactInventory()
    };
  }
}
