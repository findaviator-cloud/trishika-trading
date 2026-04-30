def ai_confidence(row):
    score = 0

    if row["ema_fast"] > row["ema_slow"]:
        score += 0.25
    if row["close"] > row["ema_fast"]:
        score += 0.2
    if row["atr"] < row["close"] * 0.01:
        score += 0.15
    if row.get("htf_trend") == "UP":
        score += 0.25
    if row.get("strong_trend"):
        score += 0.15

    return round(score, 2)
