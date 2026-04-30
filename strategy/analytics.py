import numpy as np

def calculate_metrics(trades):
    if not trades:
        return {}

    profits = [t["pnl"] for t in trades]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p <= 0]

    win_rate = len(wins) / len(profits)
    avg_win = np.mean(wins) if wins else 0
    avg_loss = np.mean(losses) if losses else 0

    expectancy = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)

    returns = np.array(profits)
    sharpe = np.mean(returns) / (np.std(returns) + 1e-9)

    return {
        "win_rate": win_rate,
        "expectancy": expectancy,
        "sharpe": sharpe,
        "total_trades": len(trades)
    }
