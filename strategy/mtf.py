def higher_tf_trend(row):
    if row["ema_slow"] < row["ema_fast"]:
        return "UP"
    elif row["ema_slow"] > row["ema_fast"]:
        return "DOWN"
    return "SIDEWAYS"
