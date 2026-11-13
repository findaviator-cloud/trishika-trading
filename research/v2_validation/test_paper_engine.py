#!/usr/bin/env python3
"""Paper engine ke sanity tests (synthetic data, network nahi).  Chalao: python test_paper_engine.py"""
import os, subprocess, sys, tempfile, json, csv
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
ENG = os.path.join(HERE, "paper_engine.py")


def synth(n=24 * 400, seed=3, start="2025-01-01", drift=0.0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq="1h")
    r = rng.normal(drift, 0.0015, n)
    c = 2000 * np.exp(np.cumsum(r)); o = np.r_[c[0], c[:-1]]
    hi = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.0006, n))); lo = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.0006, n)))
    return pd.DataFrame({"timestamp": ((idx - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)), "open": o, "high": hi, "low": lo, "close": c})


def run(csvs, now, out, start="2025-06-01"):
    args = [sys.executable, "-I", ENG, "--source", "csv", "--now", now, "--start", start, "--out-dir", out]
    for k, v in csvs.items():
        args += ["--csv", f"{k}={v}"]
    r = subprocess.run(args, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr + r.stdout


def trades(out):
    with open(os.path.join(out, "trades.csv")) as f:
        return {r["trade_id"]: r for r in csv.DictReader(f)}


def main():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x.csv"); synth().to_csv(p, index=False)
        csvs = {"XAU": p, "BTC": p, "ETH": p}
        full, early = os.path.join(d, "full"), os.path.join(d, "early")
        run(csvs, "2026-01-20T00:00:00", full); run(csvs, "2025-11-15T13:30:00", early)
        a, b = trades(full), trades(early)
        closed_b = {k: v for k, v in b.items() if v["status"] == "CLOSED"}
        assert closed_b, "early run mein koi closed trade nahi (test bekaar)"
        bad = [k for k, v in closed_b.items() if k not in a or a[k]["net_bp"] != v["net_bp"]]
        assert not bad, f"look-ahead / badalne wale trades: {bad[:3]}"
        print(f"OK look-ahead: {len(closed_b)} closed trades dono runs mein identical")
        # idempotent: dobara chalane par same
        run(csvs, "2026-01-20T00:00:00", full); assert trades(full).keys() == a.keys(); print("OK idempotent rerun")
        # data fail par purani files na badlen
        before = open(os.path.join(full, "trades.csv")).read()
        r = subprocess.run([sys.executable, "-I", ENG, "--out-dir", full, "--now", "2026-01-20T00:00:00"], capture_output=True, text=True, env={**os.environ, "TWELVE_DATA_API_KEY": ""})
        assert r.returncode == 1 and open(os.path.join(full, "trades.csv")).read() == before; print("OK data-fail guard (exit 1, files safe)")
        # gold night sirf Sun-Thu entry
        wd = {pd.Timestamp(v["entry_time"]).weekday() for v in a.values() if v["sleeve"] == "GOLD_NIGHT"}
        assert wd <= {6, 0, 1, 2, 3}, wd; print("OK gold night weekdays", sorted(wd))
        # equity-sleeve trades me shadow nahi
        s = json.load(open(os.path.join(full, "summary.json")))
        assert all(not v["shadow"] for k, v in s["sleeves"].items() if k in ("GOLD_NIGHT", "PAT4H_LONG")); print("OK sleeves")
    print("SAB TEST PASS")


if __name__ == "__main__":
    main()
