#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$HOME/trishika-trading"
OUT="$ROOT/data/backtest-results"
RUN_ID="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$OUT/logs"
BACKUP_DIR="$OUT/backups/$RUN_ID"

mkdir -p "$LOG_DIR" "$BACKUP_DIR"
cd "$ROOT"

exec > >(tee -a "$LOG_DIR/crypto-backtest-$RUN_ID.log") 2>&1

echo "============================================================"
echo "Crypto backtest batch started: $(date -Is)"
echo "Project: $ROOT"
echo "Run ID : $RUN_ID"
echo "============================================================"

echo
echo "[1/7] Pre-flight checks"
command -v node >/dev/null || { echo "ERROR: node not found"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found"; exit 1; }

test -f scripts/backtest-baseline-4h.js || { echo "ERROR: baseline script missing"; exit 1; }
test -f scripts/backtest-variant-b.js || { echo "ERROR: variant-B script missing"; exit 1; }
test -f src/strategy/donchian.js || { echo "ERROR: production donchian strategy missing"; exit 1; }

for sym in BTC ETH SOL BNB; do
  test -f "data/historical-4h/${sym}_4h.json" || { echo "ERROR: Missing 4H data for $sym"; exit 1; }
  test -f "data/historical-1d/${sym}_1d.json" || { echo "ERROR: Missing daily data for $sym"; exit 1; }
done

echo "Node version: $(node --version)"
echo "Python version: $(python3 --version)"
echo "Pre-flight passed."

echo
echo "[2/7] Backing up existing output files"
for f in \
  baseline-4h-results.json \
  variant-b-4h-ema-results.json \
  walkforward-crypto-results.json \
  risk-adjusted-crypto-metrics.json \
  risk-adjusted-crypto-metrics.csv
do
  if [ -f "$OUT/$f" ]; then
    cp -a "$OUT/$f" "$BACKUP_DIR/$f"
    echo "Backed up: $f"
  fi
done

echo
echo "[3/7] Running Variant A — 4H Donchian baseline"
node scripts/backtest-baseline-4h.js

echo
echo "[4/7] Running Variant B — 4H Donchian + completed daily EMA(200)"
node scripts/backtest-variant-b.js

echo
echo "[5/7] Checking whether optional validation scripts exist"
if [ -f scripts/walkforward-crypto.js ]; then
  echo "Running walk-forward validation..."
  node scripts/walkforward-crypto.js
else
  echo "SKIP: scripts/walkforward-crypto.js not found."
fi

if [ -f scripts/risk-adjusted-crypto-metrics.js ]; then
  echo "Running risk-adjusted metrics..."
  node scripts/risk-adjusted-crypto-metrics.js
else
  echo "SKIP: scripts/risk-adjusted-crypto-metrics.js not found."
fi

echo
echo "[6/7] Creating consolidated comparison report"
python3 - <<'PY'
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path("data/backtest-results")
baseline_file = root / "baseline-4h-results.json"
variant_file = root / "variant-b-4h-ema-results.json"

baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
variant = json.loads(variant_file.read_text(encoding="utf-8"))

fields = [
    "tradeCount",
    "winRate",
    "netReturnPct",
    "netMaxDrawdownPct",
    "netProfitFactor",
    "expectancyPctNet",
    "maxLosingStreak",
]

rows = []
for symbol in ["BTC", "ETH", "SOL", "BNB"]:
    a = baseline.get("crypto", {}).get(symbol, {}).get("metrics", {})
    b_item = variant.get("crypto", {}).get(symbol, {})
    b = b_item.get("metrics", {})

    row = {"symbol": symbol}
    for field in fields:
        row[f"A_{field}"] = a.get(field)
        row[f"B_{field}"] = b.get(field)

    row["B_emaBlockedCount"] = b_item.get("emaBlockedCount")
    a_return = a.get("netReturnPct")
    b_return = b.get("netReturnPct")
    a_dd = a.get("netMaxDrawdownPct")
    b_dd = b.get("netMaxDrawdownPct")
    a_pf = a.get("netProfitFactor")
    b_pf = b.get("netProfitFactor")

    row["netReturnChangePctPoints"] = (
        round(b_return - a_return, 2)
        if isinstance(a_return, (int, float)) and isinstance(b_return, (int, float))
        else None
    )
    row["drawdownChangePctPoints"] = (
        round(b_dd - a_dd, 2)
        if isinstance(a_dd, (int, float)) and isinstance(b_dd, (int, float))
        else None
    )

    if not a or not b:
        row["preliminaryDecision"] = "INSUFFICIENT_OR_MISSING"
    elif (
        isinstance(a_return, (int, float))
        and isinstance(b_return, (int, float))
        and isinstance(a_dd, (int, float))
        and isinstance(b_dd, (int, float))
        and isinstance(a_pf, (int, float))
        and isinstance(b_pf, (int, float))
        and b_return > a_return
        and b_dd < a_dd
        and b_pf > a_pf
    ):
        row["preliminaryDecision"] = "REVIEW_VARIANT_B"
    else:
        row["preliminaryDecision"] = "KEEP_BASELINE_OR_REVIEW"

    rows.append(row)

stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
report = {
    "generatedAtUtc": stamp,
    "scope": "Research backtest only. No live execution decision.",
    "method": {
        "variantA": "4H Donchian-ATR baseline",
        "variantB": "Same engine plus completed daily EMA(200) directional confirmation",
        "warning": "Preliminary decision requires walk-forward and risk review."
    },
    "symbols": rows,
}

json_path = root / "crypto-ema-comparison-latest.json"
csv_path = root / "crypto-ema-comparison-latest.csv"

json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

headers = list(rows[0].keys()) if rows else ["symbol"]
with csv_path.open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)

print()
print("=" * 118)
print("CRYPTO: VARIANT A vs VARIANT B")
print("=" * 118)
print(f"{'Symbol':<8} {'A Net%':>9} {'B Net%':>9} {'Delta':>9} {'A DD%':>9} {'B DD%':>9} {'A PF':>8} {'B PF':>8} {'Blocked':>9}  Decision")
print("-" * 118)

def val(x, digits=2):
    return "-" if x is None else f"{x:.{digits}f}" if isinstance(x, float) else str(x)

for r in rows:
    print(
        f"{r['symbol']:<8} "
        f"{val(r['A_netReturnPct']):>9} "
        f"{val(r['B_netReturnPct']):>9} "
        f"{val(r['netReturnChangePctPoints']):>9} "
        f"{val(r['A_netMaxDrawdownPct']):>9} "
        f"{val(r['B_netMaxDrawdownPct']):>9} "
        f"{val(r['A_netProfitFactor'], 3):>8} "
        f"{val(r['B_netProfitFactor'], 3):>8} "
        f"{val(r['B_emaBlockedCount'], 0):>9}  "
        f"{r['preliminaryDecision']}"
    )

print("-" * 118)
print(f"JSON report: {json_path}")
print(f"CSV report : {csv_path}")
print("NOTE: This is research output only; it does not enable execution.")
PY

echo
echo "[7/7] Final file list"
ls -lh \
  "$OUT/baseline-4h-results.json" \
  "$OUT/variant-b-4h-ema-results.json" \
  "$OUT/crypto-ema-comparison-latest.json" \
  "$OUT/crypto-ema-comparison-latest.csv"

echo
echo "============================================================"
echo "SUCCESS: Crypto backtest batch completed: $(date -Is)"
echo "Log file   : $LOG_DIR/crypto-backtest-$RUN_ID.log"
echo "Backup dir : $BACKUP_DIR"
echo "============================================================"
