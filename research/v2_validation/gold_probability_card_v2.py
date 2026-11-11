#!/usr/bin/env python3
"""
GOLD PROBABILITY CARD V2: candles + patterns (W/M/N) context ke saath.
Sirf wahi features jo entry (22:00 UTC) se PEHLE pata thi. Walk-forward test se tay hota hai ki unka fayda hai ya nahi.
Folder mein chahiye: trishika_gold_validation_v2.py, gold_probability_card.py, patterns_lib.py
Usage: python gold_probability_card_v2.py --csv a.csv --csv b.csv
"""
import argparse, os, importlib.util
import numpy as np, pandas as pd
import patterns_lib as PL
HERE = os.path.dirname(os.path.abspath(__file__))
def _imp(name, f):
    s = importlib.util.spec_from_file_location(name, os.path.join(HERE, f)); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
v2 = _imp("v2", "trishika_gold_validation_v2.py"); v1 = _imp("v1", "gold_probability_card.py")

def ohlc(df, rule, offset=None):
    x = df.set_index("timestamp")[["open", "high", "low", "close"]]
    return x.resample(rule, offset=offset).agg(dict(open="first", high="max", low="min", close="last")).dropna()

def clean(df): return df[~((df.high == df.low) & (df.open == df.close))].reset_index(drop=True)

def cl(b): rng = (b.high - b.low).replace(0, np.nan); return ((b.close - b.low) / rng)

def pattern_flags(bars, width):
    """Har bar ke baad (uske close par) kaunsa pattern signal bana; time = bar close."""
    out = {}
    for fam, det in (("MW", PL.detect), ("N", PL.detect_n)):
        sigs, _ = det(bars)
        for i, dirn, kind, *_ in sigs: out.setdefault(kind, []).append(bars.index[i] + width)
    return {k: pd.DatetimeIndex(v) for k, v in out.items()}

def features(df, entries):
    """entries = raat ke entry timestamps (UTC, naive). Sab features entry se pehle ke bars se."""
    d4 = ohlc(df, "4h"); d1 = ohlc(df, "24h", offset="22h")
    F = pd.DataFrame(index=entries)
    d1c = d1.copy(); d1c["cl"] = cl(d1c); d1c["body"] = (d1c.close - d1c.open) / (d1c.high - d1c.low).replace(0, np.nan)
    d1c["end"] = d1c.index + pd.Timedelta("24h"); d1c = d1c.set_index("end")
    d4c = d4.copy(); d4c["cl"] = cl(d4c); d4c["end"] = d4c.index + pd.Timedelta("4h"); d4c = d4c.set_index("end")
    def last(frame, col, k=1):
        s = frame[col].shift(k - 1)
        return s.reindex(entries, method="ffill").values
    F["cl_day"] = last(d1c, "cl"); F["body_day"] = last(d1c, "body"); F["cl_4h"] = last(d4c, "cl")
    ret1 = np.sign(d1c.close - d1c.open); streak = ret1.groupby((ret1 != ret1.shift()).cumsum()).cumcount() + 1; streak = streak * ret1
    F["streak"] = streak.reindex(entries, method="ffill").values
    hi = d1c.high.rolling(20).max(); lo = d1c.low.rolling(20).min(); atr = (d1c.high - d1c.low).rolling(14).mean()
    F["donch"] = ((d1c.close - lo) / (hi - lo).replace(0, np.nan)).reindex(entries, method="ffill").values
    F["extreme_hi"] = (F.cl_day > 0.95).astype(float); F["extreme_lo"] = (F.cl_day < 0.05).astype(float)
    # pattern flags (24h / 3 din ke andar)
    p4 = pattern_flags(d4, pd.Timedelta("4h")); p1 = pattern_flags(d1, pd.Timedelta("24h"))
    for tag, P, win in (("4h", p4, pd.Timedelta("24h")), ("1D", p1, pd.Timedelta("72h"))):
        for kind in ("FULL_W", "HALF_W", "FULL_N", "HALF_N", "HALF_IN", "FULL_IN", "FULL_M", "HALF_M"):
            ts = P.get(kind, pd.DatetimeIndex([])); ts = np.sort(ts.values)
            pos = np.searchsorted(ts, entries.values, side="right"); lastt = np.where(pos > 0, ts[np.maximum(pos - 1, 0)] if len(ts) else entries.values, np.datetime64("NaT"))
            if len(ts): F[f"{kind}_{tag}"] = ((entries.values - lastt) <= np.timedelta64(int(win.total_seconds()), "s")) & (pos > 0)
            else: F[f"{kind}_{tag}"] = False
            F[f"{kind}_{tag}"] = F[f"{kind}_{tag}"].astype(float)
    return F

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--csv", action="append", required=True)
    ap.add_argument("--cost-bp", type=float, default=1.5); ap.add_argument("--first-test-year", type=int, default=2013)
    ap.add_argument("--out", default="gold_probability_v2_report.md"); a = ap.parse_args(); L = []
    def P(s=""): print(s); L.append(s)
    df = clean(pd.concat([v2.load(p) for p in a.csv]).drop_duplicates("timestamp").sort_values("timestamp"))
    base = v1.build(df, v2); net = base.ret - a.cost_bp
    ent = pd.DatetimeIndex([x.tz_localize(None) if x.tzinfo else x for x in base.index]) + pd.Timedelta(hours=22)
    dfn = df.copy(); dfn["timestamp"] = dfn["timestamp"].dt.tz_localize(None)
    F = features(dfn, ent); F.index = base.index
    y = (net > 0).astype(float).values; yrs = base.index.year.values
    ctx = ["prev_night", "mean20", "vol20", "prev_day"]
    X0 = np.c_[base[ctx].values, base.dow.values == 0, base.dow.values == 2, base.dow.values == 6].astype(float)
    candle_cols = ["cl_day", "body_day", "cl_4h", "streak", "donch", "extreme_hi", "extreme_lo"]
    pat_cols = [c for c in F.columns if any(c.startswith(k) for k in ("FULL_", "HALF_"))]
    sets = {"A: base rate": None, "B: sirf purana context": X0,
            "C: + candles": np.c_[X0, F[candle_cols].fillna(0.5).values],
            "D: + patterns (W/M/N)": np.c_[X0, F[pat_cols].values],
            "E: + candles + patterns": np.c_[X0, F[candle_cols].fillna(0.5).values, F[pat_cols].values]}
    P("# GOLD PROBABILITY CARD V2 - candles + patterns\n")
    P(f"Raatein: {len(base)} ({base.index.min().date()} -> {base.index.max().date()}), cost {a.cost_bp}bp, win = net>0\n")
    P("## 1. Walk-forward (har saal sirf pichle saalon se seekha)")
    P(f"{'Model':28} {'Brier':>8} {'AUC':>6} {'test years AUC>0.5':>20}")
    res = {}
    for name, X in sets.items():
        pr = np.full(len(y), np.nan)
        for yr in range(a.first_test_year, yrs.max() + 1):
            tr, te = yrs < yr, yrs == yr
            if tr.sum() < 500 or te.sum() == 0: continue
            pr[te] = y[tr].mean() if X is None else v1.logit_pred(v1.logit_fit(X[tr], y[tr], l2=20.0), X[te])
        ok = ~np.isnan(pr); br = np.mean((pr[ok] - y[ok]) ** 2)
        au = v1.auc(y[ok], pr[ok]) if X is not None else 0.5
        ya = [v1.auc(y[ok & (yrs == yr)], pr[ok & (yrs == yr)]) for yr in sorted(set(yrs[ok]))] if X is not None else []
        good = f"{sum(1 for x in ya if x > .5)}/{len(ya)}" if ya else "-"
        res[name] = (br, au, pr); P(f"{name:28} {br:8.4f} {au:6.3f} {good:>20}")
    P("\n  Brier jitna kam utna behtar. AUC 0.50 = koi jaankari nahi; 0.55+ halki; 0.60+ achhi.")
    # 2. single feature effect
    P("\n## 2. Har candle/pattern flag ka akela asar (jab flag ON tha, raat ka net bp)")
    rows = []
    for c in candle_cols[-2:] + pat_cols:
        m = F[c].values > 0
        if m.sum() >= 40:
            r = net[m]; t = v2.hac_tstat(r.values)[0]; rows.append((c, int(m.sum()), r.mean(), net[~m].mean(), (r > 0).mean() * 100, t))
    T = pd.DataFrame(rows, columns=["flag", "n", "net_bp_ON", "net_bp_OFF", "win%_ON", "t_ON"]).sort_values("t_ON", ascending=False)
    P(T.round(2).to_string(index=False))
    P(f"\n  Yaad rakhein: {len(T)} flags test hue; 5% par Bonferroni ke baad |t| >= {3.0 if len(T) < 40 else 3.3} chahiye (neeche ke naam se ek-do hi zyada se zyada).")
    best = max((k for k in res if k[0] in "CDE"), key=lambda k: res[k][1]); bb, ba, _ = res[best]
    base_b = res["B: sirf purana context"][0]
    useful = ba >= 0.55 and bb < base_b - 0.001
    P("\n## 3. Faisla")
    P(f"  Sabse achha candle/pattern model: {best}  (AUC {ba:.3f}, Brier {bb:.4f})")
    P("  " + ("Candles/patterns se andaza MAAMULI behtar hua - phir bhi isse 'signal' nahi, 'halka tilt' samjhein." if useful else "Candles/patterns jodne se andaza KAAM LAYAK behtar NAHI hua. Base rate (54%) hi sabse sachcha number hai."))
    open(a.out, "w").write("\n".join(L)); print("\nReport:", a.out)
if __name__ == "__main__": main()
