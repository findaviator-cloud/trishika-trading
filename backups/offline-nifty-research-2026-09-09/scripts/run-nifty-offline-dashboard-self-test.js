#!/usr/bin/env node
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = 18787;
const baseUrl = `http://${host}:${port}`;
const endpoints = [
  '/api/health',
  '/api/status',
  '/api/manifest',
  '/api/daily',
  '/api/intraday',
  '/api/governance',
  '/api/admission'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(timeoutMs = 8000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });

      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('Dashboard server did not become healthy before timeout.');
}

let child;

try {
  child = spawn(process.execPath, ['dashboard/server.js'], {
    cwd: process.cwd(),
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

  await waitForServer();

  for (const endpoint of endpoints) {
    const response = await fetch(`${baseUrl}${endpoint}`, { cache: 'no-store' });
    const payload = await response.json();

    assert(response.status === 200, `${endpoint} returned HTTP ${response.status}`);
    assert(response.headers.get('cache-control')?.includes('no-store'), `${endpoint} lacks no-store cache policy`);
    assert(typeof payload === 'object' && payload !== null, `${endpoint} did not return JSON object`);
  }

  const [statusResponse, intradayResponse, governanceResponse] = await Promise.all([
    fetch(`${baseUrl}/api/status`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/intraday`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/governance`, { cache: 'no-store' })
  ]);

  const status = await statusResponse.json();
  const intraday = await intradayResponse.json();
  const governance = await governanceResponse.json();

  assert(status.overall?.status === 'PASS_WITH_INTRADAY_HARD_BLOCK', 'Status API changed overall hard-block state.');
  assert(intraday.eligibleCurrentIntradayContext === false, 'Intraday API changed current eligibility.');
  assert(intraday.decision === 'BLOCKED', 'Intraday API changed BLOCKED decision.');
  assert(intraday.referenceGate === 'FAIL', 'Intraday API changed reference gate.');
  assert(intraday.freshnessGate === 'FAIL', 'Intraday API changed freshness gate.');
  assert(governance.policy?.dashboardEligibilityRecomputation === false, 'Dashboard must not independently recompute eligibility.');
  assert(governance.policy?.executionAllowed === false, 'Dashboard governance incorrectly allows execution.');
  assert(governance.policy?.brokerConnectivityAllowed === false, 'Dashboard governance incorrectly allows broker connectivity.');
  assert(governance.policy?.websocketAllowed === false, 'Dashboard governance incorrectly allows WebSocket.');

  const unsupported = await fetch(`${baseUrl}/api/unknown`, { cache: 'no-store' });
  assert(unsupported.status === 404, 'Unknown API endpoint must return 404.');

  console.log('PASS: LOCAL_DASHBOARD_HEALTH_ENDPOINT');
  console.log(`PASS: API_ENDPOINTS_OK (${endpoints.length}/${endpoints.length})`);
  console.log('PASS: NO_STORE_CACHE_POLICY');
  console.log('PASS: EXISTING_HARD_BLOCK_EXPOSED_UNCHANGED');
  console.log('PASS: DASHBOARD_DOES_NOT_RECOMPUTE_ELIGIBILITY');
  console.log('PASS: EXECUTION_BROKER_WEBSOCKET_DISABLED_IN_API');
  console.log('PASS: UNSUPPORTED_ENDPOINT_FAILS_CLOSED');
  console.log('Safety: self-test bound only to 127.0.0.1; no external network, market API, broker, WebSocket, authentication, order, portfolio, or execution call was used.');
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
