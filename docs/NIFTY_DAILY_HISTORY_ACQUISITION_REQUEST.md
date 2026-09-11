# NIFTY Daily Historical Data: Acquisition Request

## Objective

Acquire candidate NIFTY 50 daily Price Return index OHLC history for evidence expansion.

This acquisition does not authorize a merge, normalization, backtest rerun, OOS evaluation, parameter tuning, or trading-readiness claim.

## Requested coverage

- Primary historical period: 2010-01-01 through 2023-12-31.
- Required reconciliation overlap: 2024-01-01 through 2024-03-31.
- Existing frozen baseline period remains separate until admission is approved.

## Source preference

Use the official NSE or NIFTY Indices historical-index-data channel where available.

The candidate must explicitly identify NIFTY 50 Price Return index data. Do not substitute Total Return, Net Total Return, futures, ETF, constituent-level, or adjusted proxy data.

## Required raw fields

- Trading date
- Open
- High
- Low
- Close
- Explicit timezone and session definition
- Explicit index-series identity and methodology reference

## Required provenance record

Before any processing, capture:

1. Publisher and exact source URL or endpoint.
2. Retrieval timestamp in UTC and retrieval method.
3. License or terms-of-use reference.
4. Requested and delivered date coverage.
5. Raw filename, immutable raw storage path, and SHA-256.
6. Price Return confirmation.
7. Methodology document URL and applicable methodology dates.
8. Revision, correction, and point-in-time availability policy.
9. Corporate-action and rebalancing treatment.
10. Column definitions, timezone, and session-boundary definition.

## Admission gates

The candidate is rejected or held for review if any of these conditions occurs:

- Series identity is not explicitly Price Return.
- Required OHLC definitions or timezone are absent.
- Provenance, terms, retrieval evidence, or raw checksum are missing.
- Duplicate dates, invalid OHLC values, or unexplained session gaps are found.
- 2024-01-01 through 2024-03-31 overlap does not reconcile with the existing audited dataset within the predeclared tolerance.
- Methodology compatibility or revision policy cannot be documented.

## Required post-download sequence

1. Save the raw download immutably; do not overwrite the frozen baseline input.
2. Populate the candidate manifest.
3. Run source-admission and overlap-reconciliation checks.
4. Review exact mismatch rows, if any.
5. Compute actual completed-trade counts only after admission.
6. Reopen OOS feasibility only if the expanded data can meet the locked evidence gate in the chosen time split.
