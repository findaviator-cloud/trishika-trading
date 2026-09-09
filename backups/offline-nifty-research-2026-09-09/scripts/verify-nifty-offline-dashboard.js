#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const requiredFiles = [
  'dashboard/server.js',
  'dashboard/routes/artifact-store.js',
  'dashboard/routes/status.js',
  'dashboard/routes/manifest.js',
  'dashboard/routes/daily.js',
  'dashboard/routes/intraday.js',
  'dashboard/routes/governance.js',
  'dashboard/routes/admission.js',
  'dashboard/public/index.html',
  'dashboard/public/app.js',
  'dashboard/public/styles.css'
];

const requiredServerTokens = [
  "NIFTY_DASHBOARD_HOST ?? '127.0.0.1'",
  "HOST !== '127.0.0.1'",
  "'/api/health'",
  "'/api/status'",
  "'/api/manifest'",
  "'/api/daily'",
  "'/api/intraday'",
  "'/api/governance'",
  "'/api/admission'",
  'ARTIFACT_INTEGRITY_BLOCKED',
  'Cache-Control',
  'no-store'
];

const forbiddenTokens = [
  'angelone',
  'angel one',
  'wss://',
  'ws://',
  'new websocket(',
  'websocket(',
  'placeorder',
  'place-order',
  'submitorder',
  'submit-order',
  'axios',
  'http.request(',
  'https.request('
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const relativePath of requiredFiles) {
    assert(fs.existsSync(path.join(ROOT, relativePath)), `Missing dashboard file: ${relativePath}`);
  }

  const server = fs.readFileSync(path.join(ROOT, 'dashboard/server.js'), 'utf8');
  const store = fs.readFileSync(path.join(ROOT, 'dashboard/routes/artifact-store.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'dashboard/public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'dashboard/public/index.html'), 'utf8');

  for (const token of requiredServerTokens) {
    assert(server.includes(token), `Dashboard server safety/API token missing: ${token}`);
  }

  assert(store.includes('eligibleCurrentIntradayContext === false'), 'Artifact store does not enforce the existing eligibility hard block.');
  assert(store.includes("safeString(eligibility.decision) === 'BLOCKED'"), 'Artifact store does not enforce existing BLOCKED decision.');
  assert(store.includes("safeString(reconciliation.summary?.result) === 'REVIEW'"), 'Artifact store does not enforce existing reconciliation REVIEW state.');
  assert(app.includes("getJson('/api/"), 'Dashboard UI does not consume local API endpoints.');
  assert(html.includes('RESEARCH ONLY'), 'Dashboard UI lacks required RESEARCH ONLY boundary.');
  assert(html.includes('id="admission-decision"'), 'Dashboard UI lacks admission decision target.');
  assert(app.includes("getJson('/api/admission')"), 'Dashboard UI does not consume the admission artifact route.');
  assert(app.includes("setState('admission-decision', admission.decision)"), 'Dashboard UI does not render artifact decision directly.');

  const combined = `${server}\n${store}\n${app}\n${html}`.toLowerCase();

  for (const token of forbiddenTokens) {
    assert(!combined.includes(token), `Forbidden dashboard capability token detected: ${token}`);
  }

  console.log('PASS: LOCAL_READ_ONLY_DASHBOARD_FILES_PRESENT');
  console.log('PASS: LOCALHOST_BINDING_ENFORCED');
  console.log('PASS: READ_ONLY_API_SURFACE_BOUND');
  console.log('PASS: ARTIFACT_INTEGRITY_FAIL_CLOSED_BOUND');
  console.log('PASS: EXISTING_INTRADAY_HARD_BLOCK_PRESERVED');
  console.log('PASS: NO_MARKET_BROKER_WEBSOCKET_ORDER_CAPABILITY_DETECTED');
  console.log('PASS: RESEARCH_ONLY_UI_BOUNDARY_PRESENT');
  console.log('Safety: static/local source verification only; no dashboard server, broker, WebSocket, authentication, market request, order, portfolio, or execution call was used.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
