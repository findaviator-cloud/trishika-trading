def detect_regime(row, threshold=0.001):
    if abs(row["ema_fast"] - row["ema_slow"]) / row["close"] < threshold:
        return "RANGE"
    elif row["atr"] > row["close"] * 0.01:
        return "VOLATILE"
    else:
        return "TREND"
