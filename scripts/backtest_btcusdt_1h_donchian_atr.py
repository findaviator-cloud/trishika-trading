import pandas as pd
import numpy as np

# --- CONFIG ---
FILE_PATH = 'data/BTCUSDT_1h.csv'
CASH_START = 750.0
FEE = 0.0004
DONCHIAN_LEN = 20
ATR_LEN = 14
ATR_MULT = 3.0

def main():
    df = pd.read_csv(FILE_PATH)

    required_cols = {'timestamp', 'high', 'low', 'close'}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df['high'] = pd.to_numeric(df['high'], errors='coerce')
    df['low'] = pd.to_numeric(df['low'], errors='coerce')
    df['close'] = pd.to_numeric(df['close'], errors='coerce')
    df = df.dropna(subset=['high', 'low', 'close'])

    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df = df.sort_values('timestamp')
    df = df.reset_index(drop=True)

    # Donchian
    df['donchian_high'] = df['high'].rolling(DONCHIAN_LEN).max()
    df['donchian_low'] = df['low'].rolling(DONCHIAN_LEN).min()

    # ATR
    prev_close = df['close'].shift(1)
    tr1 = df['high'] - df['low']
    tr2 = (df['high'] - prev_close).abs()
    tr3 = (df['low'] - prev_close).abs()
    df['tr'] = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['atr'] = df['tr'].rolling(ATR_LEN).mean()

    balance = CASH_START
    pos = 0.0
    entry_val = 0.0
    entry_p = 0.0
    trail = None
    trades = []

    for i in range(len(df)):
        price = df['close'].iloc[i]
        high_p = df['high'].iloc[i]
        low_p = df['low'].iloc[i]
        atr = df['atr'].iloc[i]
        t = df['timestamp'].iloc[i]

        if np.isnan(atr):
            continue

        if pos > 0:
            current_stop = price - ATR_MULT * atr
            trail = max(trail, current_stop)

            exit_p = None
            reason = None

            if low_p <= trail:
                exit_p = trail
                reason = 'ATR_TRAIL'
            elif i == len(df) - 1:
                exit_p = price
                reason = 'EOD'

            if reason is not None:
                balance = (pos * exit_p) * (1 - FEE)
                trades.append({
                    't': t,
                    'type': 'EXIT',
                    'reason': reason,
                    'price': round(exit_p, 2),
                    'trade_pnl': round(balance - entry_val, 2),
                    'cum_pnl': round(balance - CASH_START, 2),
                })
                pos = 0.0
                entry_p = 0.0
                entry_val = 0.0
                trail = None

        elif i >= DONCHIAN_LEN and price > df['donchian_high'].iloc[i-1]:
            entry_val = balance
            pos = (balance * (1 - FEE)) / price
            entry_p = price
            trail = price - ATR_MULT * atr
            balance = 0.0
            trades.append({
                't': t,
                'type': 'ENTRY',
                'reason': 'DONCHIAN_LONG',
                'price': round(price, 2),
                'trade_pnl': None,
                'cum_pnl': round(entry_val - CASH_START, 2),
            })

    final_equity = balance if pos == 0 else (pos * df['close'].iloc[-1]) * (1 - FEE)

    trades_df = pd.DataFrame(trades)
    exits = trades_df[trades_df['type'] == 'EXIT'].copy()
    win_rate = (exits['trade_pnl'] > 0).mean() * 100 if not exits.empty else 0.0

    print(f"Final Equity: {final_equity:.2f}")
    print(f"Total Trades: {len(exits)}")
    print(f"Win Rate: {win_rate:.2f}%")
    print("\nLAST 10 TRADE EVENTS:")
    if trades_df.empty:
        print("No trades generated.")
    else:
        print(trades_df.tail(10).to_string(index=False))

if __name__ == '__main__':
    main()
