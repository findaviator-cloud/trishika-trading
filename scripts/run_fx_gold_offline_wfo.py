#!/usr/bin/env python3
"""
Runs existing FX/Gold WFO runner one asset/timeframe at a time using offline CSV.
It creates source-labelled report copies and never invokes Twelve Data.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ASSETS = {"EURUSD", "XAUUSD"}
PROVIDERS = {"HISTDATA", "DUKASCOPY"}
TIMEFRAMES = {"1h": "1h", "4h": "4h", "1day": "1d"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--timeframe", required=True, choices=TIMEFRAMES)
    parser.add_argument("--root", default="data/offline")
    parser.add_argument("--reports-root", default="reports/offline")
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()

    provider = args.provider.upper()
    asset = args.asset.upper().replace("/", "")
    if provider not in PROVIDERS or asset not in ASSETS:
        raise SystemExit("provider must be HISTDATA/DUKASCOPY and asset must be EURUSD/XAUUSD")

    suffix = TIMEFRAMES[args.timeframe]
    root = Path(args.root)
    csv_path = root / "normalized" / provider / asset / f"{asset}_{suffix}_{provider.lower()}.csv"
    provenance_path = root / "normalized" / provider / asset / f"{asset}_{suffix}_{provider.lower()}.provenance.json"
    reports_root = Path(args.reports_root) / provider / asset
    reports_root.mkdir(parents=True, exist_ok=True)
    output_path = reports_root / f"{asset}_{suffix}_{provider.lower()}_walkforward.json"

    if not csv_path.is_file() or not provenance_path.is_file():
        raise SystemExit(f"offline normalized input/provenance missing for {provider} {asset} {args.timeframe}")

    temp_output = reports_root / f".{asset}_{suffix}_{provider.lower()}_runner.json"
    cmd = [
        args.python, "scripts/run_fx_gold_walkforward.py",
        "--asset", asset,
        "--timeframe", args.timeframe,
        "--csv", str(csv_path),
        "--output", str(temp_output),
    ]
    completed = subprocess.run(cmd, text=True, capture_output=True)
    if completed.returncode != 0:
        raise SystemExit(completed.stderr or completed.stdout or "offline WFO runner failed")

    report = json.loads(temp_output.read_text(encoding="utf-8"))
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    report["provenance"] = {
        **report.get("provenance", {}),
        **{key: provenance[key] for key in (
            "provider", "sourceGranularity", "barConstruction",
            "notNativeTwelveData", "timestampNormalization",
            "rawArchivePath", "rawArchiveSha256", "normalizedPath",
            "normalizedSha256",
        ) if key in provenance},
    }
    report["offlineSource"] = True
    report["asset"] = asset
    report["timeframe"] = args.timeframe
    report["status"] = report.get("status", "RUN_FAILED")
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp_output.unlink(missing_ok=True)
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
