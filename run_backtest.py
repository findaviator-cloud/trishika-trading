import pandas as pd
from test_next_bar_strategy import run_next_bar_strategy


def main():
    df = pd.read_csv('./data/BTCUSDT_1h.csv')

    eq, trades = run_next_bar_strategy(
        df,
        compounding=True,
        fee=0.0015,
        ratchet=True,
        chandelier=False,
        donchian_len=10,
        atr_len=14,
        atr_mult=2.0,
        initial_equity=1000.0,
        fixed_notional=1000.0,
        next_open_exit=False,
    )

    print(f"Final Equity: {eq:.2f}")
    print(f"Total Trades: {len(trades)}")
    for t in trades[:5]:
        print(t)


if __name__ == "__main__":
    main()
