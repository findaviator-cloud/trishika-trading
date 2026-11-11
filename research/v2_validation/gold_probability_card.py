#!/usr/bin/env python3
"""
GOLD OVERNIGHT PROBABILITY CARD
Har raat (entry ~22:00 UTC, exit 04:00 UTC) ke liye: P(up), P(flat), P(down), expected move, range,
aur walk-forward check ki conditioning se base rate se behtar andaza milta hai ya nahi.
Usage: python gold_probability_card.py --csv a.csv [--csv b.csv ...] --cost-bp 1.5 --flat-bp 2
"""
import argparse, math, importlib.util, os
import numpy as np, pandas as pd

def load_v2():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trishika_gold_validation_v2.py")
    spec = importlib.util.spec_from_file_location("v2", p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def build(df, v2, entry="22:00", exit_="04:00", tol=90):
    df = df[~((df.high == df.low) & (df.open == df.close))].reset_index(drop=True)
    r = v2.overnight_returns(df, entry, exit_, tol_min=tol)
    # daily context: pichle 24h ka move aur volatility (entry se pehle ka data hi)
    px = df.set_index("timestamp")["close"]
    d = pd.DataFrame({"ret": r})
    d["dow"] = d.index.dayofweek
    d["prev_night"] = d["ret"].shift(1)
    d["mean20"] = d["ret"].rolling(20).mean().shift(1)
    d["vol20"] = d["ret"].rolling(20).std().shift(1)
    # pichla 24h ka move: entry (22:00 UTC) se pehle tak ke bins (22:00 -> 22:00), weekend par pichla available
    px2 = px.copy(); px2.index = px2.index.tz_convert("UTC").tz_localize(None)
    dd = (px2.resample("24h", offset="22h").last().dropna().pct_change() * 1e4)
    ent = pd.DatetimeIndex([x.tz_localize(None) if x.tzinfo else x for x in d.index]) + pd.Timedelta(hours=22) - pd.Timedelta(hours=24)
    d["prev_day"] = dd.reindex(ent, method="ffill").values
    return d.dropna()

def logit_fit(X, y, l2=5.0, it=300):
    mu, sd = X.mean(0), X.std(0) + 1e-9; Z = (X - mu) / sd; Z = np.c_[np.ones(len(Z)), Z]
    w = np.zeros(Z.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-Z @ w)); g = Z.T @ (p - y) / len(y) + l2 / len(y) * np.r_[0, w[1:]]
        H = (Z.T * (p * (1 - p))) @ Z / len(y) + l2 / len(y) * np.diag(np.r_[0, np.ones(len(w) - 1)])
        w -= np.linalg.solve(H + 1e-6 * np.eye(len(w)), g)
    return mu, sd, w

def logit_pred(m, X):
    mu, sd, w = m; Z = np.c_[np.ones(len(X)), (X - mu) / sd]; return 1 / (1 + np.exp(-Z @ w))

def auc(y, p):
    o = np.argsort(p); r = np.empty(len(p)); r[o] = np.arange(1, len(p) + 1)
    n1 = y.sum(); n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0) if n1 and n0 else np.nan

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", action="append", required=True)
    ap.add_argument("--cost-bp", type=float, default=1.5)
    ap.add_argument("--flat-bp", type=float, default=2.0, help="|move| is se kam = flat")
    ap.add_argument("--first-test-year", type=int, default=2013)
    ap.add_argument("--out", default="gold_probability_report.md")
    a = ap.parse_args(); v2 = load_v2(); L = []
    def P(s=""): print(s); L.append(s)
    frames = [v2.load(p) for p in a.csv]
    df = pd.concat(frames).drop_duplicates("timestamp").sort_values("timestamp")
    d = build(df, v2)
    net = d["ret"] - a.cost_bp
    P("# GOLD OVERNIGHT PROBABILITY CARD\n")
    P(f"Raatein: {len(d)}  ({d.index.min().date()} -> {d.index.max().date()}), flat = |move| < {a.flat_bp}bp, cost {a.cost_bp}bp\n")

    # 1. Base rates
    up = (d.ret > a.flat_bp).mean(); dn = (d.ret < -a.flat_bp).mean(); fl = 1 - up - dn
    P("## 1. Base rate (poori history)")
    P(f"  UP {up*100:.1f}%  |  FLAT {fl*100:.1f}%  |  DOWN {dn*100:.1f}%")
    q = d.ret.quantile([.05, .25, .5, .75, .95]).round(1)
    P(f"  Move percentiles (bp): 5%={q[.05]}, 25%={q[.25]}, median={q[.5]}, 75%={q[.75]}, 95%={q[.95]}")
    P(f"  Mean {d.ret.mean():+.2f}bp, net of cost {net.mean():+.2f}bp, trade jeetne ka chance (net>0): {(net>0).mean()*100:.1f}%\n")

    # 2. Walk-forward: kya context base rate se behtar batata hai?
    P("## 2. Walk-forward test: context se andaza behtar hota hai ya nahi?")
    feats = ["dow", "prev_night", "mean20", "vol20", "prev_day"]
    X = d[feats].values.astype(float); X = np.c_[X[:, 1:], (X[:, 0] == 0), (X[:, 0] == 2), (X[:, 0] == 6)]
    y = (net > 0).astype(float).values
    yrs = d.index.year.values; pr = np.full(len(d), np.nan); base = np.full(len(d), np.nan)
    for yr in range(a.first_test_year, yrs.max() + 1):
        tr = yrs < yr; te = yrs == yr
        if tr.sum() < 500 or te.sum() == 0: continue
        pr[te] = logit_pred(logit_fit(X[tr], y[tr]), X[te]); base[te] = y[tr].mean()
    ok = ~np.isnan(pr); yy = y[ok]
    brier_m = np.mean((pr[ok] - yy) ** 2); brier_b = np.mean((base[ok] - yy) ** 2)
    P(f"  Test nights: {ok.sum()} (har saal sirf pichle saalon se seekha)")
    P(f"  Brier score: model {brier_m:.4f} vs sirf base-rate {brier_b:.4f}  (model kam ho tabhi context kaam ka)")
    P(f"  AUC: {auc(yy, pr[ok]):.3f}  (0.50 = koi jaankari nahi, 0.55+ = halki, 0.60+ = achhi)")
    bins = pd.cut(pr[ok], [0, .45, .50, .55, .60, 1]); t = pd.DataFrame({"p": pr[ok], "y": yy, "b": bins}).groupby("b", observed=True).agg(nights=("y", "size"), predicted=("p", "mean"), actual=("y", "mean")).round(3)
    P("\n  Calibration (predicted vs actual jeetne ka chance):"); P(t.to_string())
    useful = brier_m < brier_b - 0.0005 and auc(yy, pr[ok]) > 0.53
    P(f"\n  Nateeja: {'context HALKI madad karta hai' if useful else 'context se KOI saaf fayda nahi - base rate hi sabse sachcha andaza hai'}\n")

    # 3. Aaj raat ka card
    P("## 3. Aaj raat ka card (latest data ke hisaab se)")
    last = d.iloc[-1]; P(f"  Aakhri raat ({d.index[-1].date()}): {last.ret:+.1f}bp | pichle 20 raat ka mean {last.mean20:+.1f}bp | vol {last.vol20:.1f}bp")
    m = logit_fit(X, y); p_ctx = float(logit_pred(m, X[-1:])[0])
    p_use = p_ctx if useful else float((net > 0).mean())
    P(f"  P(trade net jeete) = {p_use*100:.0f}%   ({'context-adjusted' if useful else 'base rate'})")
    P(f"  P(UP) ~{up*100:.0f}% | P(FLAT) ~{fl*100:.0f}% | P(DOWN) ~{dn*100:.0f}%")
    P(f"  Typical range (50% raatein): {q[.25]:+.0f} se {q[.75]:+.0f}bp; kharab raat (5%): {q[.05]:+.0f}bp\n")

    # 4. Reverse (put side) sach mein kaam karega?
    P("## 4. Reverse (short / put) ka sach")
    sh = -d.ret - a.cost_bp
    P(f"  Long net {net.mean():+.2f}bp | Short (har raat ulta) net {sh.mean():+.2f}bp  -> short khud ek negative strategy hai (cost + drift)")
    for lbl, mask in (("jab pichli raat gir gayi thi", d.prev_night < 0), ("jab pichla din gir gaya tha", d.prev_day < 0), ("jab 20-raat ka mean negative", d.mean20 < 0)):
        s = d[mask]
        P(f"  {lbl}: n={len(s)}, long net {(s.ret - a.cost_bp).mean():+.2f}bp (t={v2.hac_tstat((s.ret - a.cost_bp).values)[0]:+.1f}), short net {(-s.ret - a.cost_bp).mean():+.2f}bp")
    P("  Agar kisi condition mein short ka net bhi positive aur t>3 na ho, to 'ulta' lagana sirf ek soch hai, edge nahi.\n")

    # 5. Sizing
    P("## 5. Position size ka tareeka (probability ke hisaab se, chhota rakhein)")
    bad = abs(q[.05]) / 1e4
    for risk in (0.005, 0.01):
        P(f"  Agar kharab raat (5% wali, {q[.05]:+.0f}bp) mein capital ka {risk*100:.1f}% se zyada nahi khona: notional = capital ka {risk/bad*100:.0f}% (yaani ~{risk/bad:.1f}x)")
    P("  Ye maximum hai, target nahi. Paper trading mein pehle 0.25x se shuru karein. Kisi raat ka nuksaan 5% se bhi bura ho sakta hai (worst raat dekhiye neeche).")
    P(f"  Ab tak ki sabse buri raat: {d.ret.min():+.0f}bp ({d.ret.idxmin().date()}), sabse achhi: {d.ret.max():+.0f}bp")
    # 6. Volatility regime (kitna hilega) - pichli vol se agle raat ka range
    P("\n## 6. Volatility: aaj raat kitna hil sakta hai")
    d["absret"] = d.ret.abs(); tr = d.vol20.quantile([1/3, 2/3]).values
    d["regime"] = np.where(d.vol20 <= tr[0], "LOW", np.where(d.vol20 <= tr[1], "MID", "HIGH"))
    g = d.groupby("regime").ret
    tab = pd.DataFrame({"nights": g.size(), "avg_abs_bp": d.groupby("regime").absret.mean(), "5%_bad": g.quantile(.05), "95%_good": g.quantile(.95), "win%_net": d.groupby("regime").ret.apply(lambda x: ((x - a.cost_bp) > 0).mean() * 100)}).loc[["LOW", "MID", "HIGH"]].round(1)
    P(tab.to_string())
    ratio = tab.loc["HIGH", "avg_abs_bp"] / tab.loc["LOW", "avg_abs_bp"]
    P(f"  Jab pichle 20 raat ki vol HIGH thi, agli raat ka average move LOW se {ratio:.1f}x tha - vol 'kitna' batati hai, 'kis taraf' nahi (win% lagbhag ek jaisa).")
    cur = d.regime.iloc[-1]; P(f"  Abhi (pichli 20 raat ke hisaab se) regime: {cur}  -> kharab raat (5%) ka andaza {tab.loc[cur,'5%_bad']:+.0f}bp, achhi raat (95%) {tab.loc[cur,'95%_good']:+.0f}bp")
    for risk in (0.005,):
        P(f"  Is regime mein capital ka {risk*100:.1f}% se zyada na khone ke liye max notional = capital ka {risk/(abs(tab.loc[cur,'5%_bad'])/1e4)*100:.0f}%  (LOW regime mein zyada, HIGH mein kam - size vol ke hisaab se badlein)")
    day = (d.prev_day.abs() > 2 * d.prev_day.abs().rolling(250, min_periods=50).mean()).fillna(False)
    P(f"  Pichla din bada move (2x normal) tha: {day.sum()} raatein, agli raat ka avg |move| {d.absret[day].mean():.1f}bp vs normal {d.absret[~day].mean():.1f}bp ({d.absret[day].mean()/d.absret[~day].mean():.2f}x), long net {(d.ret[day]-a.cost_bp).mean():+.1f}bp vs {(d.ret[~day]-a.cost_bp).mean():+.1f}bp")
    open(a.out, "w").write("\n".join(L)); print("\nReport:", a.out)

if __name__ == "__main__": main()
