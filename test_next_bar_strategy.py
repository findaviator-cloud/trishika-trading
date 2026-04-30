import pandas as pd


def run_next_bar_strategy(
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
    use_sma_filter=False,
    sma_len=200,
    allow_long=True,
    allow_short=False,
    risk_pct=0.0,
):
    df = df.copy()

    if 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'])
    elif 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])

    # ── indicators ────────────────────────────────────────────────────────────
    df['upper_band'] = df['high'].shift(1).rolling(donchian_len).max()
    df['lower_band'] = df['low'].shift(1).rolling(donchian_len).min()

    high_low = df['high'] - df['low']
    high_cp  = (df['high'] - df['close'].shift(1)).abs()
    low_cp   = (df['low']  - df['close'].shift(1)).abs()
    df['tr']  = pd.concat([high_low, high_cp, low_cp], axis=1).max(axis=1)
    df['atr'] = df['tr'].ewm(
        alpha=1.0 / atr_len,
        min_periods=atr_len,
        adjust=False
    ).mean()

    if use_sma_filter:
        df['sma_filter'] = df['close'].rolling(sma_len).mean()
    else:
        df['sma_filter'] = float('nan')

    # ── state ─────────────────────────────────────────────────────────────────
    equity    = float(initial_equity)

    def _apply_pnl(eq, gross_pct, stop_dist, entry_px, atr_val):
        if risk_pct > 0.0 and stop_dist and stop_dist > 0:
            dollar_risk   = eq * risk_pct
            position_size = dollar_risk / stop_dist
            price_move    = gross_pct * entry_px
            net_dollar    = position_size * price_move - 2.0 * fee * position_size * entry_px
            return eq + net_dollar
        else:
            net_pct = gross_pct - 2.0 * fee
            if compounding:
                return eq * (1.0 + net_pct)
            else:
                return eq + net_pct * fixed_notional
    in_pos    = False
    direction = 0          # +1 = long, -1 = short
    entry_price = 0.0
    stop_price  = 0.0
    highest_since_entry = 0.0   # used by chandelier long
    lowest_since_entry  = 0.0   # used by chandelier short
    entry_i = entry_t = None
    pending_exit_next_open = False
    trades = []

    for i in range(donchian_len + 1, len(df)):
        row  = df.iloc[i]
        prev = df.iloc[i - 1]

        row_time = (
            row['time']      if 'time'      in df.columns else
            row['timestamp'] if 'timestamp' in df.columns else i
        )

        # ── pending next-open exit ────────────────────────────────────────────
        if in_pos and pending_exit_next_open:
            exit_price = float(row['open'])

            if direction == 1:
                gross_pct = exit_price / entry_price - 1.0
                stop_dist = entry_price - stop_price if stop_price else None
                entry_px  = entry_price
            else:
                gross_pct = entry_price / exit_price - 1.0
                stop_dist = stop_price - entry_price if stop_price else None
                entry_px  = entry_price

            equity = _apply_pnl(equity, gross_pct, stop_dist, entry_px, None)

            trades.append({
                'entry_i':    entry_i,
                'entry_t':    entry_t,
                'entry_price': round(entry_price, 2),
                'exit_i':     i,
                'exit_t':     row_time,
                'exit_price': round(exit_price, 2),
                'direction':  direction,
                'equity':     round(equity, 2),
            })

            in_pos = False
            direction = entry_price = stop_price = 0
            highest_since_entry = lowest_since_entry = 0.0
            entry_i = entry_t = None
            pending_exit_next_open = False
            continue

        # ── no position: check entries ────────────────────────────────────────
        if not in_pos:
            indicators_valid = (
                pd.notna(prev['upper_band']) and
                pd.notna(prev['lower_band']) and
                pd.notna(prev['atr'])
            )
            if not indicators_valid:
                continue

            sma_valid = pd.notna(prev['sma_filter']) if use_sma_filter else True
            above_sma = sma_valid and float(prev['close']) > float(prev['sma_filter'])
            below_sma = sma_valid and float(prev['close']) < float(prev['sma_filter'])
            sma_long_ok  = (not use_sma_filter) or above_sma
            sma_short_ok = (not use_sma_filter) or below_sma

            long_signal  = allow_long  and sma_long_ok  and prev['high'] > prev['upper_band']
            short_signal = allow_short and sma_short_ok and prev['low']  < prev['lower_band']

            # long takes priority if both fire simultaneously
            if long_signal:
                in_pos    = True
                direction = 1
                entry_price = float(row['open'])
                stop_price  = entry_price - atr_mult * float(prev['atr'])
                highest_since_entry = float(prev['high'])
                lowest_since_entry  = float(prev['low'])
                entry_i = i
                entry_t = row_time

            elif short_signal:
                in_pos    = True
                direction = -1
                entry_price = float(row['open'])
                stop_price  = entry_price + atr_mult * float(prev['atr'])
                highest_since_entry = float(prev['high'])
                lowest_since_entry  = float(prev['low'])
                entry_i = i
                entry_t = row_time

        # ── in position: manage stop ──────────────────────────────────────────
        else:
            if direction == 1:
                # ── long stop management ──────────────────────────────────────
                if chandelier:
                    highest_since_entry = max(highest_since_entry, float(row['high']))

                if row['low'] <= stop_price:
                    if next_open_exit:
                        pending_exit_next_open = True
                    else:
                        exit_price = min(float(row['open']), float(stop_price))
                        gross_pct  = exit_price / entry_price - 1.0
                        stop_dist  = entry_price - stop_price
                        equity     = _apply_pnl(equity, gross_pct, stop_dist, entry_price, None)

                        trades.append({
                            'entry_i':    entry_i,
                            'entry_t':    entry_t,
                            'entry_price': round(entry_price, 2),
                            'exit_i':     i,
                            'exit_t':     row_time,
                            'exit_price': round(exit_price, 2),
                            'direction':  direction,
                            'equity':     round(equity, 2),
                        })

                        in_pos = False
                        direction = entry_price = stop_price = 0
                        highest_since_entry = lowest_since_entry = 0.0
                        entry_i = entry_t = None
                else:
                    if ratchet:
                        if chandelier:
                            new_stop = highest_since_entry - float(row['atr']) * atr_mult
                        else:
                            new_stop = float(row['close']) - float(row['atr']) * atr_mult
                        if new_stop > stop_price:
                            stop_price = new_stop

            else:
                # ── short stop management ─────────────────────────────────────
                if chandelier:
                    lowest_since_entry = min(lowest_since_entry, float(row['low']))

                if row['high'] >= stop_price:
                    if next_open_exit:
                        pending_exit_next_open = True
                    else:
                        exit_price = max(float(row['open']), float(stop_price))
                        gross_pct  = entry_price / exit_price - 1.0
                        stop_dist  = stop_price - entry_price
                        equity     = _apply_pnl(equity, gross_pct, stop_dist, entry_price, None)

                        trades.append({
                            'entry_i':    entry_i,
                            'entry_t':    entry_t,
                            'entry_price': round(entry_price, 2),
                            'exit_i':     i,
                            'exit_t':     row_time,
                            'exit_price': round(exit_price, 2),
                            'direction':  direction,
                            'equity':     round(equity, 2),
                        })

                        in_pos = False
                        direction = entry_price = stop_price = 0
                        highest_since_entry = lowest_since_entry = 0.0
                        entry_i = entry_t = None
                else:
                    if ratchet:
                        if chandelier:
                            new_stop = lowest_since_entry + float(row['atr']) * atr_mult
                        else:
                            new_stop = float(row['close']) + float(row['atr']) * atr_mult
                        if new_stop < stop_price:
                            stop_price = new_stop

    return equity, trades
