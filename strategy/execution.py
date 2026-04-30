def execute_trade(signal, row, risk_manager, atr_mult=1.5, rr=1.5):
    entry = row["close"]

    if signal == "BUY":
        sl = entry - row["atr"] * atr_mult
        tp = entry + (entry - sl) * rr
    else:
        sl = entry + row["atr"] * atr_mult
        tp = entry - (sl - entry) * rr

    size = risk_manager.position_size(entry, sl)

    return {
        "type": signal,
        "entry": entry,
        "sl": sl,
        "tp": tp,
        "size": size
    }
