from strategy.strategy import generate_signal
from strategy.execution import execute_trade

def run_backtest(df, risk_manager):
    trades = []
    open_trade = None
    cooldown = 0

    for i in range(1, len(df)):
        row = df.iloc[i]

        if cooldown > 0:
            cooldown -= 1
            continue

        if open_trade:
            if open_trade["type"] == "BUY":
                if row["low"] <= open_trade["sl"]:
                    pnl = (open_trade["sl"] - open_trade["entry"]) * open_trade["size"]
                    trades.append({"pnl": pnl})
                    risk_manager.update_after_trade(pnl)
                    open_trade = None
                    cooldown = 3
                elif row["high"] >= open_trade["tp"]:
                    pnl = (open_trade["tp"] - open_trade["entry"]) * open_trade["size"]
                    trades.append({"pnl": pnl})
                    risk_manager.update_after_trade(pnl)
                    open_trade = None
                    cooldown = 3
            else:
                if row["high"] >= open_trade["sl"]:
                    pnl = (open_trade["entry"] - open_trade["sl"]) * open_trade["size"]
                    trades.append({"pnl": pnl})
                    risk_manager.update_after_trade(pnl)
                    open_trade = None
                    cooldown = 3
                elif row["low"] <= open_trade["tp"]:
                    pnl = (open_trade["entry"] - open_trade["tp"]) * open_trade["size"]
                    trades.append({"pnl": pnl})
                    risk_manager.update_after_trade(pnl)
                    open_trade = None
                    cooldown = 3

        if not open_trade and risk_manager.can_trade():
            signal = generate_signal(row)
            if signal:
                open_trade = execute_trade(signal, row, risk_manager)

    return trades
