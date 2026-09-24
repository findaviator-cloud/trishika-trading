#!/usr/bin/env python3
"""
Strict research-only walk-forward OOS evaluator for EUR/USD and XAU/USD.

For each valid fold:
  1. choose a parameter candidate using in-sample data only;
  2. freeze the candidate;
  3. run only the next out-of-sample period;
  4. retain only trades entered and closed inside that OOS range;
  5. aggregate OOS-only metrics.

Golden Rule:
A report is eligible for OOS metrics only if source/data quality passes,
required warm-up is available, at least 8 valid completed folds exist,
and at least 30 closed OOS trades exist. Otherwise the public status is
INSUFFICIENT_DATA and headline metrics are N/A/null.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from test_next_bar_strategy import run_next_bar_strategy

CONFIG_PATH = ROOT / "config" / "fx_gold_walkforward.json"
REPORTS_DIR = ROOT / "reports"
DATA_DIR = ROOT / "data"

REQUIRED_COLUMNS = ["time", "open", "high", "low", "close"]


@dataclass(frozen=True)
class Fold:
    number: int
    is_start: int
    is_end: int
    oos_start: int
    oos_end: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run strict research-only FX/Gold walk-forward OOS evaluation."
    )
    parser.add_argument("--asset", choices=["EUR_USD", "XAU_USD"])
    parser.add_argument("--timeframe", choices=["1h", "4h", "1day", "1d"])
    parser.add_argument("--all", action="store_true", help="Run all configured asset/timeframe jobs.")
    parser.add_argument("--config", default=str(CONFIG_PATH))
    parser.add_argument("--csv", help="Optional explicit input CSV path; requires --asset and --timeframe.")
    parser.add_argument("--output", help="Optional explicit JSON output path; requires --asset and --timeframe.")
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing config: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON config {path}: {exc}") from exc


def null_metrics() -> dict[str, Any]:
    return {
        "total_trades": None,
        "win_rate_pct": None,
        "total_return_pct": None,
        "sharpe_ratio": None,
        "max_drawdown_pct": None,
        "profit_factor": None,
        "average_trade_pct": None,
        "long": {
            "trades": None,
            "win_rate_pct": None,
            "total_return_pct": None,
            "average_trade_pct": None,
        },
        "short": {
            "trades": None,
            "win_rate_pct": None,
            "total_return_pct": None,
            "average_trade_pct": None,
        },
    }


def research_safety() -> dict[str, bool]:
    return {
        "researchOnly": True,
        "approvedForTrading": False,
        "brokerConnectivityAllowed": False,
        "websocketAllowed": False,
        "ordersAllowed": False,
        "executionAllowed": False,
        "humanReviewRequired": True,
    }


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def infer_expected_delta(timeframe: str) -> pd.Timedelta:
    if timeframe == "1h":
        return pd.Timedelta(hours=1)
    if timeframe == "4h":
        return pd.Timedelta(hours=4)
    return pd.Timedelta(days=1)


def quality_assessment(
    source_rows: int,
    usable_rows: int,
    invalid_rows: int,
    duplicate_rows: int,
    large_gap_count: int,
    timeframe: str,
) -> dict[str, Any]:
    reason_codes: list[str] = []

    if usable_rows <= 0:
        reason_codes.append("NO_VALID_ROWS")

    if source_rows > 0 and invalid_rows > 0:
        reason_codes.append("INVALID_OHLC_ROWS")

    if source_rows > 0 and duplicate_rows > 0:
        reason_codes.append("DUPLICATE_TIMESTAMPS")

    if large_gap_count > 0:
        reason_codes.append("UNEXPECTED_TIMESTAMP_GAPS")

    return {
        "passed": len(reason_codes) == 0,
        "reasonCodes": reason_codes,
        "sourceRows": int(source_rows),
        "usableRows": int(usable_rows),
        "invalidRowsDropped": int(invalid_rows),
        "duplicateRowsDropped": int(duplicate_rows),
        "largeGapCount": int(large_gap_count),
        "expectedInterval": str(infer_expected_delta(timeframe)),
    }


def clean_ohlc(path: Path, timeframe: str = "1h") -> tuple[pd.DataFrame, list[str], dict[str, Any]]:
    warnings: list[str] = []

    if not path.exists():
        raise RuntimeError(f"CSV not found: {path}")

    raw = pd.read_csv(path)
    source_rows = len(raw)

    missing = [name for name in REQUIRED_COLUMNS if name not in raw.columns]
    if missing:
        raise RuntimeError(f"CSV {path} missing columns: {', '.join(missing)}")

    df = raw.copy()
    df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")

    for col in ["open", "high", "low", "close"]:
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

    invalid_rows = int((~valid).sum())
    valid_df = df.loc[valid].copy()
    duplicate_rows = int(valid_df.duplicated(subset=["time"], keep="last").sum())

    df = (
        valid_df.sort_values("time")
        .drop_duplicates("time", keep="last")
        .reset_index(drop=True)
    )

    if invalid_rows:
        warnings.append(f"Dropped {invalid_rows} invalid OHLC row(s).")

    if duplicate_rows:
        warnings.append(f"Dropped {duplicate_rows} duplicate timestamp row(s).")

    large_gap_count = 0
    if len(df) >= 3:
        diffs = df["time"].diff().dropna()
        expected_delta = infer_expected_delta(timeframe)
        threshold = expected_delta * 3

        if expected_delta > pd.Timedelta(0):
            large_gap_count = int((diffs > threshold).sum())

        if large_gap_count:
            warnings.append(
                f"Detected {large_gap_count} timestamp gap(s) larger than three expected intervals."
            )

    quality = quality_assessment(
        source_rows=source_rows,
        usable_rows=len(df),
        invalid_rows=invalid_rows,
        duplicate_rows=duplicate_rows,
        large_gap_count=large_gap_count,
        timeframe=timeframe,
    )

    return df, warnings, quality


def make_folds(n_bars: int, window: dict[str, Any]) -> list[Fold]:
    train_bars = int(window["train_bars"])
    test_bars = int(window["test_bars"])
    step_bars = int(window["step_bars"])
    anchored = bool(window.get("anchored", False))

    folds: list[Fold] = []
    oos_start = train_bars
    number = 1

    while oos_start + test_bars <= n_bars:
        is_start = 0 if anchored else oos_start - train_bars
        folds.append(Fold(number, is_start, oos_start, oos_start, oos_start + test_bars))
        oos_start += step_bars
        number += 1

    return folds


def fee_from_costs(costs: dict[str, Any], multiplier: float) -> float:
    bps = (
        (safe_float(costs.get("spread_bps")) or 0.0)
        + (safe_float(costs.get("slippage_bps")) or 0.0)
        + (safe_float(costs.get("commission_bps")) or 0.0)
    )
    return (bps * multiplier) / 10000.0


def engine_run(
    df: pd.DataFrame,
    common: dict[str, Any],
    candidate: dict[str, Any],
    fee: float,
) -> tuple[float, list[dict[str, Any]]]:
    params = dict(common)
    params["fee"] = fee
    params["donchian_len"] = int(candidate["donchian_len"])
    params["atr_len"] = int(candidate.get("atr_len", params.get("atr_len", 14)))
    params["atr_mult"] = float(candidate["atr_mult"])
    return run_next_bar_strategy(df.copy(), **params)


def trade_return(trade: dict[str, Any], fee: float) -> float | None:
    entry = safe_float(trade.get("entry_price"))
    exit_ = safe_float(trade.get("exit_price"))
    direction = int(trade.get("direction", 1) or 1)

    if entry is None or exit_ is None or entry <= 0 or exit_ <= 0:
        return None

    gross = (exit_ / entry - 1.0) if direction == 1 else (entry / exit_ - 1.0)
    return gross - (2.0 * fee)


def max_drawdown(equity_curve: list[float]) -> float | None:
    if len(equity_curve) < 2:
        return None

    peak = equity_curve[0]
    worst = 0.0

    for value in equity_curve:
        peak = max(peak, value)
        if peak > 0:
            worst = min(worst, value / peak - 1.0)

    return worst * 100.0


def annualization_factor(timeframe: str) -> float:
    if timeframe == "1h":
        return math.sqrt(24.0 * 252.0)
    if timeframe == "4h":
        return math.sqrt(6.0 * 252.0)
    return math.sqrt(252.0)


def metric_block(
    trades: list[dict[str, Any]],
    fee: float,
    initial_equity: float,
    timeframe: str,
) -> dict[str, Any]:
    enriched: list[dict[str, Any]] = []
    equity = float(initial_equity)
    curve = [equity]

    for trade in trades:
        ret = trade_return(trade, fee)
        if ret is None:
            continue

        equity *= 1.0 + ret
        item = dict(trade)
        item["net_return_pct"] = ret * 100.0
        item["equity_reconstructed"] = equity
        enriched.append(item)
        curve.append(equity)

    if not enriched:
        return null_metrics()

    returns = np.array([item["net_return_pct"] / 100.0 for item in enriched], dtype=float)
    winners = returns[returns > 0]
    losers = returns[returns < 0]

    gross_profit = float(winners.sum()) if len(winners) else 0.0
    gross_loss = float(abs(losers.sum())) if len(losers) else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else None

    if len(returns) >= 2 and float(returns.std(ddof=1)) > 0:
        sharpe = float(
            returns.mean() / returns.std(ddof=1) * annualization_factor(timeframe)
        )
    else:
        sharpe = None

    def side(direction: int) -> dict[str, Any]:
        selected = [
            item for item in enriched
            if int(item.get("direction", 1) or 1) == direction
        ]

        if not selected:
            return {
                "trades": 0,
                "win_rate_pct": None,
                "total_return_pct": None,
                "average_trade_pct": None,
            }

        selected_returns = np.array(
            [item["net_return_pct"] for item in selected],
            dtype=float,
        )

        return {
            "trades": int(len(selected)),
            "win_rate_pct": round(float((selected_returns > 0).mean() * 100.0), 6),
            "total_return_pct": round(float(selected_returns.sum()), 6),
            "average_trade_pct": round(float(selected_returns.mean()), 6),
        }

    return {
        "total_trades": int(len(enriched)),
        "win_rate_pct": round(float((returns > 0).mean() * 100.0), 6),
        "total_return_pct": round(float((equity / initial_equity - 1.0) * 100.0), 6),
        "sharpe_ratio": round(sharpe, 6) if sharpe is not None else None,
        "max_drawdown_pct": round(max_drawdown(curve), 6) if max_drawdown(curve) is not None else None,
        "profit_factor": round(profit_factor, 6) if profit_factor is not None else None,
        "average_trade_pct": round(float(returns.mean() * 100.0), 6),
        "long": side(1),
        "short": side(-1),
    }


def in_sample_score(
    df_is: pd.DataFrame,
    candidates: list[dict[str, Any]],
    common: dict[str, Any],
    fee: float,
    timeframe: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    scored: list[tuple[tuple[float, float, float], dict[str, Any], dict[str, Any]]] = []

    for candidate in candidates:
        equity, trades = engine_run(df_is, common, candidate, fee)
        metrics = metric_block(trades, fee, float(common["initial_equity"]), timeframe)
        total_trades = int(metrics["total_trades"] or 0)
        drawdown = safe_float(metrics["max_drawdown_pct"])
        drawdown_rank = drawdown if drawdown is not None else -999999.0
        score = (float(equity), drawdown_rank, float(total_trades))

        scored.append(
            (
                score,
                candidate,
                {
                    "final_equity": round(float(equity), 6),
                    "total_trades": total_trades,
                    "max_drawdown_pct": metrics["max_drawdown_pct"],
                    "win_rate_pct": metrics["win_rate_pct"],
                },
            )
        )

    if not scored:
        raise RuntimeError("No in-sample strategy candidates are configured.")

    scored.sort(key=lambda item: item[0], reverse=True)
    _, chosen, details = scored[0]
    return chosen, details


def eligibility_block(
    quality: dict[str, Any],
    candidate_folds: int,
    valid_completed_folds: int,
    warmup_pass: bool,
    closed_oos_trades: int,
    minimum_folds: int,
    minimum_trades: int,
) -> dict[str, Any]:
    reason_codes: list[str] = []

    if not quality["passed"]:
        reason_codes.append("DATA_QUALITY_FAILED")

    if not warmup_pass:
        reason_codes.append("INSUFFICIENT_WARMUP")

    if valid_completed_folds < minimum_folds:
        reason_codes.append("INSUFFICIENT_FOLDS")

    if closed_oos_trades < minimum_trades:
        reason_codes.append("INSUFFICIENT_TRADES")

    eligible = len(reason_codes) == 0

    return {
        "eligible": eligible,
        "status": "OOS_METRICS_AVAILABLE" if eligible else "INSUFFICIENT_DATA",
        "reasonCodes": reason_codes,
        "candidateFolds": int(candidate_folds),
        "validCompletedFolds": int(valid_completed_folds),
        "minimumRequiredFolds": int(minimum_folds),
        "warmupRequired": True,
        "warmupPass": bool(warmup_pass),
        "closedOosTrades": int(closed_oos_trades),
        "minimumRequiredClosedOosTrades": int(minimum_trades),
        "dataQualityPass": bool(quality["passed"]),
    }


def make_advisory(
    eligibility: dict[str, Any],
    metrics: dict[str, Any],
    stress_metrics: dict[str, Any],
) -> dict[str, Any]:
    if not eligibility["eligible"]:
        reasons = ", ".join(eligibility["reasonCodes"]) or "INSUFFICIENT_DATA"
        return {
            "level": "N/A",
            "status": "INSUFFICIENT_DATA",
            "message": (
                "OOS metrics are not eligible for interpretation because required "
                f"research gates did not pass: {reasons}."
            ),
        }

    base_return = safe_float(metrics.get("total_return_pct"))
    stress_return = safe_float(stress_metrics.get("total_return_pct"))
    max_dd = safe_float(metrics.get("max_drawdown_pct"))

    if (
        base_return is not None
        and stress_return is not None
        and base_return > 0
        and stress_return <= 0
    ):
        return {
            "level": "CAUTION",
            "status": "COST_SENSITIVE",
            "message": (
                "Positive base-cost historical OOS result becomes non-positive "
                "under configured cost stress."
            ),
        }

    if max_dd is not None and max_dd <= -20.0:
        return {
            "level": "HIGH",
            "status": "HIGH_DRAWDOWN_RISK",
            "message": (
                "Historical OOS maximum drawdown exceeds the configured "
                "high-risk research threshold."
            ),
        }

    return {
        "level": "RESEARCH_ONLY",
        "status": "OOS_METRICS_AVAILABLE",
        "message": (
            "Historical walk-forward OOS metrics are available for research "
            "review only; they are not a prediction or trading recommendation."
        ),
    }


def native_twelve_provenance(asset_cfg: dict[str, Any], canonical_tf: str) -> dict[str, Any]:
    return {
        "provider": "TWELVE_DATA",
        "providerSymbol": asset_cfg["twelve_data_symbol"],
        "sourceGranularity": canonical_tf,
        "barConstruction": "provider_native",
        "notNativeTwelveData": False,
    }


def run_one(
    config: dict[str, Any],
    asset: str,
    timeframe: str,
    csv_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    asset_cfg = config["assets"][asset]
    canonical_tf = "1day" if timeframe == "1d" else timeframe
    window = asset_cfg["windows"][canonical_tf]
    common = dict(config["common_strategy"])
    candidates = list(config["candidates"])
    costs = dict(asset_cfg["costs"])
    eligibility_cfg = dict(config["eligibility"])

    df, warnings, quality = clean_ohlc(csv_path, canonical_tf)
    folds = make_folds(len(df), window)

    base_fee = fee_from_costs(costs, 1.0)
    stress_multiplier = safe_float(costs.get("stress_cost_multiplier")) or 2.0
    stress_fee = fee_from_costs(costs, stress_multiplier)

    fold_rows: list[dict[str, Any]] = []
    oos_trades_base: list[dict[str, Any]] = []
    oos_trades_stress: list[dict[str, Any]] = []

    warmup_bars = int(window.get("warmup_bars", 250))
    valid_completed_folds = 0
    invalid_folds = 0
    all_valid_folds_have_warmup = True

    for fold in folds:
        warmup_available = int(fold.oos_start)
        warmup_pass = warmup_available >= warmup_bars
        fold_valid = bool(quality["passed"] and warmup_pass)
        fold_reason_codes: list[str] = []

        if not quality["passed"]:
            fold_reason_codes.append("DATA_QUALITY_FAILED")

        if not warmup_pass:
            fold_reason_codes.append("INSUFFICIENT_WARMUP")
            all_valid_folds_have_warmup = False

        fold_record: dict[str, Any] = {
            "fold": fold.number,
            "valid": False,
            "invalidReasonCodes": fold_reason_codes,
            "is_range": {
                "start_index": fold.is_start,
                "end_index_exclusive": fold.is_end,
                "start_time": df.iloc[fold.is_start]["time"].isoformat(),
                "end_time": df.iloc[fold.is_end - 1]["time"].isoformat(),
            },
            "oos_range": {
                "start_index": fold.oos_start,
                "end_index_exclusive": fold.oos_end,
                "start_time": df.iloc[fold.oos_start]["time"].isoformat(),
                "end_time": df.iloc[fold.oos_end - 1]["time"].isoformat(),
            },
            "warmup": {
                "requiredBars": warmup_bars,
                "availableBars": warmup_available,
                "passed": warmup_pass,
            },
            "selected_candidate": None,
            "in_sample_selection_metrics": None,
            "oos_closed_trades_base_cost": 0,
            "oos_closed_trades_stress_cost": 0,
        }

        if not fold_valid:
            invalid_folds += 1
            fold_rows.append(fold_record)
            continue

        try:
            df_is = df.iloc[fold.is_start:fold.is_end].reset_index(drop=True)
            chosen, is_details = in_sample_score(
                df_is,
                candidates,
                common,
                base_fee,
                canonical_tf,
            )

            context_start = fold.oos_start - warmup_bars
            df_context_oos = df.iloc[context_start:fold.oos_end].reset_index(drop=True)
            oos_start_time = df.iloc[fold.oos_start]["time"]
            oos_end_time = df.iloc[fold.oos_end - 1]["time"] + pd.Timedelta(seconds=1)

            _, base_trades = engine_run(df_context_oos, common, chosen, base_fee)
            _, stress_trades = engine_run(df_context_oos, common, chosen, stress_fee)

            eligible_base = [
                dict(trade, fold=fold.number)
                for trade in base_trades
                if pd.to_datetime(trade["entry_t"], utc=True) >= oos_start_time
                and pd.to_datetime(trade["exit_t"], utc=True) < oos_end_time
            ]

            eligible_stress = [
                dict(trade, fold=fold.number)
                for trade in stress_trades
                if pd.to_datetime(trade["entry_t"], utc=True) >= oos_start_time
                and pd.to_datetime(trade["exit_t"], utc=True) < oos_end_time
            ]

            oos_trades_base.extend(eligible_base)
            oos_trades_stress.extend(eligible_stress)
            valid_completed_folds += 1

            fold_record["valid"] = True
            fold_record["selected_candidate"] = chosen
            fold_record["in_sample_selection_metrics"] = is_details
            fold_record["oos_closed_trades_base_cost"] = len(eligible_base)
            fold_record["oos_closed_trades_stress_cost"] = len(eligible_stress)
        except Exception as exc:
            invalid_folds += 1
            fold_record["invalidReasonCodes"] = ["FOLD_EXECUTION_FAILED"]
            fold_record["foldError"] = str(exc)

        fold_rows.append(fold_record)

    base_metrics_raw = metric_block(
        oos_trades_base,
        base_fee,
        float(common["initial_equity"]),
        canonical_tf,
    )

    stress_metrics_raw = metric_block(
        oos_trades_stress,
        stress_fee,
        float(common["initial_equity"]),
        canonical_tf,
    )

    minimum_folds = int(eligibility_cfg["minimum_completed_folds"])
    minimum_trades = int(eligibility_cfg["minimum_closed_oos_trades"])
    closed_oos_trades = int(base_metrics_raw["total_trades"] or 0)

    warmup_pass = bool(
        len(folds) > 0
        and all_valid_folds_have_warmup
        and valid_completed_folds == len(folds)
    )

    eligibility = eligibility_block(
        quality=quality,
        candidate_folds=len(folds),
        valid_completed_folds=valid_completed_folds,
        warmup_pass=warmup_pass,
        closed_oos_trades=closed_oos_trades,
        minimum_folds=minimum_folds,
        minimum_trades=minimum_trades,
    )

    if not folds:
        warnings.append("Not enough clean OHLC history to build one complete IS/OOS fold.")

    if not quality["passed"]:
        warnings.append(
            "Data-quality gate failed; OOS metrics are withheld regardless of row count."
        )

    if not warmup_pass:
        warnings.append(
            "Required warm-up was not available for every candidate fold; OOS metrics are withheld."
        )

    if valid_completed_folds < minimum_folds:
        warnings.append(
            f"Only {valid_completed_folds} valid completed fold(s) available; "
            f"minimum required is {minimum_folds}."
        )

    if closed_oos_trades < minimum_trades:
        warnings.append(
            f"Only {closed_oos_trades} closed OOS trade(s) available; "
            f"minimum required is {minimum_trades}."
        )

    status = eligibility["status"]
    advisory = make_advisory(eligibility, base_metrics_raw, stress_metrics_raw)

    report = {
        "version": 2,
        "research_only": True,
        "safety": research_safety(),
        "asset": asset,
        "symbol": asset_cfg["twelve_data_symbol"],
        "timeframe": canonical_tf,
        "status": status,
        "oos_only": True,
        "strategy_engine": config["strategy_engine"],
        "generated_at_utc": pd.Timestamp.now(tz="UTC").isoformat(),
        "provenance": native_twelve_provenance(asset_cfg, canonical_tf),
        "source_csv": (
            str(csv_path.relative_to(ROOT))
            if csv_path.is_relative_to(ROOT)
            else str(csv_path)
        ),
        "data_coverage": {
            "start": df["time"].iloc[0].isoformat() if len(df) else None,
            "end": df["time"].iloc[-1].isoformat() if len(df) else None,
            "bars": int(len(df)),
        },
        "data_quality": quality,
        "eligibility": eligibility,
        "walk_forward": {
            "train_bars": int(window["train_bars"]),
            "test_bars": int(window["test_bars"]),
            "step_bars": int(window["step_bars"]),
            "warmup_bars": warmup_bars,
            "anchored": bool(window.get("anchored", False)),
            "candidate_folds": len(folds),
            "valid_completed_folds": valid_completed_folds,
            "invalid_folds": invalid_folds,
            "minimum_required_folds": minimum_folds,
            "selection_rule": config["selection_rule"],
            "folds": fold_rows,
        },
        "cost_assumptions": {
            "base": {
                "spread_bps": costs["spread_bps"],
                "slippage_bps": costs["slippage_bps"],
                "commission_bps": costs["commission_bps"],
                "per_side_fee_decimal": base_fee,
            },
            "stress": {
                "multiplier": stress_multiplier,
                "per_side_fee_decimal": stress_fee,
            },
        },
        "metrics": base_metrics_raw if eligibility["eligible"] else null_metrics(),
        "base_cost_metrics_raw": base_metrics_raw,
        "stress_cost_metrics_raw": stress_metrics_raw,
        "advisory": advisory,
        "warnings": warnings
        + [
            "Historical walk-forward simulation is research only; it is not a prediction or trading recommendation.",
            "Crypto metrics are not used as a fallback for EUR/USD or XAU/USD.",
            "Only trades entered and closed inside each valid OOS range are aggregated.",
            "A successful data download does not itself make OOS metrics eligible.",
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, default=str)
        handle.write("\n")

    print(
        f"OK: {asset} {canonical_tf} | status={status} | bars={len(df)} | "
        f"candidate_folds={len(folds)} | valid_folds={valid_completed_folds} | "
        f"base_oos_trades={base_metrics_raw['total_trades']} | report={output_path}"
    )

    return report


def main() -> None:
    args = parse_args()
    config = load_config(Path(args.config))

    if args.all:
        if args.asset or args.timeframe or args.csv or args.output:
            raise RuntimeError(
                "--all cannot be combined with --asset, --timeframe, --csv, or --output."
            )

        jobs = [
            (
                asset,
                timeframe,
                DATA_DIR / f"{cfg['csv_prefix']}_{suffix}.csv",
                REPORTS_DIR / f"{cfg['csv_prefix']}_{suffix}_walkforward.json",
            )
            for asset, cfg in config["assets"].items()
            for timeframe, suffix in [("1h", "1h"), ("4h", "4h"), ("1day", "1d")]
        ]

        for asset, timeframe, csv_path, output_path in jobs:
            run_one(config, asset, timeframe, csv_path, output_path)

        return

    if not (args.asset and args.timeframe):
        raise RuntimeError("Provide --all or both --asset and --timeframe.")

    canonical_tf = "1day" if args.timeframe == "1d" else args.timeframe
    asset_cfg = config["assets"][args.asset]
    suffix = {"1h": "1h", "4h": "4h", "1day": "1d"}[canonical_tf]

    csv_path = (
        Path(args.csv)
        if args.csv
        else DATA_DIR / f"{asset_cfg['csv_prefix']}_{suffix}.csv"
    )

    output_path = (
        Path(args.output)
        if args.output
        else REPORTS_DIR / f"{asset_cfg['csv_prefix']}_{suffix}_walkforward.json"
    )

    run_one(config, args.asset, canonical_tf, csv_path, output_path)


if __name__ == "__main__":
    main()
