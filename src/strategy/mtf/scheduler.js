import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const generatorPath = path.join(
  projectRoot,
  'scripts',
  'generate-crypto-forex-mtf-analysis.js'
);

let running = false;
let intervalHandle = null;
let lastRunAtUtc = null;
let nextRunAtUtc = null;

// Opt-in only. Defaults to OFF so behavior does not silently change.
const AUTO_REFRESH_ENABLED = process.env.MTF_AUTO_REFRESH_ENABLED === 'true';

// Floor of 5 minutes protects the Twelve Data rate limit. Default: 1 hour.
const AUTO_REFRESH_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.MTF_AUTO_REFRESH_INTERVAL_MS) || 60 * 60 * 1000
);

function logLine(log, level, message) {
  const fn = log?.[level] ?? log?.info ?? console.log;
  fn(message);
}

export function runMtfResearchRefresh(log) {
  if (running) {
    logLine(log, 'warn', '[MTF] Refresh skipped: a previous refresh is still active.');
    return Promise.resolve({ skipped: true, reason: 'already-running' });
  }

  running = true;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [generatorPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MTF_REQUEST_GAP_MS: process.env.MTF_REQUEST_GAP_MS || '8500'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) logLine(log, 'info', `[MTF] ${text}`);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) logLine(log, 'warn', `[MTF] ${text}`);
    });

    child.on('error', (error) => {
      logLine(log, 'error', `[MTF] Refresh spawn error: ${error.message}`);
    });

    child.on('close', (code, signal) => {
      running = false;
      lastRunAtUtc = new Date().toISOString();

      if (code === 0) {
        logLine(log, 'info', '[MTF] Research refresh complete.');
      } else {
        logLine(
          log,
          'warn',
          `[MTF] Refresh ended with code=${code} signal=${signal ?? 'none'}.`
        );
      }

      resolve({ skipped: false, code, signal });
    });
  });
}

export function startMtfResearchScheduler(log) {
  if (!AUTO_REFRESH_ENABLED) {
    logLine(
      log,
      'info',
      '[MTF] Automatic MTF provider refresh is disabled (set MTF_AUTO_REFRESH_ENABLED=true to enable). Manual refresh only.'
    );
    return () => {};
  }

  logLine(
    log,
    'info',
    `[MTF] Automatic MTF refresh ENABLED. Interval: every ${Math.round(AUTO_REFRESH_INTERVAL_MS / 60000)} minute(s).`
  );

  const tick = async () => {
    nextRunAtUtc = new Date(Date.now() + AUTO_REFRESH_INTERVAL_MS).toISOString();
    try {
      await runMtfResearchRefresh(log);
    } catch (error) {
      logLine(log, 'error', `[MTF] Auto-refresh cycle failed: ${error.message}`);
    }
  };

  // First run shortly after boot, then repeat on the interval.
  const initialTimer = setTimeout(tick, 30_000);
  intervalHandle = setInterval(tick, AUTO_REFRESH_INTERVAL_MS);
  nextRunAtUtc = new Date(Date.now() + 30_000).toISOString();

  return function stopMtfResearchScheduler() {
    clearTimeout(initialTimer);
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    nextRunAtUtc = null;
    logLine(log, 'info', '[MTF] Automatic MTF refresh stopped.');
  };
}

export function getMtfSchedulerState() {
  return {
    running,
    automaticRefreshEnabled: AUTO_REFRESH_ENABLED,
    refreshMode: AUTO_REFRESH_ENABLED ? 'AUTOMATIC' : 'MANUAL_ONLY',
    intervalMs: AUTO_REFRESH_ENABLED ? AUTO_REFRESH_INTERVAL_MS : null,
    lastRunAtUtc,
    nextRunAtUtc,
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };
}
