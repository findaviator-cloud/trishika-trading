# Trishika Trading System

## Run Node
npm install
npm start

## Run Python
pip install -r requirements.txt
python strategy/main.py

## Engine Provenance

| File | Role | Capital | ATR | Execution | Fees | Baseline |
|------|------|---------|-----|-----------|------|----------|
| `test_next_bar_strategy.py` | **Production engine** | 1000 | Wilder true-range EWM | Next-bar open | 0.15%/side | `equity=979.06, trades=13` |
| `grid_search.py` | Archived prototype | 750 | SMA of high-low | Same-bar close | None | `equity=807.05, trades=8` |

These two engines are **not comparable**. The 807.05 figure is retired and must not be used as a target for the production engine.

Run `python test_regression.py` after any edit to `test_next_bar_strategy.py`.
