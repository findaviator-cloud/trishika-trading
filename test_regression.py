"""
Canonical regression test for test_next_bar_strategy.py (production engine).

ENGINE SPEC (do not mix with grid_search.py prototype):
  - Execution : next-bar open entry and exit
  - ATR       : Wilder/EWM true-range, alpha=1/14, min_periods=14, adjust=False
  - Ratchet   : row-based close (current bar close - atr_mult * current bar ATR)
  - Fees      : 0.15% per side, additive, compounding
  - Capital   : 1000.0 initial
  - Dataset   : data/BTCUSDT_1h.csv  MD5=3b5e774fedf92bec3b61da4f240f2ee8

PRODUCTION CONFIGS (validated Jul 2023–Apr 2026):

  ETH daily — ls_sma100 regime switch:
    donchian_len=20, atr_len=14, atr_mult=2.0, sma_len=100
    allow_long=True, allow_short=True, risk_pct=0.005
    OOS: 33% profit_rate, 0.35% mean_dd, 3 folds

  SOL daily — short_only:
    donchian_len=20, atr_len=14, atr_mult=2.0
    allow_long=False, allow_short=True, risk_pct=0.005
    OOS: 67% profit_rate, ~2.3% mean_dd (sized), 3 folds

  BNB daily — excluded (insufficient OOS trade frequency)

RETIRED TARGET: 807.05 (grid_search.py prototype — 750 capital, no fees,
                         same-bar close entry, SMA high-low ATR, 8 trades)
"""

import hashlib
import pandas as pd
from test_next_bar_strategy import run_next_bar_strategy

EXPECTED_EQUITY  = 979.06
EXPECTED_TRADES  = 13
CSV_MD5          = "3b5e774fedf92bec3b61da4f240f2ee8"
EQUITY_TOLERANCE = 0.01   # cents

PARAMS = dict(
    compounding    = True,
    fee            = 0.0015,
    ratchet        = True,
    chandelier     = False,
    donchian_len   = 10,
    atr_len        = 14,
    atr_mult       = 2.0,
    initial_equity = 1000.0,
    fixed_notional = 1000.0,
    next_open_exit = False,
)

EXPECTED_TRADES_DETAIL = [
    # (entry_i, exit_i, entry_price, exit_price)
    ( 23,  26,  67539.34,  67196.56),
    ( 42,  76,  67205.06,  69711.04),
    ( 77,  80,  71467.81,  69916.80),
    (100, 112,  70186.08,  69486.82),
    (121, 149,  70412.10,  72200.81),
    (182, 214,  71211.95,  73029.77),
    (220, 233,  74109.56,  74311.26),
    (246, 265,  73914.40,  73527.56),
    (298, 315,  70272.00,  69971.19),
    (325, 349,  70767.85,  70123.06),
    (380, 381,  68899.92,  67874.20),
    (386, 411,  70122.15,  70179.04),
    (423, 437,  70840.75,  70709.96),
]


def check_csv_integrity(path):
    with open(path, "rb") as f:
        md5 = hashlib.md5(f.read()).hexdigest()
    assert md5 == CSV_MD5, (
        f"CSV fingerprint mismatch.\n"
        f"  expected : {CSV_MD5}\n"
        f"  got      : {md5}\n"
        f"  The dataset has changed — regression results are not comparable."
    )


def test_production_engine():
    csv_path = "./data/BTCUSDT_1h.csv"

    # 1. Dataset integrity
    check_csv_integrity(csv_path)

    # 2. Run engine
    df = pd.read_csv(csv_path)
    equity, trades = run_next_bar_strategy(df, **PARAMS)

    # 3. Trade count
    assert len(trades) == EXPECTED_TRADES, (
        f"Trade count mismatch: expected {EXPECTED_TRADES}, got {len(trades)}"
    )

    # 4. Final equity
    assert abs(equity - EXPECTED_EQUITY) <= EQUITY_TOLERANCE, (
        f"Equity mismatch: expected {EXPECTED_EQUITY}, got {equity:.4f}"
    )

    # 5. Per-trade path (entry_i, exit_i, entry_price, exit_price)
    for k, (t, exp) in enumerate(zip(trades, EXPECTED_TRADES_DETAIL), 1):
        ei, xi, ep, xp = exp
        assert t['entry_i'] == ei, \
            f"Trade {k}: entry_i expected {ei}, got {t['entry_i']}"
        assert t['exit_i']  == xi, \
            f"Trade {k}: exit_i expected {xi}, got {t['exit_i']}"
        assert abs(t['entry_price'] - ep) <= EQUITY_TOLERANCE, \
            f"Trade {k}: entry_price expected {ep}, got {t['entry_price']}"
        assert abs(t['exit_price']  - xp) <= EQUITY_TOLERANCE, \
            f"Trade {k}: exit_price expected {xp}, got {t['exit_price']}"

    print(f"PASS  equity={equity:.2f}  trades={len(trades)}")
    print("All 13 trade entry/exit bars and prices matched.")


if __name__ == "__main__":
    test_production_engine()
