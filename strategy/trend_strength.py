def strong_trend(row):
    diff = abs(row["ema_fast"] - row["ema_slow"])
    return diff > row["close"] * 0.002
