#!/usr/bin/env bash
set -u -o pipefail

ROOT="/home/himanshu/trishika-trading"
cd "$ROOT" || { echo "ERROR: repo not found"; exit 1; }

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$ROOT/.mtf-telemetry-backup-$STAMP"
LOG="$ROOT/mtf_telemetry_patch_$STAMP.log"
LIMITER="src/services/twelve_data_rate_limiter.js"
MTF="scripts/generate-crypto-forex-mtf-analysis.js"
TEST="tests/test_twelve_data_rate_limiter_telemetry.mjs"
MTF_TEST="tests/test_mtf_twelve_data_telemetry.mjs"

{
  echo "===== MTF TELEMETRY PATCH START ====="
  echo "TIME=$(date -Is)"
  echo "ROOT=$ROOT"
  echo

  echo "===== PRECONDITIONS ====="
  test -f "$LIMITER" || { echo "ERROR: missing $LIMITER"; exit 10; }
  test -f "$MTF" || { echo "ERROR: missing $MTF"; exit 11; }
  test -f "$TEST" || { echo "ERROR: missing $TEST"; exit 12; }
  test ! -e "$MTF_TEST" || { echo "ERROR: refusing to overwrite existing $MTF_TEST"; exit 13; }

  grep -q "function recordTelemetry(headers, caller)" "$LIMITER" || {
    echo "ERROR: limiter telemetry anchor missing"; exit 14;
  }
  grep -q "export function queueTwelveDataRequest(run)" "$LIMITER" || {
    echo "ERROR: limiter queue anchor missing"; exit 15;
  }
  grep -q "import { queueTwelveDataRequest } from '../src/services/twelve_data_rate_limiter.js';" "$MTF" || {
    echo "ERROR: exact MTF import anchor missing"; exit 16;
  }
  grep -q "const response = await fetch(" "$MTF" || {
    echo "ERROR: MTF native fetch anchor missing"; exit 17;
  }
  grep -q "const payload = await response.json().catch(() => null);" "$MTF" || {
    echo "ERROR: MTF payload anchor missing"; exit 18;
  }
  echo "PRECONDITIONS=PASS"
  echo

  echo "===== BACKUP ====="
  mkdir -p "$BACKUP_DIR"
  cp "$LIMITER" "$BACKUP_DIR/$(basename "$LIMITER")"
  cp "$MTF" "$BACKUP_DIR/$(basename "$MTF")"
  cp "$TEST" "$BACKUP_DIR/$(basename "$TEST")"
  echo "BACKUP_DIR=$BACKUP_DIR"
  echo

  echo "===== APPLY NARROW PATCH ====="
  python3 - <<'PY'
from pathlib import Path

limiter = Path("src/services/twelve_data_rate_limiter.js")
mtf = Path("scripts/generate-crypto-forex-mtf-analysis.js")

limiter_text = limiter.read_text()
old_limiter = """function recordTelemetry(headers, caller) {
  lastTelemetry = {
    caller: normalizeCaller(caller),
    capturedAtUtc: new Date().toISOString(),
    apiCreditsUsed: headerValue(headers, 'api-credits-used'),
    apiCreditsLeft: headerValue(headers, 'api-credits-left'),
    rateLimitLimit: headerValue(headers, 'x-ratelimit-limit'),
    rateLimitRemaining: headerValue(headers, 'x-ratelimit-remaining'),
    rateLimitReset: headerValue(headers, 'x-ratelimit-reset')
  };
}
"""
new_limiter = """function recordTelemetry(headers, caller) {
  lastTelemetry = {
    caller: normalizeCaller(caller),
    capturedAtUtc: new Date().toISOString(),
    apiCreditsUsed: headerValue(headers, 'api-credits-used'),
    apiCreditsLeft: headerValue(headers, 'api-credits-left'),
    rateLimitLimit: headerValue(headers, 'x-ratelimit-limit'),
    rateLimitRemaining: headerValue(headers, 'x-ratelimit-remaining'),
    rateLimitReset: headerValue(headers, 'x-ratelimit-reset')
  };
}

export function recordTwelveDataTelemetry(headers, caller) {
  const normalizedHeaders = headers && typeof headers.forEach === 'function'
    ? Object.fromEntries(headers.entries())
    : headers;

  recordTelemetry(normalizedHeaders, caller);
}
"""
if limiter_text.count(old_limiter) != 1:
    raise SystemExit("ERROR: limiter recordTelemetry anchor count is not exactly 1")
limiter.write_text(limiter_text.replace(old_limiter, new_limiter, 1))

mtf_text = mtf.read_text()
old_import = """import { queueTwelveDataRequest } from '../src/services/twelve_data_rate_limiter.js';
"""
new_import = """import {
  queueTwelveDataRequest,
  recordTwelveDataTelemetry
} from '../src/services/twelve_data_rate_limiter.js';
"""
if mtf_text.count(old_import) != 1:
    raise SystemExit("ERROR: MTF limiter import anchor count is not exactly 1")
mtf_text = mtf_text.replace(old_import, new_import, 1)

old_fetch = """      const payload = await response.json().catch(() => null);
"""
new_fetch = """      recordTwelveDataTelemetry(response.headers, 'mtf_child_process');

      const payload = await response.json().catch(() => null);
"""
if mtf_text.count(old_fetch) != 1:
    raise SystemExit("ERROR: MTF payload anchor count is not exactly 1")
mtf.write_text(mtf_text.replace(old_fetch, new_fetch, 1))
PY

  cat > "$MTF_TEST" <<'TESTEOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTwelveDataRateLimiterState,
  recordTwelveDataTelemetry
} from '../src/services/twelve_data_rate_limiter.js';

test('MTF telemetry records native Fetch Headers once with the approved caller', () => {
  const headers = new Headers({
    'api-credits-used': '11',
    'api-credits-left': '89',
    'x-ratelimit-limit': '4',
    'x-ratelimit-remaining': '3',
    'x-ratelimit-reset': '60'
  });

  recordTwelveDataTelemetry(headers, 'mtf_child_process');

  const state = getTwelveDataRateLimiterState();
  assert.equal(state.telemetry.caller, 'mtf_child_process');
  assert.equal(state.telemetry.apiCreditsUsed, '11');
  assert.equal(state.telemetry.apiCreditsLeft, '89');
  assert.equal(state.telemetry.rateLimitLimit, '4');
  assert.equal(state.telemetry.rateLimitRemaining, '3');
  assert.equal(state.telemetry.rateLimitReset, '60');
});
TESTEOF

  echo "PATCH_APPLY=PASS"
  echo

  echo "===== STATIC / TEST VALIDATION ====="
  node --check "$LIMITER"
  node --check "$MTF"
  node --check "$TEST"
  node --check "$MTF_TEST"
  echo "NODE_SYNTAX=PASS"

  node --test "$TEST" "$MTF_TEST"
  echo "TARGETED_TESTS=PASS"

  echo "===== CONTRACT ASSERTIONS ====="
  grep -q "export function recordTwelveDataTelemetry(headers, caller)" "$LIMITER"
  grep -q "recordTelemetry(normalizedHeaders, caller);" "$LIMITER"
  grep -q "queueTwelveDataRequest," "$MTF"
  grep -q "recordTwelveDataTelemetry" "$MTF"
  grep -q "recordTwelveDataTelemetry(response.headers, 'mtf_child_process');" "$MTF"
  grep -q "const controller = new AbortController();" "$MTF"
  grep -q "const response = await fetch(" "$MTF"
  grep -q "const payload = await response.json().catch(() => null);" "$MTF"
  grep -q "payload?.status === 'error' || !Array.isArray(payload?.values)" "$MTF"
  echo "MTF_FETCH_TIMEOUT_VALIDATION_UNCHANGED=PASS"

  echo "===== DIFF CHECK ====="
  git diff --check
  echo "DIFF_CHECK=PASS"
  echo

  echo "===== FOCUSED DIFF ====="
  git diff -- "$LIMITER" "$MTF" "$MTF_TEST"
  echo

  echo "===== FINAL STATUS ====="
  git status --short
  echo
  echo "SUCCESS: MTF telemetry patch applied and locally validated."
  echo "STOP: no git add, commit, push, deployment, scheduler trigger, or provider call was performed."
  echo "BACKUP_DIR=$BACKUP_DIR"
} > "$LOG" 2>&1

STATUS=$?
echo "PATCH_LOG=$LOG"
echo "PATCH_STATUS=$STATUS"

if [ "$STATUS" -ne 0 ]; then
  echo "PATCH_FAILED=TRUE"
  echo "No automated rollback was performed; inspect the log before any next action."
  echo "TERMINAL_REMAINS_OPEN=TRUE"
  exit "$STATUS"
fi

echo "PATCH_COMPLETE_LOCAL_REVIEW_REQUIRED=TRUE"
echo "TERMINAL_REMAINS_OPEN=TRUE"
