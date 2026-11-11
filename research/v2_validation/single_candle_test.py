#!/usr/bin/env python3
"""
SINGLE CANDLE TEST: ek candle bante hi uske baad agli candle (turant execution: next open -> next close) kya karti hai.
Shapes: close extreme, marubozu, hammer, shooting star, doji, big up/down. Drift hataya hua (baseline minus).
Usage: python single_candle_test.py --asset XAU:cost1.5:flat a.csv b.csv --asset BTC:cost8 btc.csv ...
"""
import argparse, math
import numpy as np, pandas as pd

def load(paths, flat):
    df = pd.concat([pd.read_csv(p) for p in paths]); df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.drop_duplicates("timestamp").sort_values("timestamp").set_index("timestamp")[["open", "high", "low", "close"]].astype(float)
    if flat: df = df[~((df.high == df.low) & (df.open == df.close))]
    return df

def rs(d, rule):
    b = d.resample(rule).agg(dict(open="first", high="max", low="min", close="last")).dropna(); return b[b.high > b.low]

def shapes(b):
    O, H, L, C = (b[c].values for c in ("open", "high", "low", "close")); rng = H - L
    body = np.abs(C - O); cl = (C - L) / rng; up = H - np.maximum(O, C); lo = np.minimum(O, C) - L
    atr = pd.Series(rng).rolling(14).mean().shift(1).values   # pichle 14 candles ka average range (look-ahead nahi)
    big = rng > 2 * atr
    S = {"close_top(>=95%)": cl >= .95, "close_bottom(<=5%)": cl <= .05,
         "bull_marubozu": (C > O) & (body >= .8 * rng), "bear_marubozu": (C < O) & (body >= .8 * rng),
         "hammer": (lo >= 2 * body) & (up <= .25 * rng) & (body > 0) & (cl > .6),
         "shooting_star": (up >= 2 * body) & (lo <= .25 * rng) & (body > 0) & (cl < .4),
         "doji": body <= .1 * rng, "big_up(>2ATR)": big & (C > O), "big_down(>2ATR)": big & (C < O)}
    return S, atr

def t_of(x): x = np.asarray(x, float); return x.mean() / (x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 20 and x.std() > 0 else np.nan

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--asset", action="append", nargs="+", required=True)
    ap.add_argument("--tfs", default="1h,2h,4h,8h,1D"); ap.add_argument("--out", default="single_candle_report.md"); a = ap.parse_args(); L = []
    def P(s=""): print(s); L.append(s)
    rows = []; vol = []
    for spec in a.asset:
        name, *opts = spec[0].split(":"); cost = float([o[4:] for o in opts if o.startswith("cost")][0]); flat = "flat" in opts
        d = load(spec[1:], flat)
        for tf in a.tfs.split(","):
            b = rs(d, tf.replace("1D", "24h")); O, H, L_, C = (b[c].values for c in ("open", "high", "low", "close")); n = len(b)
            S, atr = shapes(b)
            nxt = (C[1:] / O[1:] - 1) * 1e4; nxt = np.r_[nxt, np.nan]       # agli candle open->close
            nrng = np.r_[(H[1:] - L_[1:]) / np.where(atr[1:] > 0, atr[1:], np.nan), np.nan]
            base = np.nanmean(nxt); idx = b.index
            for k, m in S.items():
                m = m & ~np.isnan(nxt) & ~np.isnan(atr); r = nxt[m]
                if len(r) < 40: continue
                dev = r.mean() - base; h = len(r) // 2
                d1, d2 = r[:h].mean() - base, r[h:].mean() - base
                tt = t_of(r - base) if False else (dev / (r.std(ddof=1) / math.sqrt(len(r))))
                rows.append((name, tf, k, len(r), dev, tt, d1, d2, abs(dev) - cost, np.nanmean(nrng[m])))
    R = pd.DataFrame(rows, columns=["asset", "tf", "shape", "n", "dev_bp", "t", "half1", "half2", "edge_after_cost", "next_range_xATR"])
    tests = len(R); bonf = 1.96 if tests < 2 else abs(__import__("statistics").NormalDist().inv_cdf(1 - 0.025 / tests))
    P("# SINGLE CANDLE TEST - candle ke turant baad kya hota hai\n")
    P(f"Tests: {tests}. 5% par chance se |t|>2 ke ~{int(tests*0.05)} aane chahiye; Bonferroni cutoff |t| >= {bonf:.2f}.")
    P(f"Actual |t|>2: {(R.t.abs()>2).sum()}, |t|>{bonf:.1f}: {(R.t.abs()>=bonf).sum()}\n")
    P("## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche")
    P("## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)")
    show = R.reindex(R.t.abs().sort_values(ascending=False).index).head(18).copy(); show["same_dir_halves"] = np.sign(show.half1) == np.sign(show.half2)
    P(show.round(2).to_string(index=False))
    P("\n## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)")
    for k, g in R.groupby("shape"):
        sgn = 1 if any(x in k for x in ("top", "bull", "hammer", "big_up")) else (-1 if any(x in k for x in ("bottom", "bear", "shooting", "big_down")) else 0)
        if sgn: P(f"  {k:20} candle disha {'UP' if sgn>0 else 'DOWN'}: agli candle mein {sgn*g.dev_bp.mean():+.2f}bp (+ = continuation, - = reversal) | {int((np.sign(g.dev_bp)==sgn).sum())}/{len(g)} cells mein continuation")
    P("\n## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza")
    P(R.groupby("shape").next_range_xATR.mean().round(2).sort_values(ascending=False).to_string())
    P("  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)")
    open(a.out, "w").write("\n".join(L)); R.to_csv(a.out.replace(".md", ".csv"), index=False); print("\nReport:", a.out)
if __name__ == "__main__": main()
