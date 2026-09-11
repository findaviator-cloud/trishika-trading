# NIFTY Daily Donchian: OOS Feasibility Blocker

## Status

OOS performance validation is blocked for the current frozen NIFTY daily Donchian baseline.

This is an evidence-volume limitation, not a strategy verdict and not an implementation failure.

## Frozen baseline

- Baseline commit: `4746110b28cea2a95765322bdeceaed8659b7dd7`
- Baseline scope: NIFTY daily Donchian implementation, frozen report, and completed-trade ledger.
- Completed trades in the full available sample: 10.
- Available daily-data period: approximately 2024–2026.
- Observed result is descriptive only and must not be represented as OOS validated or trading ready.

## Gate arithmetic

The project evidence gate requires at least 10 completed trades for a result to receive a non-insufficient-evidence label.

A genuine time-based IS/OOS split partitions the existing 10 completed trades across separate windows. Therefore, both partitions cannot each contain at least 10 completed trades.

- A proportional 60/40 split would be approximately 6 IS trades and 4 OOS trades.
- A proportional 70/30 split would be approximately 7 IS trades and 3 OOS trades.
- Actual counts may differ because trend-following trades can cluster by market regime, but no split can create more completed trades than the total of 10.

Accordingly, the OOS partition would fail the locked 10-trade evidence gate before performance metrics are interpreted.

## Why this matters

An OOS result based on roughly 3–4 completed trades would be statistically uninformative. One trade would contribute 25–33 percent of the raw sample, and regime clustering can reduce the effective number of independent observations further.

For example, under a fair 50 percent win-probability process, observing at least 3 wins in 4 trades has probability 31.25 percent. A seemingly high 75 percent OOS win rate from four trades would therefore not distinguish a genuine edge from ordinary sampling variation.

## Decision

Do not run or label an OOS performance test from the current frozen sample as validation.

The current baseline must be described as:

> Descriptive single-sample research result; not OOS validated because the available completed-trade count is insufficient under the locked evidence gate.

## Reopening criteria

Reopen the OOS phase only after obtaining additional point-in-time-valid NIFTY daily history and rerunning the unchanged baseline specification.

Before interpreting any OOS result:

1. Count completed trades by actual signal date in the proposed IS and OOS windows.
2. Verify that the OOS window independently meets the evidence gate.
3. Re-run rolling-window fault-injection and artifact-integrity checks on the expanded dataset.
4. Preserve this frozen baseline as a separate historical record; do not overwrite it.
