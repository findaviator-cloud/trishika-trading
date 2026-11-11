#!/usr/bin/env python3
"""
4h W/N PATTERN STRATEGY - fixed rules, Gold + BTC + ETH
Rules (pehle se tay, test dekhkar badle nahi):
  Signal : 4h bar close par FULL_W ya FULL_N (long) [patterns_lib.detect / detect_n, K=2xATR zig-zag]
  Entry  : agle 4h bar ka open
  Exit   : 4 bars (16h) baad close, ya pattern ka stop pehle lage to stop (gap ho to open par)
  Ek asset par ek hi position; cost: Gold 1.5bp, Crypto 8bp round-trip
  Train: 2022 tak | Test: 2023 se (rules ko test dekhkar mat badlein)
Usage: python pattern_strategy_backtest.py --gold a.csv --gold b.csv --btc btc.csv --eth eth.csv
"""
import argparse, os, importlib.util
import numpy as np, pandas as pd
import patterns_lib as PL
HERE = os.path.dirname(os.path.abspath(__file__))
def v2():
    s = importlib.util.spec_from_file_location("v2", os.path.join(HERE, "trishika_gold_validation_v2.py")); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

def bars4h(paths, flat):
    df = pd.concat([pd.read_csv(p) for p in paths]); df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.drop_duplicates("timestamp").sort_values("timestamp").set_index("timestamp")[["open", "high", "low", "close"]].astype(float)
    if flat: df = df[~((df.high == df.low) & (df.open == df.close))]
    b = df.resample("4h").agg(dict(open="first", high="max", low="min", close="last")).dropna()
    return b[b.high > b.low]

def trades(b, kinds, cost, hold=4, use_stop=True):
    """kinds me W/N (long) aur M/inverted-N (short) dono ho sakte hain; direction pattern se aati hai."""
    out = []; busy = -1; sigs = []
    for det in (PL.detect, PL.detect_n):
        s_, _ = det(b); sigs += [x for x in s_ if x[2] in kinds]
    sigs.sort(key=lambda x: x[0]); O, H, L, C = (b[c].values for c in ("open", "high", "low", "close")); n = len(b)
    for i, d, kind, stop, tgt in sigs:
        e = i + 1
        if e >= n - hold or e <= busy: continue
        ep = O[e]; xi = e + hold - 1; xp = C[xi]; why = "time"
        if use_stop:
            for j in range(e, e + hold):
                if d == 1 and stop < ep and L[j] <= stop: xp = min(stop, O[j]); xi = j; why = "stop"; break
                if d == -1 and stop > ep and H[j] >= stop: xp = max(stop, O[j]); xi = j; why = "stop"; break
        out.append((b.index[e], b.index[xi], kind, d * (xp / ep - 1) * 1e4 - cost, why)); busy = xi
    return pd.DataFrame(out, columns=["t_in", "t_out", "kind", "net_bp", "exit"])

def stats(t, label, v):
    if len(t) < 5: return f"{label:22} n={len(t)} (kam)"
    pf = t.net_bp[t.net_bp > 0].sum() / max(1e-9, -t.net_bp[t.net_bp < 0].sum())
    return f"{label:22} n={len(t):4d} net {t.net_bp.mean():+6.1f}bp  t={v.hac_tstat(t.net_bp.values)[0]:+4.1f}  win {np.mean(t.net_bp>0)*100:3.0f}%  PF {pf:4.2f}  stop-exits {np.mean(t.exit=='stop')*100:2.0f}%"

def main():
    ap = argparse.ArgumentParser()
    for k in ("gold", "btc", "eth"): ap.add_argument(f"--{k}", action="append", default=[])
    ap.add_argument("--split", default="2023-01-01"); ap.add_argument("--out", default="pattern_strategy_report.md"); a = ap.parse_args()
    V = v2(); L = []
    def P(s=""): print(s); L.append(s)
    A = {"GOLD": (a.gold, True, 1.5), "BTC": (a.btc, False, 8.0), "ETH": (a.eth, False, 8.0)}; A = {k: v for k, v in A.items() if v[0]}
    cut = pd.Timestamp(a.split)
    P("# 4h W/N PATTERN STRATEGY (fixed rules)\n")
    P("Entry next 4h open | exit 4 bars ya pattern stop | cost Gold 1.5bp, Crypto 8bp | W/N long, M/inv-N short\n")
    allt = {}; BARS = {nm: bars4h(paths, flat) for nm, (paths, flat, cost) in A.items()}
    VARIANTS = (("FULL W+N (long)", {"FULL_W", "FULL_N"}), ("sirf FULL_W (long)", {"FULL_W"}), ("sirf FULL_N (long)", {"FULL_N"}),
                ("HALF W+N (long)", {"HALF_W", "HALF_N"}), ("sirf HALF_W (long)", {"HALF_W"}), ("sirf HALF_N (long)", {"HALF_N"}),
                ("HALF_M (short)", {"HALF_M"}), ("FULL_M (short)", {"FULL_M"}), ("HALF inv-N (short)", {"HALF_IN"}), ("FULL inv-N (short)", {"FULL_IN"}),
                ("M ke dono (short)", {"HALF_M", "FULL_M"}), ("saare SHORT (M + inv-N)", {"HALF_M", "FULL_M", "HALF_IN", "FULL_IN"}),
                ("saare half (long+short)", {"HALF_W", "HALF_N", "HALF_M", "HALF_IN"}))
    for variant, kinds in VARIANTS:
        P(f"## Variant: {variant}")
        for nm, (paths, flat, cost) in A.items():
            t = trades(BARS[nm], kinds, cost); allt[(variant, nm)] = t
            P(stats(t[t.t_in < cut], f"{nm} TRAIN", V)); P(stats(t[t.t_in >= cut], f"{nm} TEST", V))
        tt_ = pd.concat([allt[(variant, nm)].assign(asset=nm) for nm in A]); P(stats(tt_[tt_.t_in < cut], "ALL TRAIN", V)); P(stats(tt_[tt_.t_in >= cut], "ALL TEST", V)); P()
    # Portfolio equity (W+N), equal weight 1/n har asset, notional 1x total
    P("## Portfolio (FULL W+N long): har asset ko barabar hissa, trade ka pura hissa lagta hai")
    tt_ = pd.concat([allt[("FULL W+N (long)", nm)].assign(asset=nm) for nm in A]).sort_values("t_out"); w = 1 / len(A)
    for lbl, sub in (("TRAIN", tt_[tt_.t_in < cut]), ("TEST", tt_[tt_.t_in >= cut])):
        if len(sub) < 5: continue
        r = sub.net_bp.values / 1e4 * w; eq = np.cumprod(1 + r); dd = (eq / np.maximum.accumulate(eq) - 1).min()
        yrs = (sub.t_out.max() - sub.t_in.min()).days / 365.25; cagr = eq[-1] ** (1 / max(yrs, .1)) - 1
        mon = sub.groupby(sub.t_out.dt.to_period("M")).net_bp.sum() / 1e4 * w
        P(f"{lbl}: trades {len(sub)} ({len(sub)/max(yrs,.1):.0f}/saal), saal ka return {cagr*100:+.1f}%, max drawdown {dd*100:.1f}%, worst mahina {mon.min()*100:+.1f}%, positive mahine {np.mean(mon>0)*100:.0f}%")
    P("\n## Test period saal-dar-saal (W+N, ALL, net bp per trade)")
    te = tt_[tt_.t_in >= cut]; P(te.groupby([te.t_in.dt.year, "asset"]).net_bp.agg(["count", "mean"]).round(1).unstack().to_string())
    open(a.out, "w").write("\n".join(L)); print("\nReport:", a.out)
if __name__ == "__main__": main()
