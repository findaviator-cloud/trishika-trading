#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const host = '127.0.0.1';
const port = 18788;
const baseUrl = `http://${host}:${port}`;
const artifactPath = `${ROOT}/data/india-analysis/nifty-minute-source-admission.json`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fidelityProjection(value) {
  return {
    decision: value.decision,
    approvedForResearchSource: value.approvedForResearchSource,
    approvedForTrading: value.approvedForTrading,
    decisionPrecedence: {
      terminalReason: value.decisionPrecedence?.terminalReason
    },
    gates: value.gates,
    executionBoundary: value.executionBoundary,
    provenance: value.provenance
  };
}

async function waitForHealthyServer(timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (response.status === 200) return;
    } catch {
      // Continue until local server becomes available.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('Dashboard server did not become healthy before timeout.');
}

let child;

try {
  assert(fs.existsSync(artifactPath), 'Serialized admission artifact is missing.');

  const serializedText = fs.readFileSync(artifactPath, 'utf8');
  const serializedArtifact = JSON.parse(serializedText);
  const serializedProjection = fidelityProjection(serializedArtifact);

  child = spawn(process.execPath, ['dashboard/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NIFTY_DASHBOARD_HOST: host,
      NIFTY_DASHBOARD_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  await waitForHealthyServer();

  const response = await fetch(`${baseUrl}/api/admission`, { cache: 'no-store' });
  assert(response.status === 200, `/api/admission returned HTTP ${response.status}`);
  assert(response.headers.get('cache-control')?.includes('no-store'), '/api/admission lacks no-store cache policy.');

  const apiArtifact = await response.json();
  const apiProjection = fidelityProjection(apiArtifact);

  assert(
    JSON.stringify(apiProjection) === JSON.stringify(serializedProjection),
    'API admission payload differs from serialized admission artifact projection.'
  );

  const pageResponse = await fetch(`${baseUrl}/`, { cache: 'no-store' });
  assert(pageResponse.status === 200, `Dashboard HTML returned HTTP ${pageResponse.status}`);
  const html = await pageResponse.text();

  const appResponse = await fetch(`${baseUrl}/app.js`, { cache: 'no-store' });
  assert(appResponse.status === 200, `Dashboard app.js returned HTTP ${appResponse.status}`);
  const appJs = await appResponse.text();

  const renderRequiredTokens = [
    "getJson('/api/admission')",
    "setState('admission-decision', admission.decision)",
    "setState('admission-terminal-reason', admission.decisionPrecedence?.terminalReason)",
    "setState('admission-research-approved', admission.approvedForResearchSource)",
    "setState('admission-trading-approved', admission.approvedForTrading)",
    "Object.entries(admission.gates ?? {})",
    "Object.entries(admission.executionBoundary ?? {})",
    "admission.provenance?.candidate?.sha256"
  ];

  for (const token of renderRequiredTokens) {
    assert(appJs.includes(token), `Dashboard rendering contract token missing: ${token}`);
  }

  const htmlRequiredTokens = [
    'id="admission-decision"',
    'id="admission-terminal-reason"',
    'id="admission-research-approved"',
    'id="admission-trading-approved"',
    'id="admission-gates"',
    'id="admission-boundary"',
    'id="admission-provenance"'
  ];

  for (const token of htmlRequiredTokens) {
    assert(html.includes(token), `Dashboard admission render target missing: ${token}`);
  }

  assert(serializedArtifact.decision === 'BLOCKED', 'Frozen admission artifact decision must remain BLOCKED.');
  assert(serializedArtifact.decisionPrecedence?.terminalReason === 'SESSION_BLOCKED', 'Frozen admission artifact terminal reason must remain SESSION_BLOCKED.');
  assert(serializedArtifact.approvedForResearchSource === false, 'Frozen admission artifact must remain research-blocked.');
  assert(serializedArtifact.approvedForTrading === false, 'Trading approval must remain false.');
  assert(serializedArtifact.executionBoundary?.researchOnly === true, 'Research-only boundary must remain true.');
  assert(serializedArtifact.executionBoundary?.brokerConnectivityAllowed === false, 'Broker boundary must remain disabled.');
  assert(serializedArtifact.executionBoundary?.websocketAllowed === false, 'WebSocket boundary must remain disabled.');
  assert(serializedArtifact.executionBoundary?.ordersAllowed === false, 'Orders boundary must remain disabled.');
  assert(serializedArtifact.executionBoundary?.executionAllowed === false, 'Execution boundary must remain disabled.');

  const apiPayloadHash = sha256(JSON.stringify(apiProjection));
  const artifactProjectionHash = sha256(JSON.stringify(serializedProjection));

  assert(apiPayloadHash === artifactProjectionHash, 'Serialized artifact/API projection hashes differ.');

  console.log('PASS: SERIALIZED_ADMISSION_ARTIFACT_PRESENT');
  console.log('PASS: DASHBOARD_ADMISSION_ROUTE_OK');
  console.log('PASS: DASHBOARD_ADMISSION_NO_STORE');
  console.log('PASS: ARTIFACT_TO_API_FIDELITY');
  console.log('PASS: API_PROJECTION_HASH_MATCH');
  console.log('PASS: DASHBOARD_RENDER_TARGETS_PRESENT');
  console.log('PASS: DASHBOARD_RENDER_ONLY_ARTIFACT_CONSUMPTION');
  console.log('PASS: FROZEN_NIFTY_BLOCKED_SESSION_BLOCKED_PRESERVED');
  console.log('PASS: RESEARCH_ONLY_TRADING_BOUNDARY_PRESERVED');
  console.log('PASS: END_TO_END_ADMISSION_ARTIFACT_FIDELITY');
  console.log('Safety: self-test is bound only to 127.0.0.1 and reads local artifacts only; no market API, broker, WebSocket, authentication, order, portfolio, execution, or automatic action was used.');
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
