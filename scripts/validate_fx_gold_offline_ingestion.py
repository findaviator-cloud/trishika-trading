#!/usr/bin/env python3
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
required = [
    ROOT / "scripts/fx_gold_offline_ingest.py",
    ROOT / "scripts/run_fx_gold_offline_wfo.py",
    ROOT / "tests/test_fx_gold_offline_ingest.py",
]
for path in required:
    if not path.is_file():
        raise SystemExit(f"missing required offline file: {path.relative_to(ROOT)}")

source = (ROOT / "scripts/fx_gold_offline_ingest.py").read_text(encoding="utf-8")
for token in (
    "ASSETS = {\"EURUSD\", \"XAUUSD\"}",
    "PROVIDERS = {\"HISTDATA\", \"DUKASCOPY\"}",
    "\"sourceGranularity\": \"M1\"",
    "\"barConstruction\": \"local_aggregation\"",
    "\"notNativeTwelveData\": True",
    "raw-archive",
    "sha256",
):
    if token not in source:
        raise SystemExit(f"offline ingestion contract token missing: {token}")

runner = (ROOT / "scripts/run_fx_gold_offline_wfo.py").read_text(encoding="utf-8")
for token in ("reports/offline", "offlineSource", "rawArchiveSha256", "notNativeTwelveData"):
    if token not in runner:
        raise SystemExit(f"offline runner contract token missing: {token}")

print("FX/Gold offline ingestion contract validation passed.")
