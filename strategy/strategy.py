def generate_signal(row):
    if row["regime"] != "TREND":
        return None
    if not row["is_volatile"]:
        return None
    if not row["strong_trend"]:
        return None
    if row["ai_score"] < 0.65:
        return None

    if row["htf_trend"] == "UP":
        if row["ema_fast"] > row["ema_slow"] and row["close"] < row["ema_fast"]:
            return "BUY"

    if row["htf_trend"] == "DOWN":
        if row["ema_fast"] < row["ema_slow"] and row["close"] > row["ema_fast"]:
            return "SELL"

    return None
