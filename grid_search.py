import pandas as pd
from itertools import product

DATA_PATH   = "data/BTCUSDT_1h.csv"
INITIAL_CAP = 750.0
DON_LENS    = [10, 20, 30, 50, 80]
ATR_MULTS   = [1.0, 1.5, 2.0, 3.0, 4.0]
ATR_LEN     = 14

df = pd.read_csv(DATA_PATH)
df["ts"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)

for col in ["open", "high", "low", "close", "volume"]:
    df[col] = pd.to_numeric(df[col], errors="coerce")

df.dropna(subset=["close"], inplace=True)
df.reset_index(drop=True, inplace=True)

results = []

for don_len, atr_mult in product(DON_LENS, ATR_MULTS):
    test = df.copy()
    test["don_high"] = test["high"].shift(1).rolling(don_len).max()
    test["atr"] = (test["high"] - test["low"]).rolling(ATR_LEN).mean()

    equity = INITIAL_CAP
    position = None
    trades = []
    peak = INITIAL_CAP
    max_dd = 0.0

    for i, row in test.iterrows():
        if pd.isna(row["don_high"]) or pd.isna(row["atr"]):
            continue

        price = row["close"]
        atr = row["atr"]

        if position is None:
            if price > row["don_high"]:
                position = {
                    "entry_price": price,
                    "trail_stop": price - atr_mult * atr,
                }
        else:
            position["trail_stop"] = max(position["trail_stop"], price - atr_mult * atr)

            if price <= position["trail_stop"] or i == len(test) - 1:
                pnl = (price - position["entry_price"]) / position["entry_price"]
                equity *= (1 + pnl)
                peak = max(peak, equity)
                dd = (peak - equity) / peak * 100 if peak > 0 else 0.0
                max_dd = max(max_dd, dd)
                trades.append(pnl * 100.0)
                position = None

    wins = sum(1 for p in trades if p > 0)
    win_rate = (wins / len(trades) * 100.0) if trades else 0.0

    results.append({
        "don_len": don_len,
        "atr_mult": atr_mult,
        "final_eq": round(equity, 2),
        "trades": len(trades),
        "win_rate": round(win_rate, 2),
        "max_dd": round(max_dd, 2),
    })

out = pd.DataFrame(results).sort_values(
    by=["final_eq", "trades", "win_rate"],
    ascending=[False, False, False]
)

print(out.to_string(index=False))
out.to_csv("grid_results.csv", index=False)
print("\nSaved grid_results.csv")
