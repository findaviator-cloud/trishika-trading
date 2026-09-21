#!/usr/bin/env bash
# ============================================================
# Adds a REAL automatic MTF refresh scheduler.
# Safe by default: automatic refresh stays OFF unless you set
# MTF_AUTO_REFRESH_ENABLED=true in your environment (Render dashboard).
# ============================================================
set -e

echo "=== Add MTF Auto-Scheduler ==="

if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
  echo "ERROR: Run this from inside the trishika-trading folder (where server.js lives)."
  exit 1
fi

TARGET="src/strategy/mtf/scheduler.js"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: $TARGET not found. Are you in the right repo?"
  exit 1
fi

# Safety checkpoint
if [ -d ".git" ]; then
  TAG="pre-mtf-scheduler-$(date +%Y%m%d-%H%M%S)"
  git add -A
  git commit -m "Snapshot before adding MTF auto-scheduler" --allow-empty -q
  git tag "$TAG"
  echo "✔ Safety checkpoint created: git tag '$TAG'"
fi

cat > "$TARGET" << 'EOF'
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
EOF

echo "✔ $TARGET updated with real automatic scheduler (opt-in via MTF_AUTO_REFRESH_ENABLED)."
echo ""
echo "--- git diff summary ---"
git diff --stat "$TARGET" || true

echo ""
echo "=== NEXT STEPS ==="
echo "1) Commit + push:"
echo "     git add $TARGET"
echo "     git commit -m 'feat: add real automatic MTF refresh scheduler (opt-in)'"
echo "     git push origin main"
echo ""
echo "2) On Render dashboard -> your service -> Environment, add:"
echo "     MTF_AUTO_REFRESH_ENABLED = true"
echo "   Optional (default is 1 hour = 3600000 ms, minimum allowed is 300000 = 5 min):"
echo "     MTF_AUTO_REFRESH_INTERVAL_MS = 3600000"
echo ""
echo "3) Redeploy. Then check: GET /api/mtf/status"
echo "   -> scheduler.automaticRefreshEnabled should be true"
echo "   -> scheduler.nextRunAtUtc should show the next scheduled run"
echo ""
echo "NOTE: Twelve Data has API rate limits on the free tier. Refreshing too often"
echo "(e.g. every 5 minutes across 6 symbols x 3 timeframes) can burn through your"
echo "quota fast. 1 hour is a safe starting point."
