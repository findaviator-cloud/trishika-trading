#!/usr/bin/env bash
set -u -o pipefail

ROOT="/home/himanshu/trishika-trading"
cd "$ROOT" || { echo "ERROR: repo not found"; exit 1; }

LOG="$ROOT/mtf_telemetry_commit_$(date +%Y%m%d_%H%M%S).log"
LIMITER="src/services/twelve_data_rate_limiter.js"
MTF="scripts/generate-crypto-forex-mtf-analysis.js"
MTF_TEST="tests/test_mtf_twelve_data_telemetry.mjs"
BASE_TEST="tests/test_twelve_data_rate_limiter_telemetry.mjs"

{
  echo "===== MTF TELEMETRY COMMIT START ====="
  echo "TIME=$(date -Is)"
  echo

  echo "===== PRE-FLIGHT ====="
  test -f "$LIMITER" || { echo "ERROR: missing $LIMITER"; exit 10; }
  test -f "$MTF" || { echo "ERROR: missing $MTF"; exit 11; }
  test -f "$MTF_TEST" || { echo "ERROR: missing $MTF_TEST"; exit 12; }
  test -f "$BASE_TEST" || { echo "ERROR: missing $BASE_TEST"; exit 13; }

  grep -q "export function recordTwelveDataTelemetry(headers, caller)" "$LIMITER" || {
    echo "ERROR: telemetry helper missing"; exit 14;
  }
  grep -q "recordTwelveDataTelemetry(response.headers, 'mtf_child_process');" "$MTF" || {
    echo "ERROR: MTF response-header hook missing"; exit 15;
  }
  grep -q "const controller = new AbortController();" "$MTF" || {
    echo "ERROR: AbortController anchor missing"; exit 16;
  }
  grep -q "payload?.status === 'error' || !Array.isArray(payload?.values)" "$MTF" || {
    echo "ERROR: MTF validation anchor missing"; exit 17;
  }
  echo "PREFLIGHT=PASS"
  echo

  echo "===== TEST NAME CLARIFICATION ====="
  python3 - <<'PY'
from pathlib import Path

path = Path("tests/test_mtf_twelve_data_telemetry.mjs")
text = path.read_text()
old = "test('MTF telemetry records native Fetch Headers once with the approved caller', () => {"
new = "test('telemetry helper accepts native Fetch Headers for approved MTF caller', () => {"

if text.count(old) != 1:
    raise SystemExit("ERROR: expected test-name anchor exactly once")

path.write_text(text.replace(old, new, 1))
PY
  echo "TEST_NAME=UPDATED"
  echo

  echo "===== LOCAL VALIDATION ====="
  node --check "$LIMITER"
  node --check "$MTF"
  node --check "$MTF_TEST"
  node --check "$BASE_TEST"
  echo "SYNTAX=PASS"

  node --test "$BASE_TEST" "$MTF_TEST"
  echo "TESTS=PASS"

  git diff --check
  echo "DIFF_CHECK=PASS"
  echo

  echo "===== STAGING GUARD ====="
  git reset
  git add -- "$LIMITER" "$MTF" "$MTF_TEST"

  STAGED="$(git diff --cached --name-only)"
  EXPECTED="$(printf '%s\n%s\n%s\n' "$MTF" "$LIMITER" "$MTF_TEST" | sort)"

  if [ "$(printf '%s\n' "$STAGED" | sort)" != "$EXPECTED" ]; then
    echo "ERROR: staged-file set is not exactly the intended three files"
    echo "STAGED:"
    printf '%s\n' "$STAGED"
    git reset
    exit 18
  fi

  echo "STAGED_FILES=PASS"
  git diff --cached --check
  echo "STAGED_DIFF_CHECK=PASS"
  echo

  echo "===== STAGED DIFF ====="
  git diff --cached -- "$LIMITER" "$MTF" "$MTF_TEST"
  echo

  echo "===== COMMIT ====="
  git commit -m "Add MTF Twelve Data telemetry headers"
  COMMIT_SHA="$(git rev-parse --short HEAD)"
  echo "COMMIT_SHA=$COMMIT_SHA"
  echo

  echo "===== PUSH ====="
  git push
  echo "PUSH=PASS"
  echo

  echo "===== POST-PUSH STATUS ====="
  git status --short
  git log -1 --oneline
  echo
  echo "SUCCESS: intended MTF telemetry patch committed and pushed."
  echo "NO_PROVIDER_CALL_NO_SCHEDULER_TRIGGER_NO_DEPLOY_ACTION=CONFIRMED"
} > "$LOG" 2>&1

STATUS=$?
echo "COMMIT_LOG=$LOG"
echo "COMMIT_STATUS=$STATUS"

if [ "$STATUS" -ne 0 ]; then
  echo "COMMIT_OR_PUSH_FAILED=TRUE"
  echo "Inspect log before retrying. Terminal remains open."
  exit "$STATUS"
fi

echo "TERMINAL_REMAINS_OPEN=TRUE"
