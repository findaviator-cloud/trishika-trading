"""
Walk-forward validation over four candidate parameter sets.

Structure:
  - Fixed window sizes: IS=300 bars, OOS=100 bars
  - Step: 100 bars (anchored rolling — IS grows, OOS stays fixed)
  - Alternatively: sliding (IS fixed, rolls forward) — set ANCHORED=False

Candidates:
  1. (don=10, atr=14, mult=3.5)  — sweep leader
  2. (don=12, atr=14, mult=3.5)  — sweep runner-up
  3. (don=10, atr=14, mult=2.0)  — frozen production baseline (control)
  4. (don=30, atr=14, mult=3.5)  — long-Donchian robustness probe
"""

import hashlib
import pandas as pd
from test_next_bar_strategy import run_next_bar_strategy

# ── config ────────────────────────────────────────────────────────────────────
CSV_PATH   = "./data/BTCUSDT_1h.csv"
IS_BARS    = 300          # in-sample window size
OOS_BARS   = 100          # out-of-sample window size
STEP       = 100          # bars to advance each fold
ANCHORED   = False        # False = sliding IS window; True = expanding IS

CANDIDATES = [
    dict(label="don10_atr14_m3.5", donchian_len=10, atr_len=14, atr_mult=3.5),
    dict(label="don12_atr14_m3.5", donchian_len=12, atr_len=14, atr_mult=3.5),
    dict(label="don10_atr14_m2.0", donchian_len=10, atr_len=14, atr_mult=2.0),  # control
    dict(label="don30_atr14_m3.5", donchian_len=30, atr_len=14, atr_mult=3.5),
]

FIXED = dict(
    fee=0.0015, compounding=True, next_open_exit=False,
    chandelier=False, ratchet=True,
    initial_equity=1000.0, fixed_notional=1000.0,
)

# ── helpers ───────────────────────────────────────────────────────────────────
def run(df_slice, cand):
    params = {k: v for k, v in cand.items() if k != 'label'}
    equity, trades = run_next_bar_strategy(df_slice.copy(), **params, **FIXED)
    if not trades:
        return dict(equity=1000.0, n_trades=0, win_rate=0.0,
                    max_dd=0.0, avg_ret=0.0, profitable=False)
    rets = [t['exit_price']/t['entry_price'] - 1.0 - 2*FIXED['fee'] for t in trades]
    wins = sum(1 for r in rets if r > 0)
    eq_series = [1000.0] + [t['equity'] for t in trades]
    peak, max_dd = eq_series[0], 0.0
    for eq in eq_series:
        peak = max(peak, eq)
        max_dd = max(max_dd, (peak - eq) / peak * 100.0)
    return dict(
        equity    = round(equity, 4),
        n_trades  = len(trades),
        win_rate  = round(wins / len(trades) * 100, 1),
        max_dd    = round(max_dd, 3),
        avg_ret   = round(sum(rets)/len(rets)*100, 4),
        profitable= equity > 1000.0,
    )

# ── dataset ───────────────────────────────────────────────────────────────────
with open(CSV_PATH, "rb") as f:
    md5 = hashlib.md5(f.read()).hexdigest()

df = pd.read_csv(CSV_PATH)
N  = len(df)

print(f"Dataset: {N} bars  MD5={md5}")
print(f"Window:  IS={IS_BARS}  OOS={OOS_BARS}  step={STEP}  anchored={ANCHORED}\n")

# ── folds ─────────────────────────────────────────────────────────────────────
folds = []
oos_start = IS_BARS
while oos_start + OOS_BARS <= N:
    is_start  = 0 if ANCHORED else oos_start - IS_BARS
    folds.append((is_start, oos_start, oos_start, oos_start + OOS_BARS))
    oos_start += STEP

print(f"Folds: {len(folds)}")
for fi, (is0, is1, oos0, oos1) in enumerate(folds, 1):
    print(f"  Fold {fi}: IS=[{is0}:{is1}] ({is1-is0} bars)  "
          f"OOS=[{oos0}:{oos1}] ({oos1-oos0} bars)")

# ── run ───────────────────────────────────────────────────────────────────────
rows = []

header = (f"\n{'Fold':>5}  {'Candidate':<22}  "
          f"{'IS_eq':>8}  {'IS_tr':>5}  "
          f"{'OOS_eq':>8}  {'OOS_tr':>5}  {'OOS_wr%':>7}  "
          f"{'OOS_dd%':>7}  {'OOS_pnl%':>9}  {'profit?':>7}")
print(header)
print("─" * len(header))

for fi, (is0, is1, oos0, oos1) in enumerate(folds, 1):
    df_is  = df.iloc[is0:is1].reset_index(drop=True)
    df_oos = df.iloc[oos0:oos1].reset_index(drop=True)

    for cand in CANDIDATES:
        is_m  = run(df_is,  cand)
        oos_m = run(df_oos, cand)

        oos_pnl = (oos_m['equity'] - 1000.0) / 10.0  # % of initial

        row = dict(
            fold         = fi,
            label        = cand['label'],
            is_start     = is0, is_end = is1,
            oos_start    = oos0, oos_end = oos1,
            is_equity    = is_m['equity'],
            is_trades    = is_m['n_trades'],
            oos_equity   = oos_m['equity'],
            oos_trades   = oos_m['n_trades'],
            oos_win_rate = oos_m['win_rate'],
            oos_max_dd   = oos_m['max_dd'],
            oos_avg_ret  = oos_m['avg_ret'],
            oos_profitable = oos_m['profitable'],
        )
        rows.append(row)

        print(f"{fi:>5}  {cand['label']:<22}  "
              f"{is_m['equity']:>8.2f}  {is_m['n_trades']:>5}  "
              f"{oos_m['equity']:>8.2f}  {oos_m['n_trades']:>5}  "
              f"{oos_m['win_rate']:>7.1f}  {oos_m['max_dd']:>7.3f}  "
              f"{oos_pnl:>+9.2f}%  {'YES' if oos_m['profitable'] else 'no':>7}")

# ── summary ───────────────────────────────────────────────────────────────────
out = pd.DataFrame(rows)
out.to_csv("walk_forward_results.csv", index=False)

print("\n── OOS summary per candidate ──")
print(f"{'Candidate':<22}  {'folds':>5}  {'profit_rate':>11}  "
      f"{'mean_OOS_eq':>12}  {'mean_OOS_tr':>11}  {'mean_OOS_dd':>11}")

for label, g in out.groupby('label', sort=False):
    profit_rate = g['oos_profitable'].mean() * 100
    print(f"{label:<22}  {len(g):>5}  {profit_rate:>10.0f}%  "
          f"{g['oos_equity'].mean():>12.2f}  "
          f"{g['oos_trades'].mean():>11.1f}  "
          f"{g['oos_max_dd'].mean():>11.3f}%")

print(f"\nSaved walk_forward_results.csv  ({len(rows)} rows)")
