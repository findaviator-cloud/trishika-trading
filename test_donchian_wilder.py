import pandas as pd


def run_donchian_atr_wilder(
    df,
    donchian_len=10,
    atr_len=14,
    atr_mult=2.0,
    fee=0.0015,          # 0.15% per side
    compounding=True,    # matches 807.05 baseline
    initial_equity=1000.0,
):
    df = df.copy()

    if 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'])
        time_col = 'time'
    elif 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        time_col = 'timestamp'
    else:
        time_col = None

    df['upper_band'] = df['high'].shift(1).rolling(donchian_len).max()

    high_low = df['high'] - df['low']
    high_cp = (df['high'] - df['close'].shift(1)).abs()
    low_cp = (df['low'] - df['close'].shift(1)).abs()
    df['tr'] = pd.concat([high_low, high_cp, low_cp], axis=1).max(axis=1)

    df['atr'] = df['tr'].ewm(
        alpha=1.0 / atr_len,
        min_periods=atr_len,
        adjust=False
    ).mean()

    equity = float(initial_equity)
    in_pos = False
    entry_price = 0.0
    stop_price = 0.0
    highest_since_entry = 0.0
    trades = []

    entry_i = None
    entry_t = None

    for i in range(donchian_len + atr_len, len(df)):
        row = df.iloc[i]
        prev = df.iloc[i - 1]

        row_time = row[time_col] if time_col is not None else i

        if not in_pos:
            if (
                pd.notna(prev['upper_band']) and
                pd.notna(prev['atr']) and
                prev['high'] > prev['upper_band']
            ):
                in_pos = True
                entry_price = float(row['open'])
                stop_price = entry_price - atr_mult * float(prev['atr'])
                highest_since_entry = float(prev['high'])
                entry_i = i
                entry_t = row_time

        else:
            highest_since_entry = max(highest_since_entry, float(row['high']))
            new_stop = highest_since_entry - float(row['atr']) * atr_mult
            if new_stop > stop_price:
                stop_price = new_stop

            if row['low'] <= stop_price:
                exit_price = min(float(row['open']), float(stop_price))

                gross_pct = exit_price / entry_price - 1.0
                net_pct = gross_pct - 2.0 * fee

                if compounding:
                    equity *= (1.0 + net_pct)
                else:
                    equity += equity * net_pct

                trades.append({
                    'entry_i': entry_i,
                    'entry_t': entry_t,
                    'entry_price': round(entry_price, 2),
                    'exit_i': i,
                    'exit_t': row_time,
                    'exit_price': round(exit_price, 2),
                    'equity': round(equity, 2),
                })

                in_pos = False
                entry_price = 0.0
                stop_price = 0.0
                highest_since_entry = 0.0
                entry_i = None
                entry_t = None

    return equity, trades


def main():
    df = pd.read_csv('./data/BTCUSDT_1h.csv')

    final_equity, trades = run_donchian_atr_wilder(
        df,
        donchian_len=10,
        atr_len=14,
        atr_mult=2.0,
        fee=0.0015,
        compounding=True,
        initial_equity=1000.0,
    )

    print(f"FINAL EQUITY: {final_equity:.2f}")
    print(f"NUM TRADES:   {len(trades)}")
    for t in trades[:5]:
        print(t)


if __name__ == "__main__":
    main()
