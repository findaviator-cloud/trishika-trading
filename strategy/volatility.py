def is_volatile_enough(row):
    return row["atr"] > row["close"] * 0.003
