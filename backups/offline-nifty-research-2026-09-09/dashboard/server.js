#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

import { ArtifactIntegrityError, integrityReport } from './routes/artifact-store.js';
import { statusRoute } from './routes/status.js';
import { manifestRoute } from './routes/manifest.js';
import { dailyRoute } from './routes/daily.js';
import { intradayRoute } from './routes/intraday.js';
import { governanceRoute } from './routes/governance.js';
import { admissionRoute } from './routes/admission.js';
import { niftyMtfRoute } from './routes/nifty-mtf.js';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'dashboard/public');
const HOST = process.env.NIFTY_DASHBOARD_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.NIFTY_DASHBOARD_PORT ?? '8787', 10);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('NIFTY_DASHBOARD_PORT must be an integer from 1 to 65535.');
}

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
  throw new Error('Local-only safety rule: NIFTY_DASHBOARD_HOST must be 127.0.0.1, localhost, or ::1.');
}

const STATIC_FILES = Object.freeze({
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'application/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', contentType: 'text/css; charset=utf-8' }
});

function setCommonHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
}

function sendJson(response, statusCode, body) {
  setCommonHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(response, statusCode, body) {
  setCommonHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function sendStatic(response, staticFile) {
  const safePath = path.join(PUBLIC_DIR, staticFile.file);

  if (!safePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendText(response, 403, 'Forbidden\n');
    return;
  }

  try {
    const body = fs.readFileSync(safePath);
    setCommonHeaders(response);
    response.writeHead(200, { 'Content-Type': staticFile.contentType });
    response.end(body);
  } catch {
    sendText(response, 503, 'Dashboard static artifact unavailable\n');
  }
}

function artifactBlocked(response, report) {
  sendJson(response, 503, {
    error: 'ARTIFACT_INTEGRITY_BLOCKED',
    message: 'Dashboard is fail-closed because required offline research artifacts are missing, corrupt, or inconsistent.',
    checkedAtUtc: report.checkedAtUtc,
    details: report.details ?? [],
    artifactInventory: report.inventory
  });
}

const server = http.createServer((request, response) => {
  if (!request.url || !request.method) {
    sendText(response, 400, 'Bad request\n');
    return;
  }

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendText(response, 405, 'Method not allowed\n');
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  if (STATIC_FILES[pathname]) {
    sendStatic(response, STATIC_FILES[pathname]);
    return;
  }

  if (!pathname.startsWith('/api/')) {
    sendText(response, 404, 'Not found\n');
    return;
  }

  const report = integrityReport();

  if (pathname === '/api/health') {
    if (!report.ok) {
      artifactBlocked(response, report);
      return;
    }

    sendJson(response, 200, {
      status: 'OK',
      mode: 'LOCAL_OFFLINE_READ_ONLY_RESEARCH',
      host: HOST,
      integrity: 'PASS',
      checkedAtUtc: report.checkedAtUtc,
      tradingApproved: false,
      brokerConnectivityAllowed: false,
      websocketAllowed: false,
      executionAllowed: false
    });
    return;
  }

  if (!report.ok) {
    artifactBlocked(response, report);
    return;
  }

  try {
    const { artifacts, inventory } = report;
    const routes = {
      '/api/status': () => statusRoute(artifacts),
      '/api/manifest': () => manifestRoute(artifacts, inventory),
      '/api/daily': () => dailyRoute(artifacts),
      '/api/intraday': () => intradayRoute(artifacts),
      '/api/governance': () => governanceRoute(artifacts, inventory),
      '/api/admission': () => admissionRoute(artifacts),
      '/api/nifty-mtf': () => niftyMtfRoute()
    };

    const handler = routes[pathname];

    if (!handler) {
      sendJson(response, 404, {
        error: 'NOT_FOUND',
        message: 'Supported endpoints: /api/health, /api/status, /api/manifest, /api/daily, /api/intraday, /api/governance, /api/admission, /api/nifty-mtf'
      });
      return;
    }

    sendJson(response, 200, handler());
  } catch (error) {
    const statusCode = error instanceof ArtifactIntegrityError ? 503 : 500;

    sendJson(response, statusCode, {
      error: error instanceof ArtifactIntegrityError ? 'ARTIFACT_INTEGRITY_BLOCKED' : 'DASHBOARD_ERROR',
      message: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log('LOCAL NIFTY OFFLINE RESEARCH DASHBOARD: READY');
  console.log(`URL: http://${HOST}:${PORT}`);
  console.log('Mode: local-only, read-only, artifact-backed, fail-closed.');
  console.log('Safety: no market API, broker, WebSocket, authentication, order, portfolio, execution, or automatic action exists in this server.');
});

function closeSafely(signal) {
  console.log(`Received ${signal}; stopping local dashboard.`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => closeSafely('SIGINT'));
process.on('SIGTERM', () => closeSafely('SIGTERM'));
