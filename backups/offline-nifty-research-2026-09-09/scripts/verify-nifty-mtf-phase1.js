#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data/india-analysis/mtf');
const DAILY = path.join(OUT_DIR, 'NIFTY_1d.json');
const SUMMARY = path.join(OUT_DIR, 'NIFTY_summary.json');
const MANIFEST = path.join(OUT_DIR, '_manifest.json');
const FORBIDDEN_CURRENT = [
  path.join(OUT_DIR, 'NIFTY_1h.json'),
  path.join(OUT_DIR, 'NIFTY_4h.json')
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

try {
  for (const filePath of FORBIDDEN_CURRENT) {
    assert(!fs.existsSync(filePath), `Current intraday snapshot must not exist while admission is blocked: ${filePath}`);
  }

  const daily = readJson(DAILY, 'NIFTY 1D snapshot');
  const summary = readJson(SUMMARY, 'NIFTY summary');
  const manifest = readJson(MANIFEST, 'NIFTY MTF manifest');

  assert(daily.schemaVersion === 1, 'Invalid daily snapshot schemaVersion.');
  assert(daily.timeframe === '1d', 'Daily snapshot timeframe must be 1d.');
  assert(daily.status === 'AVAILABLE_OFFICIAL_DAILY_REFERENCE', 'Daily snapshot must use official daily reference status.');
  assert(daily.source?.classification === 'OFFICIAL_DAILY_REFERENCE', 'Daily snapshot source classification must be official daily reference.');
  assert(daily.researchOnly === true, 'Daily snapshot researchOnly must be true.');
  assert(daily.approvedForTrading === false, 'Daily snapshot trading approval must be false.');
  assert(daily.executionAllowed === false, 'Daily snapshot execution must be false.');

  assert(summary.status === 'PARTIAL_OFFLINE_DAILY_REFERENCE_ONLY', 'Summary must be partial offline daily reference only.');
  assert(summary.timeframes?.['1h']?.status === 'BLOCKED', '1H must remain BLOCKED.');
  assert(summary.timeframes?.['4h']?.status === 'BLOCKED', '4H must remain BLOCKED.');
  assert(summary.timeframes?.['1h']?.currentSnapshotGenerated === false, '1H current snapshot must not be generated.');
  assert(summary.timeframes?.['4h']?.currentSnapshotGenerated === false, '4H current snapshot must not be generated.');
  assert(summary.timeframes?.['1d']?.status === 'AVAILABLE_OFFICIAL_DAILY_REFERENCE', '1D must remain available.');
  assert(summary.admission?.decision === 'BLOCKED', 'Canonical admission decision must remain BLOCKED.');
  assert(summary.admission?.terminalReason === 'SESSION_BLOCKED', 'Canonical admission terminal reason must remain SESSION_BLOCKED.');
  assert(summary.admission?.approvedForResearchSource === false, 'Current intraday research admission must remain false.');
  assert(summary.admission?.approvedForTrading === false, 'Trading approval must remain false.');

  const boundary = summary.admission?.executionBoundary;
  assert(boundary?.researchOnly === true, 'Research-only boundary missing.');
  assert(boundary?.brokerConnectivityAllowed === false, 'Broker boundary changed.');
  assert(boundary?.websocketAllowed === false, 'WebSocket boundary changed.');
  assert(boundary?.ordersAllowed === false, 'Orders boundary changed.');
  assert(boundary?.executionAllowed === false, 'Execution boundary changed.');

  assert(manifest.mode === 'OFFLINE_NIFTY_MTF_PHASE_1', 'Unexpected manifest mode.');
  assert(manifest.files?.NIFTY_1h?.exists === false, 'Manifest incorrectly declares 1H snapshot available.');
  assert(manifest.files?.NIFTY_4h?.exists === false, 'Manifest incorrectly declares 4H snapshot available.');
  assert(manifest.admissionDependency?.decision === summary.admission.decision, 'Manifest admission decision differs from summary.');
  assert(manifest.admissionDependency?.terminalReason === summary.admission.terminalReason, 'Manifest terminal reason differs from summary.');
  assert(manifest.files?.NIFTY_1d?.sha256 === sha256(DAILY), '1D snapshot hash mismatch.');
  assert(manifest.files?.summary?.sha256 === sha256(SUMMARY), 'Summary snapshot hash mismatch.');

  console.log('PASS: OFFICIAL_NIFTY_1D_REFERENCE_GENERATED');
  console.log('PASS: NIFTY_1H_CURRENT_SNAPSHOT_ABSENT');
  console.log('PASS: NIFTY_4H_CURRENT_SNAPSHOT_ABSENT');
  console.log('PASS: SUMMARY_EXPLICITLY_BLOCKS_1H_AND_4H');
  console.log('PASS: CANONICAL_ADMISSION_BLOCKED_SESSION_BLOCKED_PRESERVED');
  console.log('PASS: ADMISSION_ARTIFACT_CONSUMED_NOT_RECOMPUTED');
  console.log('PASS: PHASE1_RESEARCH_ONLY_BOUNDARY_PRESERVED');
  console.log('PASS: ATOMIC_OUTPUT_MANIFEST_HASHES_VALID');
  console.log('Safety: local Phase 1 artifact verification only; no market API, broker, WebSocket, authentication, order, portfolio, execution, or automatic action was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
