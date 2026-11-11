#!/data/data/com.termux/files/usr/bin/bash
# TRISHIKA GOLD AUDIT - ek file, ek command.
# Chalane ka tareeka:  bash ~/storage/downloads/run_gold_audit.sh
set -u
DL="$HOME/storage/downloads"
W="$HOME/gold"

if [ ! -d "$DL" ]; then
  echo "Storage permission chahiye. Popup par Allow dabaiye."
  termux-setup-storage; sleep 5
fi
[ -d "$DL" ] || { echo "ERROR: ~/storage/downloads nahi mila. 'termux-setup-storage' chalakar dobara try karein."; exit 1; }

python -c "import numpy, pandas" 2>/dev/null || { echo "Python packages install ho rahe hain..."; pkg update -y && pkg install -y python python-numpy python-pandas; }

mkdir -p "$W"
cat > "$W/trishika_gold_validation_v2.py" <<'PYEOF'
#!/usr/bin/env python3
"""
TRISHIKA GOLD EDGE VALIDATION V2
--------------------------------
Gold overnight strategy (long at ENTRY UTC, exit next day at EXIT UTC) ka audit.

Input CSV (intraday bars, UTC):
    timestamp, open, high, low, close            (required)
    bid, ask                                     (optional; agar ho to bid/ask execution use hoga)

Usage:
    python trishika_gold_validation_v2.py --csv xauusd_15m.csv
    python trishika_gold_validation_v2.py --csv a.csv --other b.csv --swap-bp 0.8 \
        --holdout-start 2023-01-01 --entry 22:00 --exit 04:00

Report: console + gold_validation_report.md
"""
import argparse
import math
import numpy as np
import pandas as pd

EULER = 0.5772156649


# ---------- helpers ----------
def norm_cdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def norm_ppf(p):
    # Acklam approximation (no scipy dependency)
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    pl = 0.02425
    if p < pl:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > 1 - pl:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def load(path):
    df = pd.read_csv(path)
    df.columns = [c.lower().strip() for c in df.columns]
    if "timestamp" not in df.columns:
        for alt in ("time", "datetime", "date", "gmt time"):
            if alt in df.columns:
                df = df.rename(columns={alt: "timestamp"})
                break
    if pd.api.types.is_numeric_dtype(df["timestamp"]):
        unit = "ms" if df["timestamp"].iloc[0] > 1e11 else "s"
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit=unit, utc=True)
    else:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df["timestamp"] = df["timestamp"].astype("datetime64[ns, UTC]")
    return df.sort_values("timestamp").reset_index(drop=True)


def hhmm(s):
    h, m = s.split(":")
    return int(h), int(m)


def overnight_returns(df, entry, exit_, tol_min=30, use_bidask=False):
    """Har date ke liye entry->next-day exit return (bp). Gap/weekend nights skip."""
    eh, em = hhmm(entry)
    xh, xm = hhmm(exit_)
    ts = df["timestamp"]
    days = pd.Series(ts.dt.normalize().unique())
    ent_t = days + pd.Timedelta(hours=eh, minutes=em)
    # exit entry ke agle din (agar exit time entry se pehle ka ho) warna usi din
    same_day = (xh, xm) > (eh, em)
    ex_t = days + pd.Timedelta(days=0 if same_day else 1, hours=xh, minutes=xm)

    left = pd.DataFrame({"date": days, "t": ent_t})
    right = pd.DataFrame({"date": days, "t": ex_t})
    tol = pd.Timedelta(minutes=tol_min)

    if use_bidask and {"bid", "ask"} <= set(df.columns):
        buy_col, sell_col = "ask", "bid"
    else:
        buy_col = sell_col = "open"

    pe = df[["timestamp", buy_col]].rename(columns={"timestamp": "t", buy_col: "entry_px"})
    px_ = df[["timestamp", sell_col]].rename(columns={"timestamp": "t", sell_col: "exit_px"})
    e = pd.merge_asof(left.sort_values("t"), pe, on="t", direction="forward", tolerance=tol)
    x = pd.merge_asof(right.sort_values("t"), px_, on="t", direction="forward", tolerance=tol)
    out = e[["date","entry_px"]].merge(x[["date","exit_px"]], on="date").dropna(subset=["entry_px", "exit_px"])
    out["ret_bp"] = (out["exit_px"] / out["entry_px"] - 1) * 1e4
    return out.set_index("date")["ret_bp"].sort_index()


def hac_tstat(x, lags=None):
    """Newey-West t-stat of mean. lags default = floor(4*(n/100)^(2/9))."""
    x = np.asarray(x, float)
    n = len(x)
    if n < 10:
        return np.nan, np.nan
    if lags is None:
        lags = int(np.floor(4 * (n / 100) ** (2 / 9)))
    u = x - x.mean()
    s = u @ u / n
    for k in range(1, lags + 1):
        w = 1 - k / (lags + 1)
        s += 2 * w * (u[k:] @ u[:-k]) / n
    se = math.sqrt(max(s, 1e-18) / n)
    t = x.mean() / se
    return t, se


def naive_tstat(x):
    x = np.asarray(x, float)
    return x.mean() / (x.std(ddof=1) / math.sqrt(len(x)))


def block_bootstrap_ci(x, n_boot=5000, block=None, seed=7):
    """Stationary bootstrap (Politis-Romano) CI of mean."""
    rng = np.random.default_rng(seed)
    x = np.asarray(x, float)
    n = len(x)
    if block is None:
        block = max(2, int(round(n ** (1 / 3))))
    p = 1.0 / block
    means = np.empty(n_boot)
    for b in range(n_boot):
        idx = np.empty(n, int)
        idx[0] = rng.integers(n)
        jumps = rng.random(n) < p
        rnd = rng.integers(n, size=n)
        for i in range(1, n):
            idx[i] = rnd[i] if jumps[i] else (idx[i - 1] + 1) % n
        means[b] = x[idx].mean()
    return np.percentile(means, [2.5, 97.5]), block


def deflated_sharpe(returns, trial_sharpes, n_trials):
    """Bailey & Lopez de Prado DSR (per-observation Sharpe). Returns probability SR is real."""
    r = np.asarray(returns, float)
    T = len(r)
    sr = r.mean() / r.std(ddof=1)
    sk = pd.Series(r).skew()
    ku = pd.Series(r).kurt() + 3
    v = np.var(trial_sharpes, ddof=1) if len(trial_sharpes) > 1 else sr ** 2
    n_trials = max(n_trials, 2)
    sr0 = math.sqrt(v) * ((1 - EULER) * norm_ppf(1 - 1 / n_trials) +
                          EULER * norm_ppf(1 - 1 / (n_trials * math.e)))
    denom = math.sqrt(max(1 - sk * sr + (ku - 1) / 4 * sr ** 2, 1e-9))
    return norm_cdf((sr - sr0) * math.sqrt(T - 1) / denom), sr, sr0


def summarize(r, label=""):
    r = np.asarray(r, float)
    t_h, _ = hac_tstat(r)
    return dict(label=label, n=len(r), mean_bp=r.mean(), median_bp=np.median(r),
                hit=(r > 0).mean(), t_naive=naive_tstat(r), t_hac=t_h,
                worst_bp=r.min(), sharpe_ann=r.mean() / r.std(ddof=1) * math.sqrt(252))


def fmt(d):
    return (f"n={d['n']:<5} mean={d['mean_bp']:+.2f}bp  hit={d['hit']*100:.1f}%  "
            f"t_naive={d['t_naive']:.2f}  t_HAC={d['t_hac']:.2f}  Sharpe~{d['sharpe_ann']:.2f}")


# ---------- main audit ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--other", help="Doosre data provider ka CSV (same format)")
    ap.add_argument("--entry", default="22:00")
    ap.add_argument("--exit", default="04:00")
    ap.add_argument("--cost-bp", type=float, default=2.5, help="round-trip spread+slippage+commission (bp)")
    ap.add_argument("--swap-bp", type=float, default=0.0, help="per-night swap/rollover cost (bp), broker se lein")
    ap.add_argument("--holdout-start", default="2023-01-01")
    ap.add_argument("--keep-flat", action="store_true", help="zero-range (forward-filled) bars na hatayein")
    ap.add_argument("--tol-min", type=int, default=30, help="entry/exit ke baad kitne minute tak agla bar lena (maintenance break ke liye 90 rakhein)")
    ap.add_argument("--n-boot", type=int, default=3000)
    ap.add_argument("--out", default="gold_validation_report.md")
    a = ap.parse_args()

    L = []
    def P(s=""):
        print(s); L.append(s)

    df = load(a.csv)
    n0 = len(df)
    if not a.keep_flat:
        # weekend/holiday forward-fill bars (high==low==open==close) asli trade nahi hain
        flat = (df["high"] == df["low"]) & (df["open"] == df["close"])
        df = df[~flat].reset_index(drop=True)
        print(f"Flat (forward-filled) bars hataye: {n0 - len(df)} / {n0}")
    bar_min = int(round(df["timestamp"].diff().dt.total_seconds().median() / 60))
    has_ba = {"bid", "ask"} <= set(df.columns)
    P("# TRISHIKA GOLD EDGE VALIDATION V2\n")
    P(f"Data: {df['timestamp'].min()} -> {df['timestamp'].max()}  ({len(df)} bars)  bid/ask: {has_ba}")
    P(f"Base: entry {a.entry} UTC, exit {a.exit} UTC, cost {a.cost_bp}bp, swap {a.swap_bp}bp\n")

    base = overnight_returns(df, a.entry, a.exit, tol_min=a.tol_min)
    net = base - a.cost_bp - a.swap_bp

    # 1. Base + cost sweep
    P("## 1. Base result (gross) aur cost sweep")
    P(fmt(summarize(base, "gross")))
    for c in [0, 1.5, 2.5, 3.5, 5.0]:
        P(f"  cost+swap={c + a.swap_bp:>4.1f}bp -> net mean {base.mean() - c - a.swap_bp:+.2f}bp")
    be = base.mean() - a.swap_bp
    P(f"  Break-even round-trip cost: {be:.2f}bp\n")

    # 2. HAC + block bootstrap
    P("## 2. Serial correlation: HAC aur block bootstrap")
    t_n, t_h = naive_tstat(base), hac_tstat(base)[0]
    P(f"  naive t = {t_n:.2f}   HAC (Newey-West) t = {t_h:.2f}   (HAC bahut kam aaye to autocorrelation ne t inflate kiya)")
    ac1 = pd.Series(base.values).autocorr(1)
    P(f"  lag-1 autocorrelation = {ac1:.3f}")
    ci, blk = block_bootstrap_ci(net.values, n_boot=a.n_boot)
    P(f"  Net mean 95% CI (stationary bootstrap, block~{blk}): [{ci[0]:+.2f}, {ci[1]:+.2f}] bp")
    P(f"  CI zero ko include karta hai? {'HAAN - edge unproven' if ci[0] <= 0 <= ci[1] else 'Nahi'}\n")

    # 3. Entry/exit time sensitivity + collect trial Sharpes for DSR
    P("## 3. Entry/exit time sensitivity (overfitting check)")
    eh, em = hhmm(a.entry)
    xh, xm = hhmm(a.exit)
    ent0 = eh * 60 + em
    ex0 = xh * 60 + xm
    if bar_min >= 60:
        eo, xo = (-120, -60, 0, 60, 120), (-120, -60, 0, 60, 120)
        P(f"  (bars {bar_min}-min ke hain, isliye grid 60-min steps mein)")
    else:
        eo, xo = (-60, -30, -15, 0, 15, 30, 60), (-60, -30, 0, 30, 60)
    entries = [(ent0 + d) % 1440 for d in eo]
    exits = [(ex0 + d) % 1440 for d in xo]
    grid, trial_sr = [], []
    rows = []
    for en in entries:
        for xt in exits:
            es, xs = f"{en//60:02d}:{en%60:02d}", f"{xt//60:02d}:{xt%60:02d}"
            r = overnight_returns(df, es, xs, tol_min=a.tol_min)
            if len(r) < 30:
                continue
            rn = r - a.cost_bp - a.swap_bp
            trial_sr.append(rn.mean() / rn.std(ddof=1))
            rows.append((es, xs, len(r), r.mean(), rn.mean(), hac_tstat(rn)[0]))
    g = pd.DataFrame(rows, columns=["entry", "exit", "n", "gross_bp", "net_bp", "t_hac_net"])
    if len(g):
        P(g.pivot(index="entry", columns="exit", values="net_bp").round(2).to_string())
        pos = (g["net_bp"] > 0).mean()
        P(f"\n  Grid cells jahan net>0: {pos*100:.0f}%  ({len(g)} cells)")
        P("  Agar sirf ek exact cell positive hai aur padosi negative -> overfitting.\n")

    # 4. Multiple testing: DSR + Bonferroni
    P("## 4. Multiple testing (Deflated Sharpe, Bonferroni)")
    n_tr = max(len(g), 2)
    n_tr_user = n_tr
    dsr, sr, sr0 = deflated_sharpe(net.values, trial_sr if len(trial_sr) > 1 else [0.0, 1e-3], n_tr_user)
    P(f"  Trials counted (sirf is grid ke): {n_tr_user}. Apne purane saare tests jodein to ye number badhao.")
    P(f"  Sharpe/night = {sr:.4f}, expected-max-by-luck SR0 = {sr0:.4f}")
    P(f"  Deflated Sharpe probability = {dsr:.3f}   (>0.95 acceptable, <0.5 = luck ke barabar)")
    p_two = math.erfc(abs(hac_tstat(net.values)[0]) / math.sqrt(2))
    P(f"  HAC p-value (net) = {p_two:.4g}, Bonferroni({n_tr_user}) = {min(1, p_two*n_tr_user):.4g}\n")

    # 5. Holdout
    P(f"## 5. Untouched holdout (cutoff {a.holdout_start})")
    cut = pd.Timestamp(a.holdout_start, tz="UTC")
    ins, oos = net[net.index < cut], net[net.index >= cut]
    if len(ins) > 30:
        P("  In-sample : " + fmt(summarize(ins)))
    if len(oos) > 30:
        P("  Holdout   : " + fmt(summarize(oos)))
        P("  NOTE: holdout par parameter tune mat kariye. Ek baar dekhne ke baad wo 'untouched' nahi raha.\n")
    else:
        P("  Holdout me <30 nights - data kam hai ya cutoff galat.\n")

    # 6. Year by year + weekday (rollover/Wednesday triple-swap)
    P("## 6. Stability: saal-dar-saal aur weekday")
    yr = net.groupby(net.index.year).agg(["count", "mean"])
    P(yr.round(2).to_string())
    wd = net.groupby(net.index.dayofweek).agg(["count", "mean"])
    names = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
    wd.index = [names[i] for i in wd.index]
    P("\n" + wd.round(2).to_string())
    P("  (weekday = ENTRY ki raat; Fri/Sat entry kam hone chahiye kyunki market band hota hai)")
    P("  Wednesday night par zyada swap lagta hai (triple swap) - broker se check karein.\n")

    # 7. Bid/ask execution
    P("## 7. Bid/ask execution")
    if has_ba:
        ba = overnight_returns(df, a.entry, a.exit, tol_min=a.tol_min, use_bidask=True) - a.swap_bp - 0.0
        P(f"  Buy@ask, sell@bid (spread already inside): mean {ba.mean():+.2f}bp, t_HAC {hac_tstat(ba)[0]:.2f}")
        P("  Isme alag se cost mat ghataiye (sirf commission/slippage).\n")
    else:
        P("  CSV me bid/ask columns nahi. Tick/bid-ask data laayein; bina uske cost sirf assumption hai.\n")

    # 8. Cross-source
    P("## 8. Independent data-source verification")
    if a.other:
        o = overnight_returns(load(a.other), a.entry, a.exit, tol_min=a.tol_min)
        j = pd.concat([base, o], axis=1, keys=["A", "B"]).dropna()
        P(f"  Common nights: {len(j)}")
        P(f"  Mean A={j.A.mean():+.2f}bp, B={j.B.mean():+.2f}bp, return correlation={j.A.corr(j.B):.3f}")
        P(f"  t_HAC A={hac_tstat(j.A)[0]:.2f}, B={hac_tstat(j.B)[0]:.2f}")
        P("  Dono me edge na dikhe ya correlation low ho to data artifact ka shak.\n")
    else:
        P("  --other nahi diya. Doosre provider ka CSV dein (e.g. Dukascopy vs broker feed).\n")

    # Verdict
    P("## Verdict checklist")
    checks = {
        "HAC t > 3 (net)": hac_tstat(net.values)[0] > 3,
        "Bootstrap CI zero ke upar": ci[0] > 0,
        "Deflated Sharpe > 0.95": dsr > 0.95,
        "Holdout net > 0": len(oos) > 30 and oos.mean() > 0,
        "Padosi entry times positive (>=60% cells)": len(g) > 0 and (g["net_bp"] > 0).mean() >= 0.6,
    }
    for k, v in checks.items():
        P(f"  [{'PASS' if v else 'FAIL'}] {k}")
    P("\nSab PASS bhi ho to ye 'research hypothesis' hi hai. Agla step: 100+ night paper trading with actual bid/ask.")

    with open(a.out, "w") as f:
        f.write("\n".join(L))
    print(f"\nReport saved: {a.out}")


if __name__ == "__main__":
    main()

PYEOF

FILES=$(ls "$DL"/xauusd*h1*bid*.csv 2>/dev/null)
if [ -z "$FILES" ]; then
  echo "ERROR: Downloads mein koi xauusd-h1-bid-*.csv file nahi mili."
  echo "Gold ka 1h CSV Downloads folder mein rakhiye aur dobara chalaiye."
  exit 1
fi

for f in $FILES; do
  b=$(basename "$f" .csv)
  case "$b" in
    *2021*|*2022*|*2023*|*2024*|*2025*|*2026*) HO="2023-01-01" ;;
    *) HO="2018-01-01" ;;
  esac
  echo "=== $b  (holdout $HO) ==="
  python "$W/trishika_gold_validation_v2.py" --csv "$f" --holdout-start "$HO" \
    --cost-bp 1.5 --tol-min 90 --n-boot 500 --out "$DL/report_$b.md" || echo "FAILED: $b"
done

echo
echo "DONE. Downloads mein ye reports aa gayi:"
ls "$DL"/report_xauusd*.md 2>/dev/null
