#!/usr/bin/env python3
"""
Fetch and normalize Twelve Data OHLC candles for EUR/USD or XAU/USD.

Examples:
  export TWELVE_DATA_API_KEY='...'
  python scripts/fetch_twelvedata_ohlc.py \
    --symbol EUR/USD --interval 1h --lookback-days 730 \
    --output data/EURUSD_1h.csv
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://api.twelvedata.com/time_series"
REQUIRED_COLUMNS = ["time", "open", "high", "low", "close", "volume"]
INTERVALS = {"1h": "1h", "4h": "4h", "1day": "1day", "1d": "1day"}


def fail(message: str, code: int = 1) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Twelve Data OHLC and save normalized CSV."
    )
    parser.add_argument("--symbol", required=True, choices=["EUR/USD", "XAU/USD"])
    parser.add_argument("--interval", required=True, choices=sorted(INTERVALS))
    parser.add_argument("--lookback-days", required=True, type=int)
    parser.add_argument("--output", required=True)
    parser.add_argument("--api-key-env", default="TWELVE_DATA_API_KEY")
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--retries", type=int, default=2)
    return parser.parse_args()


def existing_frame(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=REQUIRED_COLUMNS)
    try:
        old = pd.read_csv(path)
    except Exception as exc:
        fail(f"Cannot read existing CSV {path}: {exc}")
    missing = [name for name in ["time", "open", "high", "low", "close"] if name not in old.columns]
    if missing:
        fail(f"Existing CSV {path} has missing columns: {', '.join(missing)}")
    if "volume" not in old.columns:
        old["volume"] = 0
    return old[REQUIRED_COLUMNS].copy()


def normalize(raw_values: list[dict]) -> pd.DataFrame:
    if not raw_values:
        return pd.DataFrame(columns=REQUIRED_COLUMNS)

    df = pd.DataFrame(raw_values).rename(columns={"datetime": "time"})
    missing = [name for name in ["time", "open", "high", "low", "close"] if name not in df.columns]
    if missing:
        fail(f"Twelve Data response missing candle fields: {', '.join(missing)}")

    if "volume" not in df.columns:
        df["volume"] = 0

    df = df[REQUIRED_COLUMNS].copy()
    df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")

    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    valid = (
        df["time"].notna()
        & (df["open"] > 0)
        & (df["high"] > 0)
        & (df["low"] > 0)
        & (df["close"] > 0)
        & (df["high"] >= df["low"])
        & (df["high"] >= df["open"])
        & (df["high"] >= df["close"])
        & (df["low"] <= df["open"])
        & (df["low"] <= df["close"])
    )

    dropped = int((~valid).sum())
    if dropped:
        print(f"WARNING: dropped {dropped} invalid OHLC row(s)", file=sys.stderr)

    df = df.loc[valid].copy()
    df["volume"] = df["volume"].fillna(0)
    return df


def fetch(api_key: str, symbol: str, interval: str, lookback_days: int, timeout: int, retries: int) -> pd.DataFrame:
    end = pd.Timestamp.now(tz="UTC")
    start = end - pd.Timedelta(days=lookback_days)

    params = {
        "symbol": symbol,
        "interval": INTERVALS[interval],
        "start_date": start.strftime("%Y-%m-%d %H:%M:%S"),
        "end_date": end.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "UTC",
        "order": "ASC",
        "apikey": api_key,
    }

    last_error = None
    for attempt in range(retries + 1):
        try:
            response = requests.get(BASE_URL, params=params, timeout=timeout)
        except requests.RequestException as exc:
            last_error = f"network error: {exc}"
        else:
            if response.status_code == 429:
                last_error = "HTTP 429 rate limit from Twelve Data"
            elif response.status_code >= 400:
                last_error = f"HTTP {response.status_code}: {response.text[:300]}"
            else:
                try:
                    payload = response.json()
                except ValueError:
                    last_error = f"non-JSON response: {response.text[:300]}"
                else:
                    if payload.get("status") == "error":
                        last_error = payload.get("message", "unknown Twelve Data API error")
                    elif "values" not in payload:
                        last_error = f"missing values in response: {payload}"
                    else:
                        return normalize(payload["values"])

        if attempt < retries:
            wait = 2 ** attempt
            print(f"WARNING: fetch attempt {attempt + 1} failed ({last_error}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)

    fail(f"Twelve Data fetch failed for {symbol} {interval}: {last_error}")


def merge_and_save(existing: pd.DataFrame, incoming: pd.DataFrame, output: Path) -> pd.DataFrame:
    combined = pd.concat([existing, incoming], ignore_index=True)
    combined["time"] = pd.to_datetime(combined["time"], utc=True, errors="coerce")

    for col in ["open", "high", "low", "close", "volume"]:
        combined[col] = pd.to_numeric(combined[col], errors="coerce")

    combined = combined.dropna(subset=["time", "open", "high", "low", "close"])
    combined = combined.sort_values("time").drop_duplicates(subset=["time"], keep="last")

    valid = (
        (combined["open"] > 0)
        & (combined["high"] > 0)
        & (combined["low"] > 0)
        & (combined["close"] > 0)
        & (combined["high"] >= combined["low"])
        & (combined["high"] >= combined["open"])
        & (combined["high"] >= combined["close"])
        & (combined["low"] <= combined["open"])
        & (combined["low"] <= combined["close"])
    )
    combined = combined.loc[valid, REQUIRED_COLUMNS].copy()
    combined["volume"] = combined["volume"].fillna(0)
    combined["time"] = combined["time"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    output.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output, index=False)
    return combined


def main() -> None:
    args = parse_args()

    if args.lookback_days <= 0:
        fail("--lookback-days must be greater than zero")

    api_key = os.environ.get(args.api_key_env, "").strip()
    if not api_key:
        fail(
            f"Missing API key. Export {args.api_key_env} before running this command. "
            "Do not put API keys in source files or Git."
        )

    output = Path(args.output)
    old = existing_frame(output)
    new = fetch(
        api_key=api_key,
        symbol=args.symbol,
        interval=args.interval,
        lookback_days=args.lookback_days,
        timeout=args.timeout_seconds,
        retries=args.retries,
    )

    if new.empty:
        fail("Twelve Data returned zero valid OHLC candles")

    merged = merge_and_save(old, new, output)

    coverage_start = merged["time"].iloc[0]
    coverage_end = merged["time"].iloc[-1]
    print(
        f"OK: {args.symbol} {INTERVALS[args.interval]} saved to {output} | "
        f"rows={len(merged)} | coverage={coverage_start} -> {coverage_end}"
    )


if __name__ == "__main__":
    main()
