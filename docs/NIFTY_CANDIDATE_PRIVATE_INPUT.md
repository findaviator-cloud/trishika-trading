# NIFTY Candidate: Private Raw Input

## Purpose

This project may validate an authorized NIFTY 50 daily Price Return OHLC candidate without placing vendor raw data in Git.

## Private raw location

Place the untouched authorized candidate only at:

`private_raw/nifty_candidate/NIFTY50_2010-01-01_2024-03-31.csv`

The `private_raw/` directory is Git-ignored. Do not open, edit, re-save, normalize, or commit the raw artifact before recording its SHA-256.

## Required coverage

- Primary history: 2010-01-01 through 2023-12-31.
- Mandatory reconciliation overlap: 2024-01-01 through 2024-03-31.

## Admission boundaries

The candidate must be explicitly documented as NIFTY 50 Price Return OHLC data.

The admission utility writes only derived audit records: paths, metadata, hashes, row counts, integrity outcomes, and overlap mismatch details. It does not copy raw vendor data to an admission output directory, merge it into research inputs, change the canonical manifest, rerun a backtest, or unblock OOS evaluation.

Raw storage, derived artifacts, and publication must comply with the applicable source terms.
