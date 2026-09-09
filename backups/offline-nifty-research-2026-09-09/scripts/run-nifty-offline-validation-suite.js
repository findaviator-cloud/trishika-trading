#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();

const steps = [
  ['Daily reference regression', 'scripts/verify-nifty-daily-reference-snapshots.js'],
  ['Intraday governance regression', 'scripts/verify-nifty-data-governance.js'],
  ['Intraday fixture regression', 'scripts/verify-nifty-intraday-fixture-snapshots.js'],
  ['Offline manifest export', 'scripts/export-nifty-research-manifest.js'],
  ['Offline status generation', 'scripts/show-nifty-research-status.js']
];

let failed = false;

for (const [label, relativeScript] of steps) {
  console.log('');
  console.log('='.repeat(80));
  console.log(`STEP: ${label}`);
  console.log('='.repeat(80));

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, relativeScript)],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`SUITE STEP FAILED: ${label}`);
    break;
  }

  console.log(`SUITE STEP PASS: ${label}`);
}

console.log('');
console.log('='.repeat(80));

if (failed) {
  console.log('OFFLINE NIFTY VALIDATION SUITE: FAIL');
  console.log('No policy or market-data source was modified by this validation suite.');
  process.exitCode = 1;
} else {
  console.log('OFFLINE NIFTY VALIDATION SUITE: PASS');
  console.log('Daily reference regression: PASS');
  console.log('Intraday fixture governance: PASS');
  console.log('Intraday fixture regression: PASS');
  console.log('Current intraday eligibility remains determined by the hard-gate audit.');
  console.log('Safety: offline validation only; no broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
}
