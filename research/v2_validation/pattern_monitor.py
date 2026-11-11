#!/usr/bin/env python3
"""
PATTERN MONITOR - abhi kya ban raha hai, aur us pattern ka purana record kya hai.
Patterns: W / half-W (long), M / half-M (short), N / half-N (long), inverted N / half-inverted-N (short)
Har pattern ke saath: poori history mein gross bp, t-stat, drift-adjusted excess, aur VERDICT.
Folder mein chahiye: patterns_lib.py, single_candle_test.py
Usage example:
 python pattern_monitor.py \
   --market "GOLD|1.5|flat|4h,1D|gold_a.csv,gold_b.csv" \
   --market "BTC|8|-|4h,1D|BTCUSDT_1h_2017_2026.csv" \
   --market "NIFTY50|4|-|1D|NIFTY50_1d.csv"
(csv: timestamp(ms),open,high,low,close; 'flat' = weekend/holiday flat bars hatao)
"""
import argparse, math
import numpy as np, pandas as pd
import patterns_lib as PL
from single_candle_test import shapes

KIND_LABEL = {"HALF_W": ("half W", "LONG"), "FULL_W": ("W (neckline break)", "LONG"), "HALF_M": ("half M", "SHORT"), "FULL_M": ("M (neckline break)", "SHORT"),
              "HALF_N": ("half N", "LONG"), "FULL_N": ("N (break)", "LONG"), "HALF_IN": ("half inverted N", "SHORT"), "FULL_IN": ("inverted N (break)", "SHORT")}
def tt(x):
    x = np.asarray(x, float); x = x[~np.isnan(x)]
    return x.mean() / (x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 20 and x.std() > 0 else np.nan

def bars(paths, flat, tf):
    df = pd.concat([pd.read_csv(p) for p in paths]); df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.drop_duplicates("timestamp").sort_values("timestamp").set_index("timestamp")[["open", "high", "low", "close"]].astype(float)
    if flat: df = df[~((df.high == df.low) & (df.open == df.close))]
    if flat: df = df[df.index.dayofweek < 5]          # 'flat' = weekend/holiday wale market (gold, India)
    b = df.resample("24h" if tf == "1D" else tf).agg(dict(open="first", high="max", low="min", close="last")).dropna()
    return b[b.high > b.low]

def analyse(name, cost, flat, tf, paths, lookback):
    b = bars(paths, flat, tf); n = len(b); O, C = b.open.values, b.close.values
    sigs, At = [], None
    for det in (PL.detect, PL.detect_n):
        s, At = det(b); sigs += s
    r = PL.evaluate(b, sigs, At)
    idx = np.arange(0, n - PL.HOLD - 2); idx = idx[(~np.isnan(At[idx])) & (At[idx] > 0)]
    base = {d: np.mean(d * (C[idx + PL.HOLD] - O[idx + 1]) / At[idx]) for d in (1, -1)}
    r["excess"] = r.R4 - r.dir.map(base)
    rec = {}
    for k, g in r.groupby("kind"):
        h1, h2 = g[g.frac < .5].bp4.mean(), g[g.frac >= .5].bp4.mean(); gross = g.bp4.mean(); t = tt(g.bp4); te = tt(g.excess)
        if len(g) < 30: v = "DATA KAM"
        elif gross - cost > 0 and t >= 2 and te >= 2 and h1 > 0 and h2 > 0: v = "HALKA HINT (paper trading ke layak, trade nahi)"
        elif t <= -2: v = "ULTA ASAR (pattern ke khilaf chalta hai)"
        else: v = "KOI SAAF EDGE NAHI"
        rec[k] = dict(n=len(g), gross=gross, net=gross - cost, t=t, te=te, h1=h1, h2=h2, verdict=v)
    # taza signals (pichli `lookback` candles mein bane)
    recent = [(b.index[i], d, kind, stop, tgt) for i, d, kind, stop, tgt in sigs if i >= n - lookback]
    S, atr = shapes(b); last = {k: bool(v[-1]) for k, v in S.items()}
    return b, rec, recent, last, atr

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--market", action="append", required=True); ap.add_argument("--lookback", type=int, default=3)
    ap.add_argument("--out", default="pattern_monitor_report.md"); a = ap.parse_args(); L = []
    def P(s=""): print(s); L.append(s)
    P("# PATTERN MONITOR - abhi kya ban raha hai\n")
    P("Yaad rakhein: ye 'kya ban raha hai' ki soochna hai. VERDICT purani history ka record hai, signal nahi. Koi bhi pattern guarantee nahi.\n")
    for spec in a.market:
        name, cost, flat, tfs, paths = spec.split("|"); cost = float(cost); flat = flat == "flat"
        for tf in tfs.split(","):
            b, rec, recent, last, atr = analyse(name, cost, flat, tf, paths.split(","), a.lookback)
            P(f"## {name} {tf}  (latest bar: {b.index[-1]}, close {b.close.iloc[-1]:,.2f}, data {b.index[0].date()} se, {len(b)} bars)")
            rg = (b.high.iloc[-1] - b.low.iloc[-1]) / atr[-1] if not np.isnan(atr[-1]) else np.nan
            on = [k for k, v in last.items() if v]
            P(f"  Aakhri candle: {'upar' if b.close.iloc[-1] > b.open.iloc[-1] else 'neeche'} band | shape: {', '.join(on) if on else 'koi khaas shape nahi'} | size {rg:.1f}x ATR" + (" (BADI candle - agli candle bhi zyada hil sakti hai)" if rg > 2 else ""))
            if recent:
                P(f"  >>> PICHLI {a.lookback} CANDLES MEIN BANE PATTERNS:")
                for t, d, kind, stop, tgt in recent:
                    lab, side = KIND_LABEL[kind]; R = rec.get(kind)
                    P(f"     {t}  {lab} ({side} wala pattern) | stop {stop:,.2f} | target {tgt:,.2f}")
                    if R: P(f"        History: n={R['n']}, gross {R['gross']:+.1f}bp, cost ke baad {R['net']:+.1f}bp (t={R['t']:+.1f}, drift-adjusted t={R['te']:+.1f}, halves {R['h1']:+.0f}/{R['h2']:+.0f}) -> {R['verdict']}")
            else: P(f"  Pichli {a.lookback} candles mein koi naya W/M/N pattern nahi bana.")
            P("  Pattern-wise record (poori history, hold 4 bars):")
            for k in ("HALF_W", "FULL_W", "HALF_M", "FULL_M", "HALF_N", "FULL_N", "HALF_IN", "FULL_IN"):
                R = rec.get(k)
                if R: P(f"     {KIND_LABEL[k][0]:20} {KIND_LABEL[k][1]:5} n={R['n']:5d} net {R['net']:+7.1f}bp t={R['t']:+4.1f}  {R['verdict']}")
            P()
    open(a.out, "w").write("\n".join(L)); print("Report:", a.out)
if __name__ == "__main__": main()
