"""
Parameter sweep over the frozen production engine.
Outputs: sweep_results.csv  (keyed by param tuple + dataset MD5)

Engine: test_next_bar_strategy.run_next_bar_strategy
Fixed:  fee=0.0015, compounding=True, next_open_exit=False,
        chandelier=False, initial_equity=1000.0
Grid:   donchian_len x atr_len x atr_mult
"""

import hashlib
import itertools
import pandas as pd
from test_next_bar_strategy import run_next_bar_strategy

# ── dataset ───────────────────────────────────────────────────────────────────
CSV_PATH = "./data/ETHUSDT_1d_1000.csv"

with open(CSV_PATH, "rb") as f:
    CSV_MD5 = hashlib.md5(f.read()).hexdigest()

df_base = pd.read_csv(CSV_PATH)

# ── grid ──────────────────────────────────────────────────────────────────────
DONCHIAN_LENS = [5, 8, 10, 12, 15, 20, 25, 30]
ATR_LENS      = [7, 10, 14, 20, 25, 30]
ATR_MULTS     = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]

FIXED = dict(
    fee            = 0.0015,
    compounding    = True,
    next_open_exit = False,
    chandelier     = False,
    ratchet        = True,
    initial_equity = 1000.0,
    fixed_notional = 1000.0,
)

# ── metrics ───────────────────────────────────────────────────────────────────
def compute_metrics(equity_curve, trades, initial=1000.0):
    if not trades:
        return dict(final_eq=initial, n_trades=0, win_rate=0.0,
                    avg_ret=0.0, max_dd=0.0, sharpe_proxy=0.0)

    rets = []
    for t in trades:
        gross = t['exit_price'] / t['entry_price'] - 1.0
        rets.append(gross - 2 * FIXED['fee'])

    wins     = sum(1 for r in rets if r > 0)
    win_rate = wins / len(rets) * 100.0
    avg_ret  = sum(rets) / len(rets) * 100.0

    # max drawdown over equity snapshots
    eq_series = [initial] + [t['equity'] for t in trades]
    peak = eq_series[0]
    max_dd = 0.0
    for eq in eq_series:
        peak  = max(peak, eq)
        dd    = (peak - eq) / peak * 100.0
        max_dd = max(max_dd, dd)

    # Sharpe proxy: mean(rets) / std(rets)  (no risk-free rate)
    if len(rets) > 1:
        import statistics
        sharpe = (sum(rets)/len(rets)) / (statistics.stdev(rets) + 1e-12)
    else:
        sharpe = 0.0

    return dict(
        final_eq     = round(eq_series[-1], 4),
        n_trades     = len(trades),
        win_rate     = round(win_rate, 2),
        avg_ret      = round(avg_ret, 4),
        max_dd       = round(max_dd, 4),
        sharpe_proxy = round(sharpe, 4),
    )

# ── sweep ─────────────────────────────────────────────────────────────────────
grid    = list(itertools.product(DONCHIAN_LENS, ATR_LENS, ATR_MULTS))
total   = len(grid)
results = []

print(f"Sweeping {total} combinations on {CSV_PATH}  MD5={CSV_MD5}")
print(f"{'#':>5}  {'don':>4}  {'atr_l':>5}  {'mult':>5}  "
      f"{'eq':>9}  {'trades':>7}  {'wr%':>6}  {'avgret%':>8}  "
      f"{'maxdd%':>7}  {'sharpe':>7}")

for k, (don, atr_l, mult) in enumerate(grid, 1):
    equity, trades = run_next_bar_strategy(
        df_base.copy(),
        donchian_len = don,
        atr_len      = atr_l,
        atr_mult     = mult,
        **FIXED,
    )
    m = compute_metrics(None, trades)

    row = dict(
        donchian_len = don,
        atr_len      = atr_l,
        atr_mult     = mult,
        csv_md5      = CSV_MD5,
        **m,
    )
    results.append(row)

    if k % 20 == 0 or k == total:
        print(f"{k:>5}  {don:>4}  {atr_l:>5}  {mult:>5.1f}  "
              f"{m['final_eq']:>9.2f}  {m['n_trades']:>7}  "
              f"{m['win_rate']:>6.1f}  {m['avg_ret']:>8.4f}  "
              f"{m['max_dd']:>7.3f}  {m['sharpe_proxy']:>7.4f}")

# ── save ──────────────────────────────────────────────────────────────────────
out = pd.DataFrame(results).sort_values("final_eq", ascending=False)
out.to_csv("sweep_results.csv", index=False)

print(f"\nDone. {total} combos. Results saved to sweep_results.csv")
print("\n── Top 15 by final equity ──")
print(out.head(15).to_string(index=False))
print("\n── Top 15 by Sharpe proxy ──")
print(out.sort_values("sharpe_proxy", ascending=False).head(15).to_string(index=False))
