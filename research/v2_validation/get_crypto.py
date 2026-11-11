import csv, io, os, sys, time, zipfile, urllib.request, datetime
OUT = os.path.expanduser("~/storage/downloads/crypto_data"); os.makedirs(OUT, exist_ok=True)
SYMS = ["BTCUSDT", "ETHUSDT"]; TF = "1h"
def months(start=(2017, 8)):
    t = datetime.date.today(); y, m = start
    while (y, m) < (t.year, t.month):      # current (adhura) mahina chhod do
        yield y, m; m += 1
        if m == 13: y, m = y + 1, 1
def norm_ts(x):
    x = int(x)
    while x > 10**13: x //= 1000          # 2025+ ke files microseconds mein hote hain
    return x
def fetch(url):
    for k in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r: return r.read()
        except Exception as e:
            err = e; time.sleep(2)
    return None
def parse(blob, w):
    z = zipfile.ZipFile(io.BytesIO(blob)); n = 0
    for name in z.namelist():
        for row in csv.reader(io.TextIOWrapper(z.open(name))):
            if not row or not row[0].isdigit(): continue
            w.writerow([norm_ts(row[0]), row[1], row[2], row[3], row[4], row[5]]); n += 1
    return n
if __name__ == "__main__":
    for s in SYMS:
        path = f"{OUT}/{s}_{TF}_2017_2026.csv"; tot = miss = 0
        with open(path, "w", newline="") as f:
            w = csv.writer(f); w.writerow(["timestamp", "open", "high", "low", "close", "volume"])
            for y, m in months():
                url = f"https://data.binance.vision/data/spot/monthly/klines/{s}/{TF}/{s}-{TF}-{y}-{m:02d}.zip"
                b = fetch(url)
                if b is None: miss += 1; print("missing", y, m); continue
                tot += parse(b, w)
            print(f"{s}: {tot} rows ->", path, f"(missing months: {miss})")
        sys.stdout.flush()
    print("DONE. Folder:", OUT)
