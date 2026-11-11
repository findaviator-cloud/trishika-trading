# v2_validation - audit, probability and pattern tools (research only)

Findings: `../../docs/RESEARCH_FINDINGS_V2.md`. Raw outputs: `reports/`. Not used by the server or Render.
Install: `pip install -r requirements.txt` (numpy, pandas; already in `requirements-fxgold.txt`). Run everything from this folder; scripts import each other by name.

CSV format: `timestamp(ms),open,high,low,close[,bid,ask]` (UTC).

```
# gold overnight audit (drops weekend flat bars, enters after the maintenance break)
python trishika_gold_validation_v2.py --csv xauusd-h1-2010-2020.csv --holdout-start 2018-01-01 --cost-bp 1.5 --tol-min 90
# probability card (+ volatility)
python gold_probability_card.py --csv a.csv --csv b.csv
python gold_probability_card_v2.py --csv a.csv --csv b.csv
# what is forming now
python pattern_monitor.py --market "GOLD|1.5|flat|4h,1D|a.csv,b.csv" --market "BTC|8|-|4h|btc_1h.csv" --market "NIFTY50|4|flat|1D|nifty_1d.csv"
# single candle study
python single_candle_test.py --tfs 1h,4h,1D --asset XAU:cost1.5:flat a.csv --asset BTC:cost8 btc.csv
# fixed-rule 4h W+N strategy
python pattern_strategy_backtest.py --gold a.csv --gold b.csv --btc btc.csv --eth eth.csv
# data
python get_crypto.py   # Binance 1h to ~/storage/downloads/crypto_data (Termux)
python get_india.py    # Yahoo indices to ~/storage/downloads/india_data (Termux)
```
Raw price data is never committed (see `.gitignore`).
