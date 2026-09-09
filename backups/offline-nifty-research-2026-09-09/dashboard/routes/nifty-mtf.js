import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'data/india-analysis/mtf');

function readJson(filename) {
  const filePath = path.join(BASE, filename);

  if (!fs.existsSync(filePath)) {
    const error = new Error(`Required NIFTY MTF artifact missing: ${filename}`);
    error.code = 'NIFTY_MTF_ARTIFACT_MISSING';
    throw error;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const error = new Error(`Required NIFTY MTF artifact invalid: ${filename}: ${cause.message}`);
    error.code = 'NIFTY_MTF_ARTIFACT_INVALID';
    throw error;
  }
}

export function niftyMtfRoute() {
  const daily = readJson('NIFTY_1d.json');
  const summary = readJson('NIFTY_summary.json');
  const manifest = readJson('_manifest.json');

  if (
    summary.admission?.decision !== 'BLOCKED' ||
    summary.admission?.terminalReason !== 'SESSION_BLOCKED' ||
    summary.timeframes?.['1h']?.status !== 'BLOCKED' ||
    summary.timeframes?.['4h']?.status !== 'BLOCKED'
  ) {
    const error = new Error('NIFTY MTF Phase 1 artifact consistency check failed.');
    error.code = 'NIFTY_MTF_ARTIFACT_INTEGRITY_BLOCKED';
    throw error;
  }

  return {
    phase: 'OFFLINE_NIFTY_MTF_PHASE_1',
    daily,
    summary,
    manifest
  };
}
