# Research findings V2 (Nov 2026) - validation audit, patterns, probability tools

Status: **research only. Nothing here places orders. No strategy below is proven for live trading.**
Overall readiness estimate: roughly 35% of the way to "can be trusted with real money". The biggest missing piece is 100+ nights/trades of paper trading on real bid/ask.

All code is in `research/v2_validation/`, all raw outputs in `research/v2_validation/reports/`. These scripts are offline tools, not used by the server or Render.

## 1. Data used (not committed to git)
| Market | Data | Range |
|---|---|---|
| XAUUSD | Dukascopy 1h bid; 1m/5m; 2-day tick | 2010-01 to 2026-11 (1m: Sep-Nov 2026, 5m: May-Nov 2026) |
| EURUSD | Dukascopy 1h bid; 1m/5m; 2-day tick | 2010 to 2020 (1h), 2026 (1m/5m) |
| BTCUSDT, ETHUSDT | Binance monthly klines 1h (`get_crypto.py`); 1m/5m recent | 2017-08 to 2026-10 |
| Nifty 50, Bank Nifty, Sensex | Yahoo chart API (`get_india.py`) | daily 2007-2026, 1h ~2 yrs, 5m ~2 months |

Data-quality fixes that mattered:
* `xauusd-h1` 2010-2020 file contains forward-filled weekend/holiday bars (~31% flat bars). They are removed (`high==low` and `open==close`), otherwise Fri/Sat "nights" appear.
* From ~2013 the 22:00 UTC gold bar is flat/stale on many (winter) nights because of the daily maintenance break. Entry therefore uses the first real bar after the break (`--tol-min 90`). A fixed "22:00 UTC" is not the same trade in summer and winter.
* Yahoo daily files carry a live Sunday row; weekend rows are dropped for India/gold.

## 2. Gold overnight (long 22:00 UTC -> 04:00 UTC)
Audit tool: `trishika_gold_validation_v2.py` (HAC/Newey-West, stationary bootstrap, entry/exit grid, Deflated Sharpe, holdout, year/weekday, bid/ask, cross-source).

| Sample | Result |
|---|---|
| 2010-2020 (2,837 nights) | gross +5.09 bp, HAC t = 7.04, net @1.5 bp +3.59 bp, break-even ~5 bp |
| 2010-2017 / 2018-2020 | +4.44 bp (t 5.2) / +1.32 bp net (t 1.09, not distinguishable from 0) |
| 2010-2026 (4,347 nights) | gross +5.39 bp, HAC t = 8.5 |
| 2023-2026 holdout | net +6.4 bp, t = 3.8 (also +5.4 @2.5 bp, +4.4 @3.5 bp) |
| 2018-2022 | ~+1.0 bp net (weak regime) |

* Drift check: in 2023-26 any 6-hour window averaged +2.5 bp vs +9.1 bp for the overnight window, so ~+6.6 bp is excess, not just the gold bull market. 2010-17 excess was +6.3 bp. 2018-22 excess only ~+2.4 bp.
* Deflated Sharpe 0.865-0.877 (needs 0.95), and it counts only the 25 grid trials, not all earlier tests.
* Year by year is uneven (2011 +12.7 bp, 2013-15 ~2-3 bp, 2021 +2.4, 2022 -1.3, 2025 +9.5). Sunday-night entries are weak (~+1 bp).
* Real spread (one-day tick, 1-2 Nov 2026): median 1.2-1.7 bp, 23:00 UTC 95th percentile ~3.8 bp. Broker swap is NOT included (assumed 0). Use `--swap-bp`.

## 3. Probability card (`gold_probability_card.py`, `gold_probability_card_v2.py`)
* Base rates for the overnight trade: UP 53% / FLAT 6% / DOWN 40% (|move|<2 bp = flat); net-of-cost win rate 54%; 46% of nights lose.
* Typical night range -13 to +23 bp (50%), bad night (5%) -48 bp, worst -356 bp, best +685 bp.
* Walk-forward (each year trained only on prior years): context (prev night, 20-night mean, vol, weekday, prev day) gives AUC 0.536 only; adding candle features 0.543, adding W/M/N flags 0.537, both 0.546 - no useful improvement in Brier score. Use the base rate.
* Reversal idea ("if long loses, go short"): short every night is -6.85 bp net; conditional shorts after down nights/days also negative. No edge.
* Volatility (useful): HIGH-vol regime (last 20 nights) -> next night average |move| 37 bp vs 18 bp in LOW (2.1x) with the same ~54% win rate; after a 2x-normal day the next night moves 1.6x. Use vol for sizing, not for direction.
* A 4h candle/W/N pattern flag in the last 24h correlates with bigger overnight moves in both directions - treat as a volatility marker, not a signal.

## 4. Single candle study (1m ... 1D)
Script: `single_candle_test.py`. Shapes: close top/bottom, marubozu, hammer, shooting star, doji, big (>2 ATR) up/down; outcome = next candle open->close minus market baseline.
* 1h-1D: after a candle closes at its low the next candle drifts up slightly, at its high slightly down (mean reversion), consistent across gold/EUR/BTC/ETH (EUR t=5.0, BTC 3.8, gold 2h 3.65) but only +0.6 to +1 bp for FX/gold and +5.5 bp BTC, all below cost.
* 1m: the sign flips to momentum (BTC t=+11, ETH +6) but only ~0.3 bp vs 8 bp cost.
* 5m+: no combination survives Bonferroni; India (daily, 1h, 5m) none.
* After a big (>2 ATR) candle the next candle is ~1.3-1.7x normal size (all markets). This is the usable result: volatility, not direction.

## 5. W / M / N patterns (4h and 1D, hold 4 bars, drift-adjusted)
Detectors: `patterns_lib.py` (from `double_patterns.py`, `n_patterns.py`).
* **Long side (W, N):** gold 4h full W t=3.0 / full N t=3.1; BTC+ETH 4h full W t=4.2 (BTC and ETH are highly correlated; BTC alone weaker), full N 3.2; ETH 1h full N t=3.8; Nifty/Sensex daily half W (t 3.6 / 2.8), full W (2.2 / 1.6).
* **Short side (M, half-M, inverted N):** no reliable edge anywhere. Across 32 market/timeframe cells only 8 are positive after cost and none has t>2. Full M (neckline break) averages -50 bp for shorts. Nifty daily inverted N short is a reverse effect (t=-2.3). Raw numbers: `reports/M_pattern_all.csv`.
* EUR/USD: nothing for any pattern.
* Fixed-rule 4h W+N long strategy (`pattern_strategy_backtest.py`): gold+BTC+ETH, entry next 4h open, exit 4 bars or pattern stop, cost gold 1.5 / crypto 8 bp. Train (<=2022) +19.9 bp/trade (t 2.1); test (2023+) +32.3 bp/trade (t 3.1); portfolio test ~+12%/yr, max DD -7%, worst month -2.5%. **Caveat: the 2023+ period had already been seen while choosing the patterns, so it is not a clean holdout.**

### 5b. Half-pattern and short strategies, full backtest (, 4h, gold+BTC+ETH, train <=2022 / test 2023+)
Net bp per trade after cost (n, t):
| Variant | Train | Test |
|---|---|---|
| FULL W+N (long) | +19.9 (764, t 2.1) | +32.3 (428, t 3.1) |
| only FULL_W / only FULL_N | +46.3 (t 2.9) / +11.3 (t 1.0) | +32.3 (t 2.2) / +33.6 (t 2.9) |
| HALF W+N (long) | +7.0 (1403, t 1.1) | +7.8 (799, t 1.1) |
| HALF_M (short) | +1.4 (732, t 0.2) | -11.1 (424, t -1.3), PF 0.83 |
| FULL_M (short) | +32.6 (379, t 1.9) | **-19.3** (209, t -1.2), PF 0.78 - sign flips |
| M both (short) | +12.0 (t 1.3) | -8.0 (t -0.9) |
| HALF inverted N (short) | -1.8 (t -0.2) | +4.4 (t 0.5) |
| FULL inverted N (short) | +24.7 (t 1.2) | +21.6 (t 1.5) - same sign, weak |
| All SHORT (M + inv-N) | +2.4 (t 0.3) | -1.4 (t -0.2) |
| All half patterns long+short | -1.5 (t -0.3) | +2.1 (t 0.4) |

Reading: half patterns (long or short) have no tradable edge; only the full (neckline-break) long patterns W and N hold up. M short loses out of sample. Full inverted N short is the only short with a same-sign result in both periods, but it is not significant. Half patterns also hit the pattern stop 13-16% of the time vs 1-3% for full patterns.

## 6. Cross-market overnight effect
| Market | Overnight long | Verdict |
|---|---|---|
| Gold | +5.4 bp, t 8.5 | strongest, but weak in 2018-22 |
| BTC / ETH 22:00-04:00 UTC | -1.5 / -1.6 bp, t ~ -0.5 | none |
| BTC 18:00-00:00 UTC | +9.7 bp (t 3.75), ETH +11.7 (t 3.7) | post-hoc window scan, fading (2023-26 ~+5 bp), negative after 8 bp cost |
| EURUSD 22-04 | +1.2 bp, t 3.6 | too small after cost |
| Nifty / Bank Nifty / Sensex (close -> next open) | +9.3 / +9.8 / +12.6 bp, t 10 / 7.5 / 12.1; day session negative | real but 2023-26 weaker (+6.8 / +4.4 / +6.7 bp); net @4 bp only +2.8 / +0.4 / +2.7 bp |

## 7. Tools added
| Script | Purpose |
|---|---|
| `trishika_gold_validation_v2.py` | the 8-part audit (use `--tol-min 90`, drops flat bars by default) |
| `gold_probability_card.py` / `_v2.py` | probabilities, regime volatility, sizing; V2 tests candle/pattern features walk-forward |
| `pattern_monitor.py` | what pattern is forming now per market, plus its historical record and verdict |
| `single_candle_test.py` | single-candle study across timeframes |
| `pattern_strategy_backtest.py` | fixed-rule 4h W+N long backtest, train/test |
| `get_crypto.py`, `get_india.py` | Binance and Yahoo downloaders (Termux friendly) |
| `run_gold_audit.sh` | one-file Termux runner for the gold audit |

## 8. What is still missing (in priority order)
1. 100+ nights/trades of paper trading with real executable bid/ask and missed trades logged (see `docs/PAPER_TRADING_PLAN.md`).
2. Broker swap/rollover, real spread at 22:00-23:00 UTC; Binance futures funding for crypto.
3. A genuinely untouched test period (new data after Nov 2026).
4. Count all earlier tests in the Deflated Sharpe (`n_tr` in the audit) - the number reported here under-counts.
5. A risk layer: per-night max loss, vol-scaled size, kill-switch.


## 9. Automatic paper trading
Live virtual trading setup: [PAPER_TRADING_LIVE.md](PAPER_TRADING_LIVE.md). Engine: `research/v2_validation/paper_engine.py`, API: `/api/paper`.
