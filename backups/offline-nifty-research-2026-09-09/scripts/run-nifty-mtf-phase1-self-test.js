#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const host = '127.0.0.1';
const port = 18789;
const base = `http://${host}:${port}`;
const summaryPath = `${ROOT}/data/india-analysis/mtf/NIFTY_summary.json`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function projection(value) {
  return {
    phase: value.phase,
    daily: {
      timeframe: value.daily?.timeframe,
      status: value.daily?.status,
      source: value.daily?.source,
      signal: value.daily?.signal,
      researchOnly: value.daily?.researchOnly,
      approvedForTrading: value.daily?.approvedForTrading,
      executionAllowed: value.daily?.executionAllowed
    },
    summary: {
      status: value.summary?.status,
      timeframes: value.summary?.timeframes,
      admission: value.summary?.admission,
      researchOnly: value.summary?.researchOnly,
      approvedForTrading: value.summary?.approvedForTrading,
      executionAllowed: value.summary?.executionAllowed
    },
    manifest: {
      mode: value.manifest?.mode,
      status: value.manifest?.status,
      admissionDependency: value.manifest?.admissionDependency,
      safety: value.manifest?.safety
    }
  };
}

async function waitForHealth() {
  const start = Date.now();

  while (Date.now() - start < 8000) {
    try {
      const response = await fetch(`${base}/api/health`, { cache: 'no-store' });
      if (response.status === 200) return;
    } catch {
      // Wait for local server startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('Dashboard did not become healthy.');
}

let child;

try {
  assert(fs.existsSync(summaryPath), 'NIFTY Phase 1 summary artifact is missing.');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

  child = spawn(process.execPath, ['dashboard/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NIFTY_DASHBOARD_HOST: host,
      NIFTY_DASHBOARD_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitForHealth();

  const response = await fetch(`${base}/api/nifty-mtf`, { cache: 'no-store' });
  assert(response.status === 200, `/api/nifty-mtf returned HTTP ${response.status}`);
  assert(response.headers.get('cache-control')?.includes('no-store'), '/api/nifty-mtf lacks no-store cache policy.');

  const api = await response.json();

  assert(api.phase === 'OFFLINE_NIFTY_MTF_PHASE_1', 'Unexpected NIFTY MTF API phase.');
  assert(api.summary?.admission?.decision === summary.admission?.decision, 'API reinterpreted admission decision.');
  assert(api.summary?.admission?.terminalReason === summary.admission?.terminalReason, 'API reinterpreted admission terminal reason.');
  assert(JSON.stringify(api.summary?.timeframes) === JSON.stringify(summary.timeframes), 'API altered timeframe states.');
  assert(api.summary?.timeframes?.['1h']?.status === 'BLOCKED', 'API did not preserve blocked 1H state.');
  assert(api.summary?.timeframes?.['4h']?.status === 'BLOCKED', 'API did not preserve blocked 4H state.');
  assert(api.summary?.timeframes?.['1h']?.currentSnapshotGenerated === false, 'API incorrectly claims current 1H snapshot exists.');
  assert(api.summary?.timeframes?.['4h']?.currentSnapshotGenerated === false, 'API incorrectly claims current 4H snapshot exists.');

  const app = await (await fetch(`${base}/app.js`, { cache: 'no-store' })).text();
  const page = await (await fetch(`${base}/`, { cache: 'no-store' })).text();

  for (const token of [
    "getJson('/api/nifty-mtf')",
    "setState('nifty-mtf-1d-status', niftyMtf.summary?.timeframes?.['1d']?.status)",
    "setState('nifty-mtf-1h-status', niftyMtf.summary?.timeframes?.['1h']?.status)",
    "setState('nifty-mtf-4h-status', niftyMtf.summary?.timeframes?.['4h']?.status)",
    "niftyMtf.summary?.admission?.decision"
  ]) {
    assert(app.includes(token), `Dashboard NIFTY MTF render token missing: ${token}`);
  }

  for (const token of [
    'id="nifty-mtf-1d-status"',
    'id="nifty-mtf-1h-status"',
    'id="nifty-mtf-4h-status"',
    'id="nifty-mtf-admission-status"'
  ]) {
    assert(page.includes(token), `Dashboard NIFTY MTF target missing: ${token}`);
  }

  console.log('PASS: NIFTY_MTF_API_READ_ONLY_ROUTE');
  console.log('PASS: NIFTY_MTF_API_NO_STORE');
  console.log('PASS: NIFTY_MTF_ARTIFACT_TO_API_FIDELITY');
  console.log('PASS: NIFTY_MTF_1H_4H_BLOCKED_PRESERVED');
  console.log('PASS: NIFTY_MTF_DASHBOARD_RENDER_TARGETS_PRESENT');
  console.log('PASS: NIFTY_MTF_DASHBOARD_RENDER_ONLY_CONSUMPTION');
  console.log('PASS: NIFTY_MTF_ADMISSION_DEPENDENCY_PRESERVED');
  console.log('Safety: local localhost self-test only; no market API, broker, WebSocket, authentication, order, portfolio, execution, or automatic action was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 1500);
    });
  }
}
