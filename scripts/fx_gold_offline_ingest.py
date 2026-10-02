#!/usr/bin/env python3
"""
Research-only FX/Gold offline ingestion.

Raw files are immutable archives. This script accepts a locally supplied source
file, records SHA-256 provenance, normalizes timestamps to UTC, and builds
1h/4h/1day OHLC bars from M1 input. It never contacts a provider.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shutil
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ASSETS = {"EURUSD", "XAUUSD"}
PROVIDERS = {"HISTDATA", "DUKASCOPY"}
TIMEFRAMES = ("1h", "4h", "1day")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_asset(value: str) -> str:
    asset = value.strip().upper().replace("/", "").replace("_", "").replace("-", "")
    if asset not in ASSETS:
        raise ValueError(f"unsupported asset: {value}; expected one of {sorted(ASSETS)}")
    return asset


def canonical_provider(value: str) -> str:
    provider = value.strip().upper()
    if provider not in PROVIDERS:
        raise ValueError(f"unsupported provider: {value}; expected one of {sorted(PROVIDERS)}")
    return provider


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_timestamp(value: str) -> datetime:
    raw = value.strip().replace("Z", "+00:00")
    formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y.%m.%d %H:%M",
        "%Y.%m.%d %H:%M:%S",
        "%Y%m%d %H%M%S",
    )
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        parsed = None
        for fmt in formats:
            try:
                parsed = datetime.strptime(raw, fmt)
                break
            except ValueError:
                pass
        if parsed is None:
            raise ValueError(f"unparseable timestamp: {value!r}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(second=0, microsecond=0)


def field(row: dict[str, str], candidates: tuple[str, ...]) -> str:
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for name in candidates:
        value = lowered.get(name.lower())
        if value not in (None, ""):
            return str(value)
    return ""


def to_float(value: str) -> float:
    numeric = float(value.strip())
    if not math.isfinite(numeric):
        raise ValueError("non-finite numeric value")
    return numeric


def read_m1_csv(source: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    rows: list[dict[str, Any]] = []
    quality = {
        "sourceRows": 0,
        "usableRows": 0,
        "invalidRowsDropped": 0,
        "duplicateRowsDropped": 0,
        "largeGapCount": 0,
    }
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        if not reader.fieldnames:
            raise ValueError("source CSV has no header row")
        by_time: dict[str, dict[str, Any]] = {}
        for raw in reader:
            quality["sourceRows"] += 1
            try:
                ts_raw = field(raw, ("time", "timestamp", "datetime", "date"))
                if not ts_raw:
                    date_part = field(raw, ("date",))
                    time_part = field(raw, ("time",))
                    ts_raw = f"{date_part} {time_part}".strip()
                timestamp = parse_timestamp(ts_raw)
                open_ = to_float(field(raw, ("open", "o")))
                high = to_float(field(raw, ("high", "h")))
                low = to_float(field(raw, ("low", "l")))
                close = to_float(field(raw, ("close", "c", "last")))
                volume_raw = field(raw, ("volume", "vol", "tick_volume"))
                volume = to_float(volume_raw) if volume_raw else 0.0
                if min(open_, high, low, close) <= 0 or high < low or high < max(open_, close) or low > min(open_, close):
                    raise ValueError("invalid OHLC relationship")
                item = {
                    "time": timestamp,
                    "open": open_,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": volume,
                }
                key = timestamp.isoformat()
                if key in by_time:
                    quality["duplicateRowsDropped"] += 1
                by_time[key] = item
            except (ValueError, TypeError):
                quality["invalidRowsDropped"] += 1

    rows = sorted(by_time.values(), key=lambda item: item["time"])
    quality["usableRows"] = len(rows)
    for previous, current in zip(rows, rows[1:]):
        gap_minutes = (current["time"] - previous["time"]).total_seconds() / 60
        if gap_minutes > 5:
            quality["largeGapCount"] += 1
    return rows, quality


def floor_bar(timestamp: datetime, timeframe: str) -> datetime:
    if timeframe == "1h":
        return timestamp.replace(minute=0, second=0, microsecond=0)
    if timeframe == "4h":
        return timestamp.replace(hour=(timestamp.hour // 4) * 4, minute=0, second=0, microsecond=0)
    if timeframe == "1day":
        return timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"unsupported timeframe: {timeframe}")


def aggregate(rows: list[dict[str, Any]], timeframe: str) -> list[dict[str, Any]]:
    grouped: "OrderedDict[datetime, list[dict[str, Any]]]" = OrderedDict()
    for row in rows:
        grouped.setdefault(floor_bar(row["time"], timeframe), []).append(row)

    bars: list[dict[str, Any]] = []
    for start, items in grouped.items():
        bars.append({
            "time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "open": items[0]["open"],
            "high": max(item["high"] for item in items),
            "low": min(item["low"] for item in items),
            "close": items[-1]["close"],
            "volume": sum(item["volume"] for item in items),
            "sourceM1Rows": len(items),
        })
    return bars


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=("time", "open", "high", "low", "close", "volume", "sourceM1Rows"))
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--source", required=True, help="local raw M1 CSV path")
    parser.add_argument("--root", default="data/offline")
    parser.add_argument("--imported-at-utc", default=None)
    args = parser.parse_args()

    provider = canonical_provider(args.provider)
    asset = canonical_asset(args.asset)
    source = Path(args.source).expanduser().resolve()
    root = Path(args.root).resolve()
    imported_at = args.imported_at_utc or utc_now()

    if not source.is_file():
        raise SystemExit(f"source file not found: {source}")

    raw_dir = root / "raw-archive" / provider / asset
    normalized_dir = root / "normalized" / provider / asset
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_name = source.name
    archived = raw_dir / raw_name
    if archived.exists() and sha256_file(archived) != sha256_file(source):
        archived = raw_dir / f"{source.stem}_{imported_at.replace(':', '').replace('-', '')}{source.suffix}"
    if not archived.exists():
        shutil.copy2(source, archived)

    raw_hash = sha256_file(archived)
    rows, quality = read_m1_csv(archived)
    if not rows:
        raise SystemExit("no usable M1 OHLC rows after quality validation")

    coverage = {
        "startUtc": rows[0]["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endUtc": rows[-1]["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    base_provenance = {
        "provider": provider,
        "asset": asset,
        "sourceGranularity": "M1",
        "barConstruction": "local_aggregation",
        "notNativeTwelveData": True,
        "timestampNormalization": "UTC",
        "rawArchivePath": str(archived.relative_to(root)),
        "rawArchiveSha256": raw_hash,
        "rawArchiveBytes": archived.stat().st_size,
        "importedAtUtc": imported_at,
        "coverage": coverage,
        "dataQuality": quality,
    }
    manifest = dict(base_provenance)
    manifest["normalizedOutputs"] = []

    checksum_file = raw_dir / f"{archived.name}.sha256.json"
    write_json(checksum_file, dict(base_provenance, checksumFile=str(checksum_file.relative_to(root))))

    for timeframe in TIMEFRAMES:
        bars = aggregate(rows, timeframe)
        suffix = {"1h": "1h", "4h": "4h", "1day": "1d"}[timeframe]
        csv_name = f"{asset}_{suffix}_{provider.lower()}.csv"
        csv_path = normalized_dir / csv_name
        meta_path = normalized_dir / f"{asset}_{suffix}_{provider.lower()}.provenance.json"
        write_csv(csv_path, bars)
        report = dict(base_provenance)
        report.update({
            "timeframe": timeframe,
            "status": "INGESTION_PENDING",
            "statusReason": "Offline data ingested and locally aggregated; independent WFO has not run yet.",
            "normalizedPath": str(csv_path.relative_to(root)),
            "normalizedSha256": sha256_file(csv_path),
            "barCount": len(bars),
        })
        write_json(meta_path, report)
        manifest["normalizedOutputs"].append({
            "timeframe": timeframe,
            "path": str(csv_path.relative_to(root)),
            "sha256": report["normalizedSha256"],
            "barCount": len(bars),
            "provenancePath": str(meta_path.relative_to(root)),
        })

    write_json(raw_dir / f"{archived.name}.manifest.json", manifest)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
