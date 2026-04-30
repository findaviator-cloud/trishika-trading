"""
run_wfo.py — Monthly Walk-Forward Validation CLI
================================================
Runs WFO for ETH + SOL daily configs, saves dated artifacts,
compares vs last run, alerts on drift.

Usage:
    python run_wfo.py              # full run
    python run_wfo.py --dry-run    # check data only, no artifacts

Output:
    wfo_runs/YYYYMMDD_HHMM/
        eth_wfo.csv
        sol_wfo.csv
        summary.json
        report.txt
"""

import os, sys, json, hashlib, statistics, argparse
import pandas as pd
from datetime import datetime
from test_next_bar_strategy import run_next_bar_strategy

# ── config ────────────────────────────────────────────────────────────────────
ASSETS = {
    "ETH": {
        "csv":         "./data/ETHUSDT_1d_1000.csv",
        "donchian_len": 20,
        "atr_len":      14,
        "atr_mult":     2.0,
        "sma_len":      100,
        "allow_long":   True,
        "allow_short":  True,
        "use_sma_filter": True,
        "risk_pct":     0.005,
        "label":        "ls_sma100",
        # baseline from validated run
        "baseline": {
            "profit_rate": 33.0,
            "mean_oos_eq": 1019.98,
            "mean_dd":     0.346,
        }
    },
    "SOL": {
        "csv":         "./data/SOLUSDT_1d_1000.csv",
        "donchian_len": 20,
        "atr_len":      14,
        "atr_mult":     2.0,
        "sma_len":      100,
        "allow_long":   False,
        "allow_short":  True,
        "use_sma_filter": False,
        "risk_pct":     0.005,
        "label":        "short_only",
        "baseline": {
            "profit_rate": 67.0,
            "mean_oos_eq": 1011.71,
            "mean_dd":     15.48,
        }
    },
}

FIXED = dict(
    fee=0.0015, compounding=True, next_open_exit=False,
    chandelier=False, ratchet=True,
    initial_equity=1000.0, fixed_notional=1000.0,
)

IS, OOS, STEP = 500, 150, 150

# drift thresholds — alert if OOS stats degrade beyond these
DRIFT = {
    "profit_rate_drop": 20.0,   # alert if profit_rate drops > 20pp vs baseline
    "mean_eq_drop":     30.0,   # alert if mean_oos_eq drops > 30 vs baseline
    "mean_dd_spike":    10.0,   # alert if mean_dd rises > 10pp vs baseline
}

# ── helpers ───────────────────────────────────────────────────────────────────
def metrics(trades, initial=1000.0):
    if not trades:
        return dict(final_eq=initial, n_trades=0, n_long=0, n_short=0,
                    win_rate=0.0, max_dd=0.0, sharpe=0.0)
    rets = [t['exit_price']/t['entry_price']-1-2*0.0015
            if t['direction']==1
            else t['entry_price']/t['exit_price']-1-2*0.0015
            for t in trades]
    wins = sum(1 for r in rets if r > 0)
    eq   = [initial] + [t['equity'] for t in trades]
    peak, mdd = eq[0], 0.0
    for e in eq:
        peak = max(peak, e)
        mdd  = max(mdd, (peak-e)/peak*100)
    sh = (sum(rets)/len(rets))/(statistics.stdev(rets)+1e-12) if len(rets)>1 else 0.0
    return dict(
        final_eq  = round(eq[-1], 4),
        n_trades  = len(trades),
        n_long    = sum(1 for t in trades if t['direction']==1),
        n_short   = sum(1 for t in trades if t['direction']==-1),
        win_rate  = round(wins/len(rets)*100, 2),
        max_dd    = round(mdd, 4),
        sharpe    = round(sh, 4),
    )

def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()

def last_wfo_summary():
    runs_dir = "./wfo_runs"
    if not os.path.exists(runs_dir):
        return None
    runs = sorted([d for d in os.listdir(runs_dir)
                   if os.path.isdir(os.path.join(runs_dir, d))])
    if not runs:
        return None
    last = runs[-1]
    summary_path = os.path.join(runs_dir, last, "summary.json")
    if os.path.exists(summary_path):
        with open(summary_path) as f:
            return json.load(f), last
    return None

# ── main ──────────────────────────────────────────────────────────────────────
def run_wfo(dry_run=False):
    ts     = datetime.now().strftime("%Y%m%d_%H%M")
    outdir = f"./wfo_runs/{ts}"

    print(f"\n{'='*60}")
    print(f"TRISHIKA WFO RUN — {ts}")
    print(f"{'='*60}")

    if dry_run:
        print("[DRY RUN] Checking data only — no artifacts written\n")

    results  = {}
    all_rows = []
    alerts   = []

    for asset, cfg in ASSETS.items():
        print(f"\n── {asset} ({cfg['label']}) ──")

        # check data
        if not os.path.exists(cfg["csv"]):
            print(f"  ERROR: {cfg['csv']} not found — skipping")
            alerts.append(f"WFO_DATA_MISSING: {asset} CSV not found")
            continue

        file_md5 = md5(cfg["csv"])
        df_full  = pd.read_csv(cfg["csv"])
        print(f"  Data: {len(df_full)} bars  MD5={file_md5}")

        if dry_run:
            continue

        # build folds
        folds = []
        oos_start = IS
        while oos_start + OOS <= len(df_full):
            folds.append((oos_start-IS, oos_start, oos_start, oos_start+OOS))
            oos_start += STEP
        print(f"  Folds: {len(folds)}  IS={IS} OOS={OOS}")

        # run folds
        p = dict(
            donchian_len    = cfg["donchian_len"],
            atr_len         = cfg["atr_len"],
            atr_mult        = cfg["atr_mult"],
            use_sma_filter  = cfg["use_sma_filter"],
            sma_len         = cfg["sma_len"],
            allow_long      = cfg["allow_long"],
            allow_short     = cfg["allow_short"],
            risk_pct        = cfg["risk_pct"],
        )

        wf_rows = []
        for fi, (is0,is1,oos0,oos1) in enumerate(folds, 1):
            df_is  = df_full.iloc[is0:is1].reset_index(drop=True)
            df_oos = df_full.iloc[oos0:oos1].reset_index(drop=True)
            _, tr_is  = run_next_bar_strategy(df_is.copy(),  **p, **FIXED)
            _, tr_oos = run_next_bar_strategy(df_oos.copy(), **p, **FIXED)
            m_is  = metrics(tr_is)
            m_oos = metrics(tr_oos)
            profitable = m_oos['final_eq'] > 1000.0
            wf_rows.append(dict(
                asset=asset, fold=fi,
                is_eq=m_is['final_eq'],   is_tr=m_is['n_trades'],
                oos_eq=m_oos['final_eq'], oos_tr=m_oos['n_trades'],
                oos_wr=m_oos['win_rate'], oos_dd=m_oos['max_dd'],
                oos_profitable=profitable,
            ))
            status = "YES" if profitable else "no"
            print(f"  Fold {fi}: IS_eq={m_is['final_eq']:>8.2f}  "
                  f"OOS_eq={m_oos['final_eq']:>8.2f}  "
                  f"OOS_tr={m_oos['n_trades']:>3}  "
                  f"OOS_wr={m_oos['win_rate']:>5.1f}%  "
                  f"OOS_dd={m_oos['max_dd']:>6.3f}%  {status}")

        wf = pd.DataFrame(wf_rows)
        profit_rate = wf['oos_profitable'].mean() * 100
        mean_oos_eq = wf['oos_eq'].mean()
        mean_dd     = wf['oos_dd'].mean()

        print(f"\n  OOS Summary:")
        print(f"    profit_rate : {profit_rate:.0f}%  "
              f"(baseline: {cfg['baseline']['profit_rate']:.0f}%)")
        print(f"    mean_OOS_eq : {mean_oos_eq:.2f}  "
              f"(baseline: {cfg['baseline']['mean_oos_eq']:.2f})")
        print(f"    mean_dd     : {mean_dd:.3f}%  "
              f"(baseline: {cfg['baseline']['mean_dd']:.3f}%)")

        # drift checks
        pr_drop  = cfg['baseline']['profit_rate'] - profit_rate
        eq_drop  = cfg['baseline']['mean_oos_eq'] - mean_oos_eq
        dd_spike = mean_dd - cfg['baseline']['mean_dd']

        if pr_drop > DRIFT['profit_rate_drop']:
            alerts.append(f"WFO_DEGRADED: {asset} profit_rate dropped "
                          f"{pr_drop:.0f}pp vs baseline")
        if eq_drop > DRIFT['mean_eq_drop']:
            alerts.append(f"WFO_DEGRADED: {asset} mean_OOS_eq dropped "
                          f"{eq_drop:.1f} vs baseline")
        if dd_spike > DRIFT['mean_dd_spike']:
            alerts.append(f"WFO_DEGRADED: {asset} mean_dd spiked "
                          f"+{dd_spike:.1f}pp vs baseline")

        results[asset] = dict(
            label       = cfg['label'],
            csv_md5     = file_md5,
            bars        = len(df_full),
            folds       = len(folds),
            profit_rate = round(profit_rate, 1),
            mean_oos_eq = round(mean_oos_eq, 4),
            mean_dd     = round(mean_dd, 4),
            baseline    = cfg['baseline'],
        )
        all_rows.extend(wf_rows)

        # save per-asset CSV
        os.makedirs(outdir, exist_ok=True)
        wf.to_csv(f"{outdir}/{asset.lower()}_wfo.csv", index=False)

    if dry_run:
        print("\n[DRY RUN] Complete — data checks passed")
        return

    if not results:
        print("\nNo results — check data files")
        return

    # ── save summary ──────────────────────────────────────────────────────────
    summary = dict(
        ts       = ts,
        run_by   = "run_wfo.py",
        assets   = results,
        alerts   = alerts,
        status   = "WFO_DEGRADED" if alerts else "WFO_COMPLETE",
    )

    os.makedirs(outdir, exist_ok=True)
    with open(f"{outdir}/summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # ── text report ───────────────────────────────────────────────────────────
    report_lines = [
        f"TRISHIKA WFO REPORT — {ts}",
        "="*60,
        "",
    ]
    for asset, r in results.items():
        pr_diff = r['profit_rate'] - r['baseline']['profit_rate']
        eq_diff = r['mean_oos_eq'] - r['baseline']['mean_oos_eq']
        dd_diff = r['mean_dd'] - r['baseline']['mean_dd']
        report_lines += [
            f"{asset} ({r['label']}):",
            f"  profit_rate : {r['profit_rate']:>5.1f}%  "
            f"(baseline {r['baseline']['profit_rate']:.1f}%  "
            f"diff {pr_diff:+.1f}pp)",
            f"  mean_OOS_eq : {r['mean_oos_eq']:>8.2f}  "
            f"(baseline {r['baseline']['mean_oos_eq']:.2f}  "
            f"diff {eq_diff:+.2f})",
            f"  mean_dd     : {r['mean_dd']:>7.3f}%  "
            f"(baseline {r['baseline']['mean_dd']:.3f}%  "
            f"diff {dd_diff:+.3f}pp)",
            "",
        ]

    report_lines += ["ALERTS:" if alerts else "ALERTS: none"]
    for a in alerts:
        report_lines.append(f"  !! {a}")

    report_lines += [
        "",
        f"STATUS: {summary['status']}",
        f"Artifacts: {outdir}/",
    ]

    report = "\n".join(report_lines)
    with open(f"{outdir}/report.txt", "w") as f:
        f.write(report)

    # ── compare vs last run ───────────────────────────────────────────────────
    last = last_wfo_summary()
    if last:
        last_summary, last_ts = last
        print(f"\n── vs last run ({last_ts}) ──")
        for asset in results:
            if asset in last_summary.get("assets", {}):
                prev = last_summary["assets"][asset]
                curr = results[asset]
                pr_diff = curr['profit_rate'] - prev['profit_rate']
                eq_diff = curr['mean_oos_eq'] - prev['mean_oos_eq']
                print(f"  {asset}: profit_rate {prev['profit_rate']:.0f}% → "
                      f"{curr['profit_rate']:.0f}% ({pr_diff:+.0f}pp)  "
                      f"mean_eq {prev['mean_oos_eq']:.2f} → "
                      f"{curr['mean_oos_eq']:.2f} ({eq_diff:+.2f})")

    # ── final output ──────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(report)
    print(f"\nArtifacts saved to: {outdir}/")

    if alerts:
        print(f"\n🚨 {summary['status']} — {len(alerts)} alert(s) raised")
        for a in alerts: print(f"   {a}")
    else:
        print(f"\n✅ {summary['status']} — all metrics within baseline bounds")

    return summary

# ── entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trishika Monthly WFO CLI")
    parser.add_argument("--dry-run", action="store_true",
                        help="Check data only, no artifacts")
    args = parser.parse_args()
    run_wfo(dry_run=args.dry_run)
