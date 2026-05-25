#!/usr/bin/env python3
"""
dashboard.py
Trishika Trading — single command status view.
Shows: past performance, current live state, and go-live readiness.

Run: python dashboard.py
"""
import json, os, math
from datetime import datetime, timezone
from pathlib import Path

BASE   = Path(__file__).parent
LOGS   = BASE / "logs"
LIVE   = BASE / "signals_live"
WFO    = BASE / "wfo_runs"

W  = 60
def box(title): print(f"\n{'='*W}\n  {title}\n{'='*W}")
def row(label, value, status=""): print(f"  {label:<28} {str(value):<18} {status}")
def divider(): print(f"  {'-'*56}")

# ── 1. PAST PERFORMANCE (WFO results) ────────────────────────────────────────
box("PAST PERFORMANCE — Walk-Forward Results")
wfo_runs = sorted(WFO.glob("*/summary.json")) if WFO.exists() else []
if not wfo_runs:
    print("  No WFO runs found — run: python run_wfo.py")
else:
    latest = json.loads(wfo_runs[-1].read_text())
    run_id = wfo_runs[-1].parent.name
    print(f"  Latest WFO run: {run_id}")
    divider()
    for asset, m in latest.get("assets", {}).items():
        pr   = m.get("profit_rate", 0)
        eq   = m.get("mean_OOS_eq", 1000)
        dd   = m.get("mean_dd", 0)
        base_pr = m.get("baseline_profit_rate", 0)
        status = "✓ HOLDING" if pr >= base_pr - 5 else "⚠ DEGRADED"
        row(f"{asset} profit_rate", f"{pr:.1f}%  (base {base_pr:.0f}%)", status)
        row(f"{asset} mean_OOS_eq", f"{eq:.2f}", "")
        row(f"{asset} mean_dd",     f"{dd:.3f}%", "")
        divider()

# ── 2. CURRENT STATE (live monitor) ──────────────────────────────────────────
box("CURRENT STATE — Live Monitor")
monitor_log = LOGS / "monitor.jsonl"
cycles, alerts, gate_passes, errors = [], [], [], []
if monitor_log.exists():
    for line in monitor_log.read_text().splitlines():
        try:
            r = json.loads(line)
            code = r.get("code","")
            if code == "MONITOR_CYCLE":   cycles.append(r)
            if code in ("SIGNAL_STALE","SIGNAL_FILE_MISSING",
                        "DRAWDOWN_BREACH","MONITOR_ERROR"): alerts.append(r)
            if code == "PORTFOLIO_GATE_PASS": gate_passes.append(r)
            if code == "MONITOR_ERROR":
                # sirf last 24 hours ke errors count karo
                try:
                    ts = datetime.fromisoformat(r["ts"].replace("Z","+00:00"))
                    if datetime.now(timezone.utc) - ts < timedelta(hours=24):
                        errors.append(r)
                except:
                    pass
        except: pass

if cycles:
    last = cycles[-1]
    ts   = last["ts"][:19].replace("T"," ")
    age  = (datetime.now(timezone.utc) -
            datetime.fromisoformat(last["ts"].replace("Z","+00:00"))
            ).total_seconds() / 60
    row("Last cycle",        ts,                    "✓" if age < 10 else "⚠ STALE")
    row("Cycle count",       len(cycles),           "✓")
    row("ETH price",         f"{last.get('eth_price','?')}",  "")
    row("Action",            last.get("action","?"),           "")
    row("Regime",            last.get("regime","?"),           "")
    row("Open positions",    last.get("open_position_count",0),"")
    row("Portfolio gate",    last.get("portfolio_gate_result","?"), "")
    row("Paper equity",      f"{last.get('paper_equity',1000):.4f}", "")
    row("Drawdown",          f"{last.get('dd_pct',0):.3f}%",  "✓" if last.get("dd_pct",0) < 0.7 else "⚠")
    divider()
    row("Total alerts fired", len(alerts),          "✓" if len(alerts) < 10 else "⚠ CHECK LOGS")
    row("Monitor errors",    len(errors),            "✓" if len(errors) == 0 else "⚠")
    row("Gate passes",       len(gate_passes),       "")
else:
    print("  No monitor cycles found")

# ── 3. PAPER FILLS ────────────────────────────────────────────────────────────
box("PAPER FILLS — Execution Log")
fills = []
paper_log = LOGS / "execution_paper.jsonl"
if paper_log.exists():
    for line in paper_log.read_text().splitlines():
        try: fills.append(json.loads(line))
        except: pass

real_fills = [f for f in fills if f.get("meta",{}).get("strategy") == "donchian_daily"]

if not real_fills:
    print("  No real strategy fills yet — waiting for first breakout signal")
    print(f"  (Test fills in log: {len(fills)})")
else:
    row("Total real fills",  len(real_fills), "")
    for f in real_fills[-5:]:
        pnl = f["equity_after"] - f["equity_before"]
        row(f"{f['ts'][:10]} {f['symbol']} {f['side']}",
            f"fill={f['fill_price']}",
            f"pnl={pnl:+.4f}")
    divider()
    row("Paper equity", f"{real_fills[-1]['equity_after']:.4f}", "")

# ── 4. GO-LIVE READINESS ──────────────────────────────────────────────────────
box("GO-LIVE READINESS CHECKLIST")

checks = {}

# Check 1: regression
try:
    import subprocess
    r = subprocess.run(["python","test_regression.py"],
                       capture_output=True, text=True, cwd=BASE)
    checks["Regression PASS"] = "PASS" in r.stdout
except: checks["Regression PASS"] = False

# Check 2: WFO run exists
checks["WFO run exists"] = len(wfo_runs) > 0

# Check 3: WFO metrics holding
if wfo_runs:
    all_holding = True
    for asset, m in latest.get("assets",{}).items():
        if m.get("profit_rate",0) < m.get("baseline_profit_rate",0) - 5:
            all_holding = False
    checks["WFO metrics holding"] = all_holding
else:
    checks["WFO metrics holding"] = False

# Check 4: monitor running clean
checks["Monitor running clean"] = len(cycles) > 0 and len(errors) == 0

# Check 5: no recent stale alerts
recent_alerts = [a for a in alerts
                 if a.get("code") in ("DRAWDOWN_BREACH","SIGNAL_FILE_MISSING")]
checks["No critical alerts"] = len(recent_alerts) == 0

# Check 6: real paper fills
checks["Real paper fills >= 1"] = len(real_fills) >= 1

# Check 7: paper fills >= 3
checks["Real paper fills >= 3"] = len(real_fills) >= 3

# Check 8: execution enabled
env = (BASE / ".env").read_text() if (BASE / ".env").exists() else ""
checks["EXECUTION_ENABLED=true"] = "EXECUTION_ENABLED=true" in env
checks["EXECUTION_MODE=paper"]   = "EXECUTION_MODE=paper" in env

divider()
score = 0
for label, ok in checks.items():
    mark = "✓" if ok else "✗"
    print(f"  [{mark}] {label}")
    if ok: score += 1

divider()
total = len(checks)
pct   = int(score / total * 100)

# Readiness bands
if score == total:
    verdict = "🟢 READY FOR LIVE — all checks passed"
elif score >= total - 2 and checks.get("Real paper fills >= 3"):
    verdict = "🟡 NEARLY READY — flip EXECUTION_MODE=live when confident"
elif checks.get("Real paper fills >= 1"):
    verdict = "🟡 PAPER ACTIVE — accumulating fills, check back after 3-5 fills"
elif checks.get("EXECUTION_ENABLED=true"):
    verdict = "🟠 WAITING FOR SIGNAL — paper enabled, no breakout yet"
else:
    verdict = "🔴 NOT READY — flip EXECUTION_ENABLED=true first"

print(f"\n  Readiness: {score}/{total} checks  ({pct}%)")
print(f"\n  {verdict}")

# Next action
print(f"\n{'='*W}")
print("  NEXT ACTION")
print(f"{'='*W}")
if not checks.get("EXECUTION_ENABLED=true"):
    print("  → Run: sed -i 's/EXECUTION_ENABLED=false/EXECUTION_ENABLED=true/' .env")
    print("         pm2 restart trishika --update-env")
elif not checks.get("Real paper fills >= 1"):
    print("  → Wait for first real breakout signal (ETH or SOL)")
    print("    Check: tail -f logs/monitor.jsonl | grep GATE_PASS")
elif not checks.get("Real paper fills >= 3"):
    print("  → Accumulate 3+ real paper fills before going live")
    print(f"    Progress: {len(real_fills)}/3 fills")
elif not checks.get("WFO metrics holding"):
    print("  → WFO metrics degraded — re-run: python run_wfo.py")
else:
    print("  → All clear. To go live:")
    print("    sed -i 's/EXECUTION_MODE=paper/EXECUTION_MODE=live/' .env")
    print("    pm2 restart trishika --update-env")
    print("    Start with small size. Kill-switch: EXECUTION_ENABLED=false")

print(f"{'='*W}\n")
