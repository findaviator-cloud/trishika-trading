import csv, json, os, sys, time, urllib.request, datetime
OUT = os.path.expanduser("~/storage/downloads/india_data"); os.makedirs(OUT, exist_ok=True)
IDX = {"NIFTY50": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN"}
def get(sym, interval, p1, p2):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?period1={p1}&period2={p2}&interval={interval}&includePrePost=false"
    for k in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
        except Exception as e: err = e; time.sleep(3)
    print("FAIL", sym, interval, err); return None
def save(name, js, path):
    r = js["chart"]["result"][0]; ts = r["timestamp"]; q = r["indicators"]["quote"][0]; n = 0
    with open(path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        for i, t in enumerate(ts):
            o, h, l, c, v = (q[k][i] for k in ("open", "high", "low", "close", "volume"))
            if None in (o, h, l, c): continue
            w.writerow([t * 1000, o, h, l, c, v or 0]); n += 1
    print(name, n, "rows ->", path)
import urllib.parse
now = int(time.time())
for nm, sym in IDX.items():
    js = get(sym, "1d", 1167609600, now)            # 2007-01-01 se
    if js: save(nm + " daily", js, f"{OUT}/{nm}_1d.csv")
    js = get(sym, "1h", now - 725 * 86400, now)     # Yahoo 1h: ~730 din tak
    if js: save(nm + " 1h", js, f"{OUT}/{nm}_1h.csv")
    js = get(sym, "5m", now - 58 * 86400, now)      # 5m: ~60 din tak
    if js: save(nm + " 5m", js, f"{OUT}/{nm}_5m.csv")
print("DONE. Folder:", OUT)
