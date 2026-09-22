# Evidence Notes (verified 2026-09-21)

## Why this file exists

Several files in this repo (`src/strategy/ema_confirmation.js`,
`scripts/backtest-baseline-4h.js`, and a deleted `.v1-before-handover`
file) reference a `backtest-spec.md` document with detailed section
numbers (e.g. "Sections 3, 9-13, 15") as the source of evidence for
per-symbol trading decisions. **That file does not exist anywhere in
this repository.** It may have been lost, never committed, or kept
outside version control.

This document is a substitute: it records the actual, verifiable
numbers pulled directly from the JSON result files that DO exist in
this repo, so the evidence behind the code's per-symbol decisions is
traceable to real data instead of a missing document.

## Verified out-of-sample results

Source: `data/backtest-results/risk-adjusted-crypto-metrics.json`,
mode `EXIT_REALIZATION`, period ~Feb 2025 - Aug 2026 (~1.5 years),
compounded returns.

| Symbol | Variant | Trades | Win Rate | Total Return | CAGR | Sharpe | Max Drawdown |
|---|---|---|---|---|---|---|---|
| BTC | A (baseline) | 59 | 20.3% | +0.46% | +0.31% | 0.20 | -25.6% |
| BTC | B (EMA-confirmed) | 33 | 18.2% | +34.0% | +22.1% | 0.65 | -17.1% |
| ETH | A | 65 | 21.5% | +30.4% | +19.9% | 0.55 | -37.8% |
| ETH | B | 37 | 16.2% | +38.8% | +25.4% | 0.60 | -39.4% |
| SOL | A | 63 | 23.8% | -14.3% | -9.5% | 0.12 | -38.1% |
| SOL | B | 38 | 21.1% | -20.1% | -14.2% | -0.03 | -47.8% |
| BNB | A | 63 | 23.8% | -19.5% | -14.1% | -0.09 | -42.3% |
| BNB | B | 38 | 23.7% | +5.1% | +3.6% | 0.25 | -27.7% |

This directly supports the existing `SOL: enabled: false` suppression
in `ema_confirmation.js` (both SOL variants lose money) and the "cost
fragile" note on BNB (baseline variant loses money outright).

## NIFTY (India F&O)

Source: `reports/nifty-daily-donchian-baseline.json` +
`docs/NIFTY_DAILY_OOS_FEASIBILITY_BLOCKER.md` (already in repo).

Only 10 completed trades exist in the frozen sample (Feb 2024 - Sep
2026), 3 wins, compounded return -11.6%. The repo's own blocker doc
correctly states this sample is too small to be split into in-sample
/ out-of-sample and treated as validation. **Status: insufficient
evidence, not validated — treat as research-only.**

## BANKNIFTY and SENSEX

No backtest file, baseline report, or historical validation of any
kind exists for these two symbols anywhere in this repository as of
this writing. They currently only produce live signals with **zero**
historical validation. Treat any signal for these two symbols as
completely unvalidated until a backtest equivalent to the NIFTY one
is built.

## Caveat on timeframes

The `donchian.js` header comment claims the strategy is
"production-validated on BTCUSDT/ETHUSDT/SOLUSDT/BNBUSDT 1h", while
the walk-forward OOS results above were computed on 4H data
(`data/backtest-results/walkforward-crypto-results.json` covers 4H
variants A/B). These are not guaranteed to behave identically. This
document does not claim the 1H live signal has been directly
backtested — only that the 4H OOS evidence above is the most
concrete, verifiable evidence found in this repository for each
symbol's underlying trading logic.
