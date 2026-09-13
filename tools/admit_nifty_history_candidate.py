#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

OVERLAP_START = "2024-01-01"
OVERLAP_END = "2024-03-31"
PRIMARY_START = "2010-01-01"

HOLD_PRIORITY = (
    "HOLD_HASH_MISMATCH_DETECTED",
    "HOLD_INSUFFICIENT_COVERAGE",
    "HOLD_DUPLICATE_DATES",
    "HOLD_INVALID_OHLC",
    "HOLD_NO_REQUIRED_OVERLAP",
    "HOLD_UNEXPLAINED_OVERLAP_MISMATCH",
)


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_header(name):
    return name.strip().lower().replace("_", "").replace(" ", "").replace("-", "")


def resolve_columns(fieldnames):
    aliases = {
        "date": {"date", "tradingdate", "timestamp"},
        "open": {"open"},
        "high": {"high"},
        "low": {"low"},
        "close": {"close", "closingprice"},
    }
    normalized = {normalize_header(name): name for name in fieldnames if name}
    mapping = {}
    for required, candidates in aliases.items():
        matched = [normalized[item] for item in candidates if item in normalized]
        if len(matched) != 1:
            raise ValueError(f"Cannot uniquely map required column: {required}")
        mapping[required] = matched[0]
    return mapping


def parse_rows(path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row")
        mapping = resolve_columns(reader.fieldnames)
        rows = []
        for line_number, row in enumerate(reader, start=2):
            try:
                date = datetime.strptime((row[mapping["date"]] or "").strip()[:10], "%Y-%m-%d").date().isoformat()
                values = {
                    field: float((row[mapping[field]] or "").replace(",", ""))
                    for field in ("open", "high", "low", "close")
                }
            except Exception as exc:
                raise ValueError(f"Invalid row {line_number}: {exc}") from exc
            rows.append({"date": date, **values, "line": line_number})
    return rows, mapping


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def fail(message):
    print(message, file=sys.stderr)
    return 2


def add_hold(holds, hold_code, detail, affected_dates=None, affected_rows=None):
    priority_rank = HOLD_PRIORITY.index(hold_code) + 1
    record = {
        "detail": detail,
        "holdCode": hold_code,
        "priorityRank": priority_rank,
    }
    if affected_dates:
        record["affectedDates"] = affected_dates
    if affected_rows:
        record["affectedRows"] = affected_rows
    holds.append(record)


def main():
    parser = argparse.ArgumentParser(
        description="Validate a private NIFTY candidate without copying or modifying raw data."
    )
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--tolerance", required=True, type=float)
    parser.add_argument("--publisher", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--terms-url", required=True)
    parser.add_argument("--retrieval-method", required=True)
    parser.add_argument("--series-variant", required=True)
    args = parser.parse_args()

    candidate = Path(args.candidate)
    manifest_path = Path(args.manifest)
    baseline = Path(args.baseline)
    run_dir = Path(args.run_dir)

    if args.tolerance < 0:
        return fail("FAIL: tolerance must be non-negative")
    if args.series_variant != "PRICE_RETURN":
        return fail("HOLD_PENDING_SERIES_IDENTITY_EVIDENCE: series variant must be PRICE_RETURN")
    if not candidate.is_file():
        return fail("RAW_ARTIFACT_MISSING: candidate file does not exist")
    if not manifest_path.is_file():
        return fail("MANIFEST_MISSING")
    if not baseline.is_file():
        return fail("BASELINE_ARTIFACT_MISSING: audited baseline file does not exist")

    with manifest_path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)

    if manifest.get("admissionStatus") != "PENDING_ACQUISITION":
        return fail("FAIL: manifest is not in PENDING_ACQUISITION status")

    generated_at = utc_now()
    candidate_hash = sha256(candidate)
    candidate_bytes = candidate.stat().st_size
    rows, candidate_columns = parse_rows(candidate)
    baseline_rows, baseline_columns = parse_rows(baseline)

    dates = [row["date"] for row in rows]
    candidate_start = min(dates) if dates else None
    candidate_end = max(dates) if dates else None
    coverage_ok = bool(dates) and candidate_start <= PRIMARY_START and candidate_end >= OVERLAP_END

    rows_by_date = {}
    for row in rows:
        rows_by_date.setdefault(row["date"], []).append(row)

    duplicate_dates = sorted(date for date, group in rows_by_date.items() if len(group) > 1)
    duplicate_rows = [
        {"date": date, "lineNumbers": [row["line"] for row in rows_by_date[date]]}
        for date in duplicate_dates
    ]

    invalid_ohlc_rows = [
        row for row in rows
        if min(row["open"], row["high"], row["low"], row["close"]) <= 0
        or row["low"] > min(row["open"], row["close"], row["high"])
        or row["high"] < max(row["open"], row["close"], row["low"])
    ]

    candidate_by_date = {row["date"]: row for row in rows}
    baseline_by_date = {row["date"]: row for row in baseline_rows}
    overlap_dates = [
        date for date in sorted(set(candidate_by_date) & set(baseline_by_date))
        if OVERLAP_START <= date <= OVERLAP_END
    ]

    mismatches = []
    for date in overlap_dates:
        for field in ("open", "high", "low", "close"):
            candidate_value = candidate_by_date[date][field]
            baseline_value = baseline_by_date[date][field]
            difference = abs(candidate_value - baseline_value)
            if difference > args.tolerance:
                mismatches.append({
                    "absoluteDifference": difference,
                    "baseline": baseline_value,
                    "candidate": candidate_value,
                    "date": date,
                    "field": field,
                })

    expected_hash = manifest.get("rawArtifact", {}).get("sha256")
    all_detected_holds = []

    if expected_hash and expected_hash != candidate_hash:
        add_hold(
            all_detected_holds,
            "HOLD_HASH_MISMATCH_DETECTED",
            "Observed SHA-256 differs from the manifest SHA-256.",
            affected_rows=[{"expectedSha256": expected_hash, "observedSha256": candidate_hash}],
        )
        write_json(run_dir / "hash-mismatch-detected.json", {
            "recordType": "HASH_MISMATCH_DETECTED",
            "hashAlgorithm": "SHA-256",
            "detectedAtUtc": generated_at,
            "manifestReference": str(manifest_path),
            "expectedSha256": expected_hash,
            "observedSha256": candidate_hash,
            "pathExamined": str(candidate),
            "detectionTrigger": "MANDATORY_OVERLAP_RECONCILIATION_GATE",
        })

    if not coverage_ok:
        add_hold(
            all_detected_holds,
            "HOLD_INSUFFICIENT_COVERAGE",
            "Candidate does not cover the required primary start through required overlap end.",
            affected_rows=[{
                "candidateMaxDate": candidate_end,
                "candidateMinDate": candidate_start,
                "requiredMaxDate": OVERLAP_END,
                "requiredMinDate": PRIMARY_START,
            }],
        )

    if duplicate_dates:
        add_hold(
            all_detected_holds,
            "HOLD_DUPLICATE_DATES",
            "Candidate contains one or more duplicate trading dates.",
            affected_dates=duplicate_dates,
            affected_rows=duplicate_rows,
        )

    if invalid_ohlc_rows:
        add_hold(
            all_detected_holds,
            "HOLD_INVALID_OHLC",
            "Candidate contains rows that violate OHLC consistency rules.",
            affected_dates=sorted({row["date"] for row in invalid_ohlc_rows}),
            affected_rows=[{
                "date": row["date"],
                "lineNumber": row["line"],
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
            } for row in invalid_ohlc_rows],
        )

    if not overlap_dates:
        add_hold(
            all_detected_holds,
            "HOLD_NO_REQUIRED_OVERLAP",
            "No shared candidate/baseline dates exist inside the required overlap window.",
            affected_rows=[{"overlapEnd": OVERLAP_END, "overlapStart": OVERLAP_START}],
        )

    if mismatches:
        add_hold(
            all_detected_holds,
            "HOLD_UNEXPLAINED_OVERLAP_MISMATCH",
            "One or more shared OHLC values exceed the configured tolerance.",
            affected_dates=sorted({item["date"] for item in mismatches}),
            affected_rows=mismatches,
        )
        write_json(run_dir / "unexplained-overlap-mismatches.json", {
            "recordType": "UNEXPLAINED_OVERLAP_MISMATCH",
            "detectedAtUtc": generated_at,
            "trigger": "MANDATORY_OVERLAP_RECONCILIATION_GATE",
            "tolerance": args.tolerance,
            "mismatches": mismatches,
        })

    all_detected_holds.sort(key=lambda item: item["priorityRank"])

    if all_detected_holds:
        primary_hold = all_detected_holds[0]["holdCode"]
        decision = primary_hold
        status = "HOLD"
    else:
        primary_hold = None
        decision = "HOLD_PENDING_PROVENANCE_AND_MANIFEST_COMPLETION"
        status = "HOLD"

    write_json(run_dir / "admission-report.json", {
        "recordType": "NIFTY_CANDIDATE_ADMISSION_RUN",
        "generatedAtUtc": generated_at,
        "status": status,
        "decision": decision,
        "primaryHold": primary_hold,
        "allDetectedHolds": all_detected_holds,
        "evaluationOrder": list(HOLD_PRIORITY),
        "candidate": {
            "bytes": candidate_bytes,
            "mappedColumns": candidate_columns,
            "maxDate": candidate_end,
            "minDate": candidate_start,
            "pathExamined": str(candidate),
            "rawCopiedToRunDirectory": False,
            "rowCount": len(rows),
            "sha256": candidate_hash,
        },
        "checks": {
            "baselineMappedColumns": baseline_columns,
            "coverageOk": coverage_ok,
            "duplicateDates": duplicate_dates,
            "invalidOhlcRows": invalid_ohlc_rows,
            "overlapMismatchCount": len(mismatches),
            "overlapTolerance": args.tolerance,
            "requiredOverlapDateCount": len(overlap_dates),
        },
        "sourceDeclaration": {
            "publisher": args.publisher,
            "retrievalMethod": args.retrieval_method,
            "seriesVariant": args.series_variant,
            "sourceUrl": args.source_url,
            "termsUrl": args.terms_url,
        },
    })

    print(f"ADMISSION_DECISION={decision}")
    print(f"STATUS={status}")
    print(f"PRIMARY_HOLD={primary_hold or 'NONE'}")
    print(f"ALL_DETECTED_HOLDS_COUNT={len(all_detected_holds)}")
    print(f"CANDIDATE_SHA256={candidate_hash}")
    print(f"REPORT={run_dir / 'admission-report.json'}")
    print("RAW_COPY_TO_RUN_DIRECTORY=FALSE")
    print("NO_MERGE=CONFIRMED")
    print("NO_BACKTEST=CONFIRMED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
