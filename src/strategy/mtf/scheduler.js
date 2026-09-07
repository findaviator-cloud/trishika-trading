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

function logLine(log, level, message) {
  const fn = log?.[level] ?? log?.info ?? console.log;
  fn(message);
}

export function runMtfResearchRefresh(log) {
  if (running) {
    logLine(log, 'warn', '[MTF] Manual refresh skipped: a previous refresh is still active.');
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
      logLine(log, 'error', `[MTF] Manual refresh spawn error: ${error.message}`);
    });

    child.on('close', (code, signal) => {
      running = false;

      if (code === 0) {
        logLine(log, 'info', '[MTF] Manual research refresh complete.');
      } else {
        logLine(
          log,
          'warn',
          `[MTF] Manual refresh ended with code=${code} signal=${signal ?? 'none'}.`
        );
      }

      resolve({ skipped: false, code, signal });
    });
  });
}

export function startMtfResearchScheduler(log) {
  logLine(
    log,
    'info',
    '[MTF] Snapshot API/dashboard enabled. Automatic MTF provider refresh is disabled; use controlled manual refresh only.'
  );

  return () => {};
}

export function getMtfSchedulerState() {
  return {
    running,
    automaticRefreshEnabled: false,
    refreshMode: 'MANUAL_ONLY',
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };
}
