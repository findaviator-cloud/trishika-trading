#!/usr/bin/env python3
"""
PAPER ENGINE - virtual (demo) trading, koi real order nahi.

Har run par poori history provider se laata hai aur rules ko PAPER_START_DATE se replay karta hai.
Isliye Render free plan ka disk jaye ya process so jaye, trade log wapas wahi ban jata hai (rules deterministic hain,
sirf us candle ka data chahiye jo entry se pehle band ho chuka ho). Koi look-ahead nahi.

Sleeves
  GOLD_NIGHT     (equity)  XAU long, Sun-Thu, entry = pehla asli 1h bar 22:00 UTC ke baad (<=90 min), exit = 04:00 UTC bar ka open
  PAT4H_LONG     (equity)  XAU/BTC/ETH 4h FULL_W / FULL_N long, next 4h open entry, 4 bar hold ya pattern stop
  SHADOW_*       (sirf record, equity nahi)  FULL_IN short, HALF_M short, FULL_M short, India night (close -> next open)

Usage
  python paper_engine.py --out-dir ../../data/paper                      (Twelve Data + Yahoo, env TWELVE_DATA_API_KEY)
  python paper_engine.py --source csv --csv XAU=a.csv --csv BTC=b.csv --now 2026-10-20T00:00:00Z --out-dir /tmp/x   (test/replay)
"""
import argparse, csv, json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import patterns_lib as PL  # noqa: E402

COST_BP = {"XAU": 1.5, "BTC": 8.0, "ETH": 8.0, "NIFTY50": 4.0, "BANKNIFTY": 4.0, "SENSEX": 4.0}
TD_SYMBOL = {"XAU": "XAU/USD", "BTC": "BTC/USD", "ETH": "ETH/USD"}
YF_SYMBOL = {"NIFTY50": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN"}
HOLD = 4
EXPECTED = {  # purane backtest ka andaza (net bp/trade), compare karne ke liye
    "GOLD_NIGHT": 3.6, "PAT4H_LONG": 20.0, "SHADOW_FULL_IN": 22.0, "SHADOW_HALF_M": 0.0, "SHADOW_FULL_M": 0.0, "SHADOW_INDIA_NIGHT": 3.0}
SAFETY = {"researchOnly": True, "paperOnly": True, "ordersAllowed": False, "executionAllowed": False, "brokerConnectivityAllowed": False}


def scrub(msg):
    """error text se API key / apikey= hatao (summary.json public repo mein jata hai)."""
    msg = str(msg)
    k = os.environ.get("TWELVE_DATA_API_KEY", "")
    if k:
        msg = msg.replace(k, "***")
    return re.sub(r"(?i)(apikey|api_key|token|key)=[^&\s'\"]+", r"\1=***", msg)[:200]


def utcnow():
    return pd.Timestamp.now(tz="UTC").tz_localize(None)


# ------------------------------------------------------------------ data
def http_json(url, tries=3, headers=None):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 + 3 * k)
    raise RuntimeError(f"fetch failed: {scrub(err)}")


def fetch_twelve(sym, key, n=5000):
    q = urllib.parse.urlencode({"symbol": TD_SYMBOL[sym], "interval": "1h", "outputsize": n, "timezone": "UTC", "order": "ASC", "apikey": key})
    js = http_json("https://api.twelvedata.com/time_series?" + q)
    if js.get("status") == "error" or "values" not in js:
        raise RuntimeError(f"twelvedata {sym}: {scrub(js.get('message', js))}")
    df = pd.DataFrame(js["values"])
    df.index = pd.to_datetime(df["datetime"])
    df = df[["open", "high", "low", "close"]].astype(float).sort_index()
    return df[~df.index.duplicated()]


def fetch_yahoo_daily(sym):
    now = int(time.time())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(YF_SYMBOL[sym])}?period1={now - 400 * 86400}&period2={now}&interval=1d"
    r = http_json(url)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    df = pd.DataFrame({"open": q["open"], "high": q["high"], "low": q["low"], "close": q["close"]}, index=pd.to_datetime(r["timestamp"], unit="s"))
    df = df.dropna()
    df.index = df.index.normalize()  # IST session ki date
    return df[~df.index.duplicated(keep="last")]


def load_csv(path):
    d = pd.read_csv(path)
    ts = d["timestamp"] if "timestamp" in d else d["time"]
    d.index = pd.to_datetime(ts, unit="ms") if np.issubdtype(ts.dtype, np.number) else pd.to_datetime(ts)
    return d[["open", "high", "low", "close"]].astype(float).sort_index()


def clean_hourly(df, market_has_gaps):
    df = df[~df.index.duplicated()]
    if market_has_gaps:
        df = df[~((df.high == df.low) & (df.open == df.close))]  # forward-filled / stale bars
    return df


# ------------------------------------------------------------------ trade bookkeeping
def row(sleeve, shadow, inst, side, kind, t_in, ep, t_out, xp, status, cost, frac, reason, stop=None, mark=None):
    d = 1 if side == "LONG" else -1
    ref = xp if status == "CLOSED" else mark
    gross = d * (ref / ep - 1) * 1e4 if ref is not None else float("nan")
    net = gross - cost
    return dict(trade_id=f"{sleeve}|{inst}|{kind}|{pd.Timestamp(t_in).strftime('%Y-%m-%dT%H:%M')}", sleeve=sleeve, shadow=shadow, instrument=inst, side=side, kind=kind,
                entry_time=pd.Timestamp(t_in).strftime("%Y-%m-%d %H:%M"), entry_price=round(float(ep), 4),
                exit_time=pd.Timestamp(t_out).strftime("%Y-%m-%d %H:%M") if t_out is not None else "", exit_price=round(float(xp), 4) if xp is not None else "",
                status=status, gross_bp=round(gross, 2), cost_bp=cost, net_bp=round(net, 2), notional_frac=round(float(frac), 3),
                equity_pct=round(frac * net / 1e4 * 100, 4), exit_reason=reason, stop=round(float(stop), 4) if stop is not None else "")


# ------------------------------------------------------------------ sleeves
def gold_night(h, now, start, risk):
    """h: XAU 1h bars (flat hata ke). Sun-Thu entry."""
    out, hist = [], []
    if h.empty:
        return out
    for d in sorted(set(h.index.normalize())):
        if d.weekday() not in (6, 0, 1, 2, 3):
            continue
        t0 = d + timedelta(hours=22)
        if t0 > now:
            continue
        c = h[(h.index >= t0) & (h.index <= t0 + timedelta(minutes=90))]
        if c.empty:
            continue
        t_in, ep = c.index[0], float(c.iloc[0].open)
        t1 = d + timedelta(days=1, hours=4)
        x = h[(h.index >= t1) & (h.index <= t1 + timedelta(minutes=90))]
        # trailing 5% kharab raat -> size
        q05 = float(np.percentile(hist[-250:], 5)) if len(hist) >= 60 else -50.0
        frac = min(1.0, risk / (abs(q05) / 1e4)) if q05 < 0 else 1.0
        if not x.empty:
            xp = float(x.iloc[0].open)
            tr = row("GOLD_NIGHT", False, "XAU", "LONG", "NIGHT", t_in, ep, x.index[0], xp, "CLOSED", COST_BP["XAU"], frac, "time")
            hist.append((xp / ep - 1) * 1e4)
        elif now > t1 + timedelta(minutes=90):
            continue  # exit bar kabhi nahi mila (data gap) - ginti se bahar
        else:
            tr = row("GOLD_NIGHT", False, "XAU", "LONG", "NIGHT", t_in, ep, None, None, "OPEN", COST_BP["XAU"], frac, "", mark=float(h[h.index <= now].iloc[-1].close))
        if t_in >= start:
            out.append(tr)
    return out


def pattern_trades(h_all, inst, kinds, sleeve, shadow, now, start, risk):
    """4h bars (UTC bins) pe W/N/M/IN signals -> next open entry, 4 bar hold ya pattern stop. Signals sirf poore band 4h bars se."""
    b = h_all.resample("4h").agg(dict(open="first", high="max", low="min", close="last")).dropna()
    b = b[b.high > b.low]
    if len(b) < 60:
        return []
    done = int((b.index + timedelta(hours=4) <= now).sum())  # prefix
    sigs = []
    for det in (PL.detect, PL.detect_n):
        s, _ = det(b.iloc[:done])
        sigs += [x for x in s if x[2] in kinds]
    sigs.sort(key=lambda x: x[0])
    O, H, L, C = (b[c].values for c in ("open", "high", "low", "close"))
    n, out, busy = len(b), [], -1
    last_mark = float(h_all[h_all.index <= now].iloc[-1].close)
    for i, d, kind, stop, tgt in sigs:
        e = i + 1
        if e >= n or e <= busy:
            continue
        side = "LONG" if d == 1 else "SHORT"
        sl = f"SHADOW_{kind}" if shadow else sleeve
        ep = float(O[e]); t_in = b.index[e]
        xi, xp, why, status = e + HOLD - 1, None, "time", "OPEN"
        for j in range(e, min(e + HOLD, n)):
            if d == 1 and stop < ep and L[j] <= stop:
                xi, xp, why, status = j, min(stop, O[j]), "stop", "CLOSED"; break
            if d == -1 and stop > ep and H[j] >= stop:
                xi, xp, why, status = j, max(stop, O[j]), "stop", "CLOSED"; break
        if status == "OPEN" and xi < done:
            xp, status = float(C[xi]), "CLOSED"
        dist = abs(ep - stop) / ep
        frac = min(1.0, risk / dist) if dist > 0 else 0.25
        if status == "CLOSED":
            tr = row(sl, shadow, inst, side, kind, t_in, ep, b.index[xi] + timedelta(hours=4) if why == "time" else b.index[xi], xp, "CLOSED", COST_BP[inst], frac, why, stop)
            busy = xi
        else:
            tr = row(sl, shadow, inst, side, kind, t_in, ep, None, None, "OPEN", COST_BP[inst], frac, "", stop, mark=last_mark)
            busy = n + 10
        if t_in >= start:
            out.append(tr)
    return out


def india_night(df, inst, now, start):
    out = []
    ist_today = (now + timedelta(hours=5, minutes=30)).normalize()
    idx = list(df.index)
    for k in range(len(idx) - 1):
        d0, d1 = idx[k], idx[k + 1]
        if d0 >= ist_today and not (now.hour >= 10 and d0 == ist_today):
            continue  # entry close tak aaj ka bar band nahi
        if d0 < start.normalize():
            continue
        ep, xp = float(df.close.iloc[k]), float(df.open.iloc[k + 1])
        out.append(row("SHADOW_INDIA_NIGHT", True, inst, "LONG", "NIGHT", d0 + timedelta(hours=10), ep, d1 + timedelta(hours=3, minutes=45), xp, "CLOSED", COST_BP[inst], 1.0, "time"))
    return out


# ------------------------------------------------------------------ stats
def sleeve_stats(rows, capital):
    cl = [r for r in rows if r["status"] == "CLOSED"]
    op = [r for r in rows if r["status"] == "OPEN"]
    net = np.array([r["net_bp"] for r in cl], float)
    st = dict(closed=len(cl), open=len(op))
    if len(net) >= 2:
        sd = net.std(ddof=1)
        t = net.mean() / (sd / math.sqrt(len(net))) if sd > 0 else float("nan")
        gw, gl = net[net > 0].sum(), -net[net < 0].sum()
        eq = np.cumprod(1 + np.array([r["equity_pct"] for r in sorted(cl, key=lambda r: r["exit_time"])]) / 100)
        dd = float((eq / np.maximum.accumulate(eq) - 1).min())
        st.update(avg_net_bp=round(float(net.mean()), 2), win_pct=round(float((net > 0).mean() * 100), 1), t_stat=round(float(t), 2) if t == t else None,
                  profit_factor=round(float(gw / gl), 2) if gl > 0 else None, worst_trade_bp=round(float(net.min()), 1), best_trade_bp=round(float(net.max()), 1),
                  cum_equity_pct=round(float((eq[-1] - 1) * 100), 3), max_drawdown_pct=round(dd * 100, 3), virtual_equity=round(capital * float(eq[-1]), 2))
    return st


def build_summary(trades, capital, now, start, data_status):
    by = {}
    for r in trades:
        by.setdefault(r['sleeve'], []).append(r)
    sleeves = {}
    for k, rows in sorted(by.items()):
        st = sleeve_stats(rows, capital)
        st["shadow"] = rows[0]["shadow"]
        st["progress_to_100"] = f"{st['closed']}/100"
        st["expected_net_bp_from_backtest"] = EXPECTED.get(k)
        n = st["closed"]
        st["flag"] = ("KILL_SWITCH_REVIEW: 60+ trades aur average net < -1 bp" if n >= 60 and st.get("avg_net_bp", 0) < -1
                      else "ABHI KAM TRADES (kam se kam 100 chahiye)" if n < 100 else "100+ trades poore - ab nateeja parakhein")
        sleeves[k] = st
    eq = [r for r in trades if not r["shadow"] and r["status"] == "CLOSED"]
    port = sleeve_stats(eq, capital) if eq else {"closed": 0}
    return dict(generated_at_utc=now.strftime("%Y-%m-%dT%H:%M:%SZ"), paper_start_date=str(start.date()), days_running=max(0, (now - start).days),
                virtual_capital=capital, safety=SAFETY, sleeves=sleeves, equity_portfolio=port, data_status=data_status,
                notes=["Sab trades virtual hain. Fill = candle open (cost assumption se), asli bid/ask/slippage nahi.",
                       "SHADOW sleeves sirf record ke liye hain (M short, inverted N short, India night); equity mein nahi judte.",
                       "Rules ko test dekhkar mat badlein; naya version = naya PAPER_START_DATE."])



# ------------------------------------------------------------------ live signals (sirf dikhane ke liye)
SHAPE_NAMES = ["close_top", "close_bottom", "bull_marubozu", "bear_marubozu", "hammer", "shooting_star", "doji", "big_up", "big_down"]
ROLE = {"FULL_W": "TRADED long", "FULL_N": "TRADED long", "HALF_W": "info (edge nahi mila)", "HALF_N": "info (edge nahi mila)",
        "FULL_IN": "shadow short", "HALF_IN": "info", "FULL_M": "shadow short", "HALF_M": "shadow short"}


def candle_info(b):
    O, H, L, C = (b[c].values for c in ("open", "high", "low", "close"))
    rng = H - L; rng = np.where(rng == 0, np.nan, rng); body = np.abs(C - O); cl = (C - L) / rng
    up = H - np.maximum(O, C); lo = np.minimum(O, C) - L
    atr = pd.Series(rng).rolling(14).mean().shift(1).values
    big = rng > 2 * atr
    f = {"close_top": cl >= .95, "close_bottom": cl <= .05, "bull_marubozu": (C > O) & (body >= .8 * rng), "bear_marubozu": (C < O) & (body >= .8 * rng),
         "hammer": (lo >= 2 * body) & (up <= .25 * rng) & (body > 0) & (cl > .6), "shooting_star": (up >= 2 * body) & (lo <= .25 * rng) & (body > 0) & (cl < .4),
         "doji": body <= .1 * rng, "big_up": big & (C > O), "big_down": big & (C < O)}
    i = len(b) - 1
    return dict(candle_time=str(b.index[i]), open=round(float(O[i]), 4), high=round(float(H[i]), 4), low=round(float(L[i]), 4), close=round(float(C[i]), 4),
                close_position_pct=round(float(cl[i]) * 100, 1) if cl[i] == cl[i] else None, range_vs_atr=round(float(rng[i] / atr[i]), 2) if atr[i] == atr[i] else None,
                shapes=[k for k in SHAPE_NAMES if bool(f[k][i])], note="big candle ke baad agli candle ki range ~1.3-1.7x rehti hai (direction ka koi signal nahi)")


def vol_regime(df_h):
    d = df_h.resample("1D").agg(dict(open="first", high="max", low="min", close="last")).dropna()
    r = ((d.high - d.low) / d.close * 1e4)
    if len(r) < 120:
        return None
    cur = float(r.iloc[-20:].mean()); hist = r.rolling(20).mean().dropna().iloc[-500:]
    lo, hi = np.percentile(hist, [33.3, 66.7])
    return dict(avg_daily_range_20d_bp=round(cur, 1), regime="LOW" if cur <= lo else "HIGH" if cur >= hi else "MID",
                tip="HIGH = size chhota rakho (raat ki chaal ~2x), LOW = normal")


def recent_patterns(b, tf, now, last_bars, trades):
    done = int((b.index + (b.index[1] - b.index[0]) <= now).sum()); b = b.iloc[:done]
    out = []
    if len(b) < 60:
        return out
    step = b.index[1] - b.index[0]
    for det in (PL.detect, PL.detect_n):
        sg, _ = det(b)
        for i, d, kind, stop, tgt in sg:
            if i >= len(b) - last_bars:
                out.append(dict(timeframe=tf, formed_at=str(b.index[i] + step), kind=kind, direction="LONG" if d == 1 else "SHORT", role=ROLE.get(kind, "info") if tf == "4h" else "info (sirf 4h par test hua, trade nahi)",
                                stop=round(float(stop), 4), target=round(float(tgt), 4), last_close=round(float(b.close.iloc[-1]), 4)))
    return sorted(out, key=lambda r: r["formed_at"], reverse=True)


def build_signals(hourly, daily, trades, now):
    out = {}
    for sym, h in hourly.items():
        if len(h) < 100:
            continue
        b4 = h.resample("4h").agg(dict(open="first", high="max", low="min", close="last")).dropna(); b4 = b4[b4.high > b4.low]
        b4 = b4[b4.index + timedelta(hours=4) <= now]
        h1 = h[h.index + timedelta(hours=1) <= now]
        live = [t for t in trades if t["instrument"] == sym and t["status"] == "OPEN"]
        out[sym] = dict(candle_1h=candle_info(h1), candle_4h=candle_info(b4), volatility=vol_regime(h),
                        patterns_last_24h_on_4h=recent_patterns(h.resample("4h").agg(dict(open="first", high="max", low="min", close="last")).dropna().pipe(lambda x: x[x.high > x.low]), "4h", now, 6, trades),
                        patterns_last_day_on_1h=recent_patterns(h1, "1h", now, 24, trades), open_paper_trades=[t["trade_id"] for t in live])
    for sym, d in daily.items():
        if len(d) < 100:
            continue
        out[sym] = dict(candle_1d=candle_info(d), patterns_last_5d_on_1d=recent_patterns(d, "1d", now + timedelta(days=1), 5, trades))
    return out


# gold night: pehle ki research se (vol20 terciles, 2010-26) - approx; regime ka definition engine ke daily-range regime se thoda alag hai
NIGHT_TABLE = {"LOW": (17.9, -32.0), "MID": (23.5, -40.0), "HIGH": (37.3, -72.0)}


def night_card(h, now, risk):
    vr = vol_regime(h)
    if not vr:
        return None
    exp_move, bad5 = NIGHT_TABLE[vr["regime"]]
    nxt = now.normalize() + timedelta(hours=22)
    if nxt <= now:
        nxt += timedelta(days=1)
    while nxt.weekday() not in (6, 0, 1, 2, 3):
        nxt += timedelta(days=1)
    frac = min(1.0, risk / (abs(bad5) / 1e4))
    return dict(next_entry_utc=str(nxt), next_entry_ist=str(nxt + timedelta(hours=5, minutes=30)), exit_utc=str(nxt + timedelta(hours=6)),
                regime=vr["regime"], avg_daily_range_20d_bp=vr["avg_daily_range_20d_bp"], typical_abs_move_bp=exp_move, bad_night_5pct_bp=bad5,
                suggested_notional_frac=round(frac, 2), risk_budget_pct=round(risk * 100, 2),
                note="Research ka andaza (edge ki guarantee nahi). Size sirf risk ke liye; direction ka koi signal nahi.")


PLOG_COLS = ["logged_at_utc", "instrument", "timeframe", "formed_at", "kind", "direction", "role", "stop", "target"]


def update_pattern_log(path, instruments, now, keep=3000):
    rows, seen = [], set()
    if os.path.exists(path):
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                rows.append(r); seen.add((r["instrument"], r["timeframe"], r["formed_at"], r["kind"]))
    new = 0
    for inst, d in instruments.items():
        for lst in ("patterns_last_24h_on_4h", "patterns_last_day_on_1h", "patterns_last_5d_on_1d"):
            for p in d.get(lst, []) if isinstance(d, dict) else []:
                k = (inst, p["timeframe"], p["formed_at"], p["kind"])
                if k in seen:
                    continue
                seen.add(k); new += 1
                rows.append(dict(logged_at_utc=now.strftime("%Y-%m-%d %H:%M"), instrument=inst, timeframe=p["timeframe"], formed_at=p["formed_at"], kind=p["kind"],
                                 direction=p["direction"], role=p["role"], stop=p["stop"], target=p["target"]))
    rows = rows[-keep:]
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PLOG_COLS, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    os.replace(tmp, path)
    return new


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=os.path.join(HERE, "..", "..", "data", "paper"))
    ap.add_argument("--source", choices=["live", "csv"], default="live")
    ap.add_argument("--csv", action="append", default=[], help="NAME=path (XAU, BTC, ETH, NIFTY50...)")
    ap.add_argument("--now", default=None, help="test: is waqt ko 'abhi' maano (UTC)")
    ap.add_argument("--start", default=os.environ.get("PAPER_START_DATE", "2026-11-10"))
    ap.add_argument("--capital", type=float, default=float(os.environ.get("PAPER_CAPITAL", "100000")))
    ap.add_argument("--risk", type=float, default=float(os.environ.get("PAPER_RISK_PCT", "0.5")) / 100)
    a = ap.parse_args()
    now = pd.Timestamp(a.now).tz_convert("UTC").tz_localize(None) if a.now and pd.Timestamp(a.now).tzinfo else (pd.Timestamp(a.now) if a.now else utcnow())
    start = pd.Timestamp(a.start)
    os.makedirs(a.out_dir, exist_ok=True)
    status, hourly, daily = {}, {}, {}
    key = os.environ.get("TWELVE_DATA_API_KEY", "").strip().strip("\"'")
    csvmap = dict(x.split("=", 1) for x in a.csv)
    for sym in ("XAU", "BTC", "ETH"):
        try:
            if a.source == "csv":
                if sym not in csvmap: continue
                df = load_csv(csvmap[sym])
            else:
                if not key: raise RuntimeError("TWELVE_DATA_API_KEY set nahi hai")
                df = fetch_twelve(sym, key); time.sleep(8)
            df = clean_hourly(df[df.index < now + timedelta(hours=1)], sym == "XAU")
            df = df[df.index <= now]
            hourly[sym] = df
            status[sym] = dict(ok=True, bars=len(df), first=str(df.index[0]), last=str(df.index[-1]))
        except Exception as e:  # noqa: BLE001
            status[sym] = dict(ok=False, error=scrub(e))
    for sym in ("NIFTY50", "BANKNIFTY", "SENSEX"):
        try:
            if a.source == "csv":
                if sym not in csvmap: continue
                df = load_csv(csvmap[sym])
            else:
                df = fetch_yahoo_daily(sym)
            df = df[df.index.dayofweek < 5]
            daily[sym] = df[df.index <= now.normalize()]
            status[sym] = dict(ok=True, bars=len(daily[sym]), last=str(daily[sym].index[-1].date()))
        except Exception as e:  # noqa: BLE001
            status[sym] = dict(ok=False, error=scrub(e))
    if not any(v.get("ok") for k, v in status.items() if k in ("XAU", "BTC", "ETH")):
        print("DATA FAIL: koi hourly source nahi mila, purani files nahi badli:", json.dumps(status)[:500]); sys.exit(1)
    trades = []
    if "XAU" in hourly:
        trades += gold_night(hourly["XAU"], now, start, a.risk)
    for sym, h in hourly.items():
        trades += pattern_trades(h, sym, {"FULL_W", "FULL_N"}, "PAT4H_LONG", False, now, start, a.risk)
        trades += pattern_trades(h, sym, {"FULL_IN"}, "SHADOW_PAT4H", True, now, start, a.risk)
        trades += pattern_trades(h, sym, {"HALF_M"}, "SHADOW_PAT4H", True, now, start, a.risk)
        trades += pattern_trades(h, sym, {"FULL_M"}, "SHADOW_PAT4H", True, now, start, a.risk)
    for sym, d in daily.items():
        trades += india_night(d, sym, now, start)
    # purani closed trades (agar provider window se bahar gayi ho) ko trades.csv se wapas jodna
    path = os.path.join(a.out_dir, "trades.csv")
    if os.path.exists(path):
        have = {t["trade_id"] for t in trades}
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                if r["trade_id"] not in have and r["status"] == "CLOSED":
                    for k in ("gross_bp", "cost_bp", "net_bp", "notional_frac", "equity_pct"):
                        r[k] = float(r[k])
                    r["shadow"] = r["shadow"] in ("True", "true", True)
                    trades.append(r)
    trades.sort(key=lambda r: (r["entry_time"], r["trade_id"]))
    cols = ["trade_id", "sleeve", "shadow", "instrument", "side", "kind", "entry_time", "entry_price", "exit_time", "exit_price", "status", "gross_bp", "cost_bp", "net_bp", "notional_frac", "equity_pct", "exit_reason", "stop"]
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(trades)
    os.replace(tmp, path)
    summ = build_summary(trades, a.capital, now, start, status)
    with open(os.path.join(a.out_dir, "summary.json"), "w") as f:
        json.dump(summ, f, indent=2, default=str)
    try:
        sig = build_signals(hourly, daily, trades, now)
    except Exception as e:  # noqa: BLE001
        sig = {"error": str(e)[:200]}
    card = None
    try:
        card = night_card(hourly["XAU"], now, a.risk) if "XAU" in hourly else None
        if "error" not in sig:
            update_pattern_log(os.path.join(a.out_dir, "pattern_log.csv"), sig, now)
    except Exception as e:  # noqa: BLE001
        card = {"error": scrub(e)}
    with open(os.path.join(a.out_dir, "signals.json"), "w") as f:
        json.dump(dict(generated_at_utc=summ["generated_at_utc"], safety=SAFETY, gold_night_card=card, instruments=sig), f, indent=2, default=str)
    print(json.dumps({k: summ[k] for k in ("generated_at_utc", "days_running")}), "trades:", len(trades))
    for k, v in summ["sleeves"].items():
        print(f"  {k:22} closed={v['closed']:3d} open={v['open']} avg_net={v.get('avg_net_bp')}bp win={v.get('win_pct')}%")


if __name__ == "__main__":
    main()
